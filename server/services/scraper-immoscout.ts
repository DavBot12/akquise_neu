import { storage } from '../storage';
import {
  proxyRequest,
  sleep,
  withJitter,
  rotateUserAgent,
  extractPhoneFromHtml,
} from './scraper-utils';

interface ImmoScout24ScraperOptions {
  intervalMinutes?: number;
  maxPages?: number;
  onLog?: (msg: string) => void;
  onListingFound?: (listing: any) => Promise<void>;
  onPhoneFound?: (payload: { url: string; phone: string }) => void;
}

interface SearchHit {
  exposeId: string;
  links: {
    targetURL: string;
    absoluteURL: string;
  };
  headline: string;
  addressString: string;
  isPrivate: boolean;
  primaryPrice: number;
  primaryArea: number;
  numberOfRooms: number;
  badges?: Array<{ label: string; value: string }>;
}

interface SearchData {
  hits: SearchHit[];
  pagination: {
    nextURL: string | null;
    totalPages: number;
    totalHits: number;
  };
}

interface ProductData {
  title: string;
  description: string;
  images: string[];
  price: number;
  datePosted?: string;
}

export class ImmoScout24ScraperService {
  private isRunning = false;
  private intervalHandle: NodeJS.Timeout | null = null;
  private currentCycle = 0;
  private processedUrls = new Set<string>();
  private sessionCookies = '';
  private requestCount = 0;

  private baseUrls: Record<string, string> = {
    'wien-wohnung-kaufen': 'https://www.immobilienscout24.at/regional/wien/wien/wohnung-kaufen?isPrivateInsertion=true',
    'noe-wohnung-kaufen': 'https://www.immobilienscout24.at/regional/niederoesterreich/wohnung-kaufen?isPrivateInsertion=true',
    'noe-haus-kaufen': 'https://www.immobilienscout24.at/regional/niederoesterreich/haus-kaufen?isPrivateInsertion=true',
  };

  // ============================================================================
  // PUBLIC METHODS
  // ============================================================================

  async start(options: ImmoScout24ScraperOptions = {}): Promise<void> {
    if (this.isRunning) {
      options.onLog?.('[ImmoScout24] Already running');
      return;
    }

    this.isRunning = true;
    const intervalMinutes = options.intervalMinutes || 30;

    options.onLog?.(`[ImmoScout24] Starting scraper (interval: ${intervalMinutes} min, maxPages: ${options.maxPages || 'all'})`);

    // Run immediately
    await this.runCycle(options);

    // Schedule recurring cycles
    this.intervalHandle = setInterval(async () => {
      if (this.isRunning) {
        await this.runCycle(options);
      }
    }, intervalMinutes * 60 * 1000);
  }

  stop(onLog?: (msg: string) => void): void {
    if (!this.isRunning) {
      onLog?.('[ImmoScout24] Not running');
      return;
    }

    this.isRunning = false;

    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }

    onLog?.('[ImmoScout24] Stopped');
  }

  getStatus(): { isRunning: boolean; currentCycle: number } {
    return {
      isRunning: this.isRunning,
      currentCycle: this.currentCycle,
    };
  }

  // ============================================================================
  // PRIVATE METHODS - LIFECYCLE
  // ============================================================================

  private async runCycle(options: ImmoScout24ScraperOptions): Promise<void> {
    this.currentCycle++;
    const cycleStart = Date.now();

    options.onLog?.(`\n[ImmoScout24] ========== CYCLE ${this.currentCycle} START ==========`);

    let totalProcessed = 0;
    let totalSaved = 0;

    try {
      // Establish session
      await this.establishSession(options.onLog);

      // Process each category
      for (const [key, baseUrl] of Object.entries(this.baseUrls)) {
        options.onLog?.(`\n[ImmoScout24] Category: ${key}`);

        let currentUrl: string | null = baseUrl;
        let pageNum = 1;
        const maxPages = options.maxPages || 999;

        while (currentUrl && pageNum <= maxPages) {
          try {
            // Fetch search page
            options.onLog?.(`[ImmoScout24] Fetching page ${pageNum}...`);
            const searchHtml = await this.fetchPage(currentUrl, options.onLog);

            // Extract search data
            const searchData = this.extractSearchState(searchHtml);

            if (!searchData || searchData.hits.length === 0) {
              options.onLog?.(`[ImmoScout24] No results on page ${pageNum}, stopping category`);
              break;
            }

            options.onLog?.(`[ImmoScout24] Found ${searchData.hits.length} private listings on page ${pageNum}/${searchData.pagination.totalPages} (total: ${searchData.pagination.totalHits})`);

            // Process each hit
            for (const hit of searchData.hits) {
              totalProcessed++;

              // Check if already processed
              if (this.processedUrls.has(hit.links.absoluteURL)) {
                options.onLog?.(`[ImmoScout24] [${totalProcessed}/${searchData.pagination.totalHits}] Already processed: ${hit.exposeId}`);
                continue;
              }

              options.onLog?.(`[ImmoScout24] [${totalProcessed}/${searchData.pagination.totalHits}] Processing: ${hit.headline.substring(0, 50)}...`);

              try {
                // Fetch detail page
                const detailHtml = await this.fetchPage(hit.links.absoluteURL, options.onLog);

                // Extract product data from JSON-LD
                const productData = this.extractProductJsonLd(detailHtml);

                if (!productData) {
                  options.onLog?.(`[ImmoScout24] ⚠ No product data found for ${hit.exposeId}`);
                  continue;
                }

                // Build complete listing
                const listing = this.buildListing(hit, productData, hit.links.absoluteURL);

                // Extract phone (optional)
                const phone = extractPhoneFromHtml(detailHtml);
                if (phone) {
                  listing.phone = phone;
                  options.onPhoneFound?.({ url: hit.links.absoluteURL, phone });
                  options.onLog?.(`[ImmoScout24] ✓ Phone found: ${phone}`);
                }

                // Save listing
                await options.onListingFound?.(listing);
                this.processedUrls.add(hit.links.absoluteURL);
                totalSaved++;

                options.onLog?.(`[ImmoScout24] ✓ Saved: ${listing.title.substring(0, 50)}... (€${listing.price}, ${listing.area}m², ${listing.rooms} rooms)`);

              } catch (e) {
                options.onLog?.(`[ImmoScout24] ✗ Error processing ${hit.exposeId}: ${(e as Error).message}`);
              }

              // Delay between detail pages
              await sleep(withJitter(60, 60)); // 60ms ± 60ms
            }

            // Get next page URL
            currentUrl = searchData.pagination.nextURL
              ? `https://www.immobilienscout24.at3{searchData.pagination.nextURL}`
              : null;

            pageNum++;

            // Delay between search pages
            await sleep(withJitter(200, 100)); // 200ms ± 100ms

          } catch (e) {
            options.onLog?.(`[ImmoScout24] ✗ Error on page ${pageNum}: ${(e as Error).message}`);
            break;
          }
        }
      }

    } catch (e) {
      options.onLog?.(`[ImmoScout24] ✗ Cycle error: ${(e as Error).message}`);
    }

    const cycleTime = ((Date.now() - cycleStart) / 1000).toFixed(1);
    options.onLog?.(`\n[ImmoScout24] ========== CYCLE ${this.currentCycle} COMPLETE ==========`);
    options.onLog?.(`[ImmoScout24] Processed: ${totalProcessed}, Saved: ${totalSaved}, Time: ${cycleTime}s`);
  }

  private async establishSession(onLog?: (msg: string) => void): Promise<void> {
    try {
      onLog?.('[ImmoScout24] Establishing session...');

      const res = await proxyRequest(
        'https://www.immobilienscout24.at/',
        '',
        { headers: { 'User-Agent': rotateUserAgent() } }
      );

      if (res.headers['set-cookie']) {
        this.sessionCookies = res.headers['set-cookie']
          .map((c: string) => c.split(';')[0])
          .join('; ');
      }

      onLog?.('[ImmoScout24] ✓ Session established');
    } catch (e) {
      onLog?.(`[ImmoScout24] ⚠ Session establishment failed: ${(e as Error).message}`);
    }
  }

  // ============================================================================
  // PRIVATE METHODS - FETCHING
  // ============================================================================

  private async fetchPage(url: string, onLog?: (msg: string) => void): Promise<string> {
    this.requestCount++;

    // Refresh session every 50 requests
    if (this.requestCount % 50 === 0) {
      await this.establishSession(onLog);
    }

    const res = await proxyRequest(url, this.sessionCookies, {
      headers: {
        'User-Agent': rotateUserAgent(),
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'de-AT,de;q=0.9,en;q=0.8',
        'Referer': 'https://www.immobilienscout24.at/',
      }
    });

    // Update session cookies if provided
    if (res.headers['set-cookie']) {
      this.sessionCookies = res.headers['set-cookie']
        .map((c: string) => c.split(';')[0])
        .join('; ');
    }

    return res.data as string;
  }

  // ============================================================================
  // PRIVATE METHODS - EXTRACTION
  // ============================================================================

  private extractSearchState(html: string): SearchData | null {
    try {
      // Find window.__INITIAL_STATE__
      const match = html.match(/window\.__INITIAL_STATE__\s*=\s*({.+?});?\s*(?:window\.|<\/script>)/s);

      if (!match) {
        return null;
      }

      // Replace undefined with null for valid JSON
      const json = match[1].replace(/:\s*undefined/g, ': null');
      const state = JSON.parse(json);

      // Navigate to results
      const results = state.reduxAsyncConnect?.pageData?.results;

      if (!results || !results.hits) {
        return null;
      }

      return {
        hits: results.hits || [],
        pagination: {
          nextURL: results.pagination?.nextURL || null,
          totalPages: results.pagination?.totalPages || 1,
          totalHits: results.totalHits || 0,
        }
      };

    } catch (e) {
      return null;
    }
  }

  private extractProductJsonLd(html: string): ProductData | null {
    try {
      // Find the Product JSON embedded in the HTML
      const productIndex = html.indexOf('"@type":"Product"');
      if (productIndex === -1) return null;

      // Find the start of this JSON object by counting braces backwards
      let start = -1;
      let braceCount = 0;

      for (let i = productIndex - 1; i >= 0; i--) {
        if (html[i] === '}') braceCount++;
        if (html[i] === '{') {
          if (braceCount === 0) {
            start = i;
            break;
          }
          braceCount--;
        }
      }

      if (start === -1) return null;

      // Find the end of this JSON object by counting braces forward
      let end = -1;
      braceCount = 0;

      for (let i = start; i < html.length; i++) {
        if (html[i] === '{') braceCount++;
        if (html[i] === '}') {
          braceCount--;
          if (braceCount === 0) {
            end = i + 1;
            break;
          }
        }
      }

      if (end === -1) return null;

      const jsonStr = html.substring(start, end);
      const json = JSON.parse(jsonStr);

      if (json['@type'] === 'Product') {
        // Clean description: convert <br /> to newlines
        let description = json.description || '';
        description = description.replace(/<br\s*\/?>/gi, '\n');
        description = description.replace(/<[^>]+>/g, ''); // Strip remaining HTML tags

        return {
          title: json.name || '',
          description: description.trim(),
          images: Array.isArray(json.image) ? json.image : (json.image ? [json.image] : []),
          price: json.offers?.price || 0,
          datePosted: json.offers?.datePosted || undefined,
        };
      }

      return null;

    } catch (e) {
      return null;
    }
  }

  // ============================================================================
  // PRIVATE METHODS - BUILDING
  // ============================================================================

  private buildListing(hit: SearchHit, product: ProductData, url: string): any {
    return {
      source: 'immoscout',
      title: product.title || hit.headline,
      description: product.description || null,
      price: hit.primaryPrice || product.price,
      area: hit.primaryArea,
      rooms: hit.numberOfRooms,
      location: hit.addressString,
      url,
      photos: product.images,
      phone: null, // Will be filled if found
      isPrivate: true, // Always true because of URL filter
      rawData: {
        exposeId: hit.exposeId,
        badges: hit.badges || [],
        datePosted: product.datePosted,
      }
    };
  }
}
