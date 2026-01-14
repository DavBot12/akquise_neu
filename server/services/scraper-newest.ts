import axios, { AxiosInstance } from 'axios';
import { load } from 'cheerio';
import { ProxyAgent, fetch as undiciFetch } from 'undici';
import { proxyManager } from './proxy-manager';

/**
 * NEWEST SCRAPER SERVICE
 *
 * Zweck:
 * - Regelmäßiges Scraping der ersten 1-5 Seiten mit sort=1 (neueste zuerst)
 * - Speichert NUR neue Inserate
 * - Keine Updates bei existierenden Listings
 *
 * Abgrenzung:
 * - ScraperV3: Manuell/geplant, tiefer Backfill (viele Seiten), KEIN sort=1
 * - Scraper24/7: Kontinuierlich, alle Seiten bis Ende, standard sort
 * - NewestScraper: Regelmäßig (alle 30 Min), nur erste 1-5 Seiten, sort=1, nur NEUE Inserate
 */

interface NewestScraperOptions {
  intervalMinutes?: number;  // Intervall in Minuten (default: 30)
  maxPages?: number;         // Maximale Seiten pro Kategorie (default: 5)
  onLog?: (msg: string) => void;
  onListingFound?: (listing: any) => Promise<void>;
  onPhoneFound?: (payload: { url: string; phone: string }) => void;
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }
function withJitter(base = 800, jitter = 700) { return base + Math.floor(Math.random() * jitter); }

export class NewestScraperService {
  private isRunning = false;
  private intervalHandle: NodeJS.Timeout | null = null;
  private currentCycle = 0;
  private intervalMinutes = 30; // Store interval for status display
  private nextCycleTime: Date | null = null;
  private axiosInstance: AxiosInstance;
  private sessionCookies = '';
  private requestCount = 0;

  // Smart pagination state - PER CATEGORY (4 states total - ISPRIVATE filter removes need for 2 phases)
  private lastFirstListingIds: Record<string, string | null> = {};
  private currentFirstListingIds: Record<string, string | null> = {};

  // Dual timer system
  private quickCheckIntervalHandle: NodeJS.Timeout | null = null;
  private fullScrapeIntervalHandle: NodeJS.Timeout | null = null;
  private scrapeMutex = false; // Prevent concurrent scrapes

  // Status tracking
  private lastQuickCheckTime: Date | null = null;
  private lastFullScrapeTime: Date | null = null;
  private isQuickCheckRunning = false;
  private isFullScrapeRunning = false;

  // Callback references for timers
  private onLog?: (msg: string) => void;
  private onListingFound?: (listing: any) => Promise<void>;
  private onPhoneFound?: (payload: { url: string; phone: string }) => void;

  // Base URLs mit sort=1 (neueste zuerst) - NO keyword needed, ISPRIVATE filter does the job!
  private readonly baseUrls: Record<string, string> = {
    'eigentumswohnung-wien': 'https://www.willhaben.at/iad/immobilien/eigentumswohnung/eigentumswohnung-angebote?areaId=900&areaId=903&rows=90&sort=1',
    'eigentumswohnung-niederoesterreich': 'https://www.willhaben.at/iad/immobilien/eigentumswohnung/niederoesterreich?rows=90&sort=1',
    'haus-wien': 'https://www.willhaben.at/iad/immobilien/haus-kaufen/wien?rows=90&sort=1',
    'haus-niederoesterreich': 'https://www.willhaben.at/iad/immobilien/haus-kaufen/niederoesterreich?rows=90&sort=1'
  };

  constructor() {
    this.axiosInstance = axios.create({ timeout: 30000, maxRedirects: 5 });
  }

  /**
   * In dev mode: direct connection without proxy
   */
  private async proxyRequest(url: string, options: any = {}): Promise<any> {
    const proxyUrl = proxyManager.getProxyUrl();
    // In dev mode proxyUrl is undefined - use direct connection
    const dispatcher = proxyUrl ? new ProxyAgent(proxyUrl) : undefined;

    const headers: Record<string, string> = {
      'User-Agent': options.headers?.['User-Agent'] || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'de-AT,de;q=0.9,en;q=0.8',
      'DNT': '1',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
      ...options.headers
    };

    if (this.sessionCookies) {
      headers['Cookie'] = this.sessionCookies;
    }

    // Timeout mit AbortController
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    try {
      const fetchOptions: any = {
        headers,
        signal: controller.signal
      };
      if (dispatcher) {
        fetchOptions.dispatcher = dispatcher;
      }

      const response = await undiciFetch(url, fetchOptions);

      clearTimeout(timeoutId);
      const setCookies = response.headers.getSetCookie?.() || [];
      const data = await response.text();

      return {
        data,
        headers: {
          'set-cookie': setCookies
        },
        status: response.status
      };
    } catch (e: any) {
      clearTimeout(timeoutId);
      throw e;
    }
  }

  /**
   * PROXY WITH FALLBACK: Retry logic with direct connection fallback
   * Prevents complete crashes from proxy failures
   */
  private async proxyRequestWithFallback(url: string, options: any = {}): Promise<any> {
    let lastError: any = null;
    const MAX_PROXY_RETRIES = 3;

    for (let attempt = 1; attempt <= MAX_PROXY_RETRIES; attempt++) {
      try {
        // Try with proxy
        return await this.proxyRequest(url, options);
      } catch (error: any) {
        lastError = error;
        this.onLog?.(`[PROXY] Attempt ${attempt}/${MAX_PROXY_RETRIES} failed: ${error?.message || error}`);

        // Rotate to next proxy automatically (handled by proxyManager)
        if (attempt < MAX_PROXY_RETRIES) {
          await sleep(2000 * attempt); // Backoff: 2s, 4s, 6s
        }
      }
    }

    // All proxy attempts failed - try direct connection as last resort
    this.onLog?.('[PROXY] ⚠️ All proxies failed - attempting direct connection...');

    try {
      const response = await this.axiosInstance.get(url, options);
      return {
        data: response.data,
        headers: response.headers,
        status: response.status
      };
    } catch (directError: any) {
      this.onLog?.('[PROXY] ❌ Direct connection also failed');
      throw new Error(
        `All connection methods failed. Last proxy error: ${lastError?.message}, Direct error: ${directError?.message}`
      );
    }
  }

  /**
   * Startet den Newest-Scraper mit DUAL TIMER SYSTEM
   */
  async start(options: NewestScraperOptions = {}): Promise<void> {
    if (this.isRunning) {
      options.onLog?.('[NEWEST] Scraper läuft bereits!');
      return;
    }

    const {
      intervalMinutes = 30,
      onLog,
      onListingFound,
      onPhoneFound
    } = options;

    this.isRunning = true;
    this.intervalMinutes = intervalMinutes;
    this.onLog = onLog;
    this.onListingFound = onListingFound;
    this.onPhoneFound = onPhoneFound;

    onLog?.('[NEWEST] 🚀 GESTARTET - Smart Scraping Strategy');
    onLog?.(`[NEWEST] ⏱️ Quick Check: 2 min | Full Scrape: ${intervalMinutes} min`);

    // Load persisted state for ALL 4 categories
    try {
      this.lastFirstListingIds = await this.loadLastFirstListingIds();

      const totalStates = Object.keys(this.lastFirstListingIds).length;
      onLog?.(`[NEWEST] 📂 Loaded ${totalStates} states (4 total possible):`);
      for (const [category, id] of Object.entries(this.lastFirstListingIds)) {
        onLog?.(`[NEWEST]     - ${category}: ${id || 'none'}`);
      }
    } catch (error: any) {
      onLog?.(`[NEWEST] ⚠️ Could not load state: ${error?.message || error}`);
    }

    // First execution with RETRY LOGIC
    let retries = 0;
    const MAX_RETRIES = 3;

    while (retries < MAX_RETRIES) {
      try {
        await this.runFullScrape();
        onLog?.('[NEWEST] ✅ Initial scrape completed successfully');
        break;
      } catch (error: any) {
        retries++;
        onLog?.(`[NEWEST] ❌ Initial scrape failed (attempt ${retries}/${MAX_RETRIES}): ${error?.message || error}`);

        if (retries < MAX_RETRIES) {
          const waitSeconds = retries * 10; // 10s, 20s, 30s
          onLog?.(`[NEWEST] ⏳ Retrying in ${waitSeconds} seconds...`);
          await sleep(waitSeconds * 1000);
        } else {
          onLog?.('[NEWEST] ⚠️ Max retries reached - continuing with timers (will retry on next cycle)');
        }
      }
    }

    // Start dual timer system
    await this.startQuickCheckTimer(2); // 2 minutes
    await this.startFullScrapeTimer(intervalMinutes); // 30 minutes default

    this.nextCycleTime = new Date(Date.now() + intervalMinutes * 60 * 1000);
    onLog?.('[NEWEST] ⏰ Dual timer system started');
  }

  /**
   * Stoppt den Newest-Scraper (beide Timer!)
   */
  stop(onLog?: (msg: string) => void): void {
    // Clear OLD timer
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }

    // Clear NEW dual timers
    if (this.quickCheckIntervalHandle) {
      clearInterval(this.quickCheckIntervalHandle);
      this.quickCheckIntervalHandle = null;
    }
    if (this.fullScrapeIntervalHandle) {
      clearInterval(this.fullScrapeIntervalHandle);
      this.fullScrapeIntervalHandle = null;
    }

    this.isRunning = false;
    this.scrapeMutex = false; // Release mutex
    onLog?.('[NEWEST] ⛔ GESTOPPT - All timers cleared');
  }

  /**
   * Status-Informationen (erweitert mit Smart Scraping Infos)
   */
  getStatus(): {
    isRunning: boolean;
    currentCycle: number;
    nextCycleTime: string | null;
    lastFirstListingIds: Record<string, string | null>;
    lastQuickCheckTime: string | null;
    lastFullScrapeTime: string | null;
    isQuickCheckRunning: boolean;
    isFullScrapeRunning: boolean;
    scrapeMutex: boolean;
  } {
    return {
      isRunning: this.isRunning,
      currentCycle: this.currentCycle,
      nextCycleTime: this.nextCycleTime ? this.nextCycleTime.toISOString() : null,
      lastFirstListingIds: this.lastFirstListingIds,
      lastQuickCheckTime: this.lastQuickCheckTime ? this.lastQuickCheckTime.toISOString() : null,
      lastFullScrapeTime: this.lastFullScrapeTime ? this.lastFullScrapeTime.toISOString() : null,
      isQuickCheckRunning: this.isQuickCheckRunning,
      isFullScrapeRunning: this.isFullScrapeRunning,
      scrapeMutex: this.scrapeMutex,
    };
  }

  // OLD runCycle method removed - now using runFullScrape() with smart pagination

  /**
   * Scrapt ein Set von URLs (mit oder ohne keyword)
   */
  private async scrapeUrlSet(
    urlSet: Record<string, string>,
    maxPages: number,
    label: string,
    onLog?: (msg: string) => void,
    onListingFound?: (listing: any) => Promise<void>,
    onPhoneFound?: (payload: { url: string; phone: string }) => void
  ): Promise<void> {
    for (const [key, baseUrl] of Object.entries(urlSet)) {
      // Check if stopped
      if (!this.isRunning) {
        onLog?.(`[NEWEST] [${label}] ⛔ Abgebrochen`);
        return;
      }

      onLog?.(`[NEWEST] [${label}] 🔍 ${key}`);

      // Scrape nur die ersten maxPages Seiten
      for (let page = 1; page <= maxPages; page++) {
        // Check if stopped
        if (!this.isRunning) {
          onLog?.(`[NEWEST] [${label}] ⛔ Abgebrochen`);
          return;
        }

        const url = `${baseUrl}&page=${page}`;

        try {
          const headers = {
            'User-Agent': this.getUA(),
            'Referer': page > 1 ? `${baseUrl}&page=${page-1}` : 'https://www.willhaben.at/',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8',
          };

          const res = await this.proxyRequest(url, { headers });
          const html = res.data as string;

          // ULTRA-FAST: Filter URLs by ISPRIVATE=1 from search page
          const { filteredUrls, totalOnPage, privateCount, commercialCount } = this.extractDetailUrlsWithISPRIVATE(html);
          onLog?.(`[NEWEST] [${label}] page ${page}: ${totalOnPage} total → ${privateCount} privat (ISPRIVATE=1), ${commercialCount} kommerziell (ISPRIVATE=0)`);

          // Fetch detail pages ONLY for ISPRIVATE=1 listings
          const isDebug = process.env.DEBUG_SCRAPER === 'true';

          if (isDebug) {
            onLog?.(`[NEWEST] [${label}] 🔄 Processing ${filteredUrls.length} PRIVATE listings...`);
          }

          for (const detailUrl of filteredUrls) {
            // Check if stopped
            if (!this.isRunning) return;

            try {
              if (isDebug) {
                onLog?.(`[NEWEST] [${label}] 🌐 Fetching detail page...`);
              }
              const detail = await this.fetchDetail(detailUrl);
              if (isDebug) {
                onLog?.(`[NEWEST] [${label}] 📝 Parsing detail page (${detail.length} chars)...`);
              }
              const { listing, reason } = this.parseDetailWithReason(detail, detailUrl, key);

              if (!listing) {
                if (isDebug) {
                  onLog?.(`[NEWEST] [${label}] ⏭️ SKIP ${detailUrl.substring(0, 80)}... :: ${reason}`);
                }
              } else {
                // Speichere Listing (Backend prüft ob bereits vorhanden)
                try {
                  if (onListingFound) {
                    if (isDebug) {
                      onLog?.(`[NEWEST] [${label}] 💾 Saving to DB: ${listing.title.substring(0, 40)}...`);
                    }
                    await onListingFound(listing);
                    if (isDebug) {
                      onLog?.(`[NEWEST] [${label}] ✅ SAVED to DB!`);
                    }
                  }
                } catch (e) {
                  // Listing existiert bereits - normal bei Newest Scraper
                  if (isDebug) {
                    onLog?.(`[NEWEST] [${label}] ℹ️ Listing exists (normal)`);
                  }
                }

                // Extrahiere Telefonnummer
                const phone = this.extractPhone(detail);
                if (phone) {
                  if (isDebug) {
                    onLog?.(`[NEWEST] [${label}] 📞 Phone found: ${phone}`);
                  }
                  onPhoneFound?.({ url: detailUrl, phone });
                }

                if (isDebug) {
                  onLog?.(`[NEWEST] [${label}] ✅ COMPLETE: ${listing.category}/${listing.region} :: €${listing.price} :: ${listing.title.substring(0,50)}`);
                }
              }
            } catch (detailError: any) {
              onLog?.(`[NEWEST] [${label}] ❌ ERROR fetching ${detailUrl.substring(0, 60)}... :: ${detailError?.message || detailError}`);
            }

            await sleep(withJitter(60, 120));
          }

        } catch (e: any) {
          onLog?.(`[NEWEST] [${label}] ⚠️ error page ${page}: ${e?.message || e}`);
        }

        await sleep(withJitter(120, 80));
      }
    }
  }

  /**
   * SMART PAGINATION with ISPRIVATE FILTER
   * - Scrape until we reach the first listing from PREVIOUS scrape
   * - Filter out ISPRIVATE=0 (agents) in extractDetailUrls()
   * - This automatically adapts to listing volume (busy times = more pages, quiet = fewer)
   */
  private async scrapeUrlSetSmart(
    urlSet: Record<string, string>,
    label: string,
    onLog?: (msg: string) => void,
    onListingFound?: (listing: any) => Promise<void>,
    onPhoneFound?: (payload: { url: string; phone: string }) => void
  ): Promise<void> {
    const MAX_SAFETY_PAGES = 20; // Safety limit to prevent infinite loops

    for (const [key, baseUrl] of Object.entries(urlSet)) {
      if (!this.isRunning) {
        onLog?.(`[NEWEST] [${label}] ⛔ Abgebrochen`);
        return;
      }

      onLog?.(`[NEWEST] [${label}] 🔍 ${key} - Smart pagination starting`);

      let foundPreviousFirstId = false;
      let pageNumber = 1;

      // Get category-specific state
      const categoryLastFirstId = this.lastFirstListingIds[key];

      while (!foundPreviousFirstId && pageNumber <= MAX_SAFETY_PAGES) {
        if (!this.isRunning) return;

        const url = `${baseUrl}&page=${pageNumber}`;

        try {
          const headers = {
            'User-Agent': this.getUA(),
            'Referer': pageNumber > 1 ? `${baseUrl}&page=${pageNumber-1}` : 'https://www.willhaben.at/',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8',
          };

          const res = await this.proxyRequest(url, { headers });
          const html = res.data as string;

          // ULTRA-FAST: Filter URLs by ISPRIVATE=1 from search page
          const { filteredUrls, totalOnPage, privateCount, commercialCount } = this.extractDetailUrlsWithISPRIVATE(html);

          onLog?.(`[NEWEST] [${label}] page ${pageNumber}: ${totalOnPage} total → ${privateCount} privat (ISPRIVATE=1), ${commercialCount} kommerziell (ISPRIVATE=0)`);

          // Process each PRIVATE listing - FETCH DETAIL PAGE for ALL data
          const isDebug = process.env.DEBUG_SCRAPER === 'true';

          if (isDebug) {
            onLog?.(`[NEWEST] [${label}] 🔄 Processing ${filteredUrls.length} PRIVATE listings...`);
          }

          for (const detailUrl of filteredUrls) {
            if (!this.isRunning) return;

            // Extract listing ID
            const listingId = this.extractListingIdFromUrl(detailUrl);

            if (isDebug) {
              onLog?.(`[NEWEST] [${label}] 📄 Fetching detail: ${listingId} - ${detailUrl.substring(0, 60)}...`);
            }

            // Store first ID on page 1 for THIS CATEGORY (for next scrape)
            if (pageNumber === 1 && !this.currentFirstListingIds[key] && listingId) {
              this.currentFirstListingIds[key] = listingId;
              if (isDebug) {
                onLog?.(`[NEWEST] [${label}] 📌 Current first ID for ${key}: ${listingId}`);
              }
            }

            // Check if we've reached THIS CATEGORY's previous scrape's first ID
            if (categoryLastFirstId && listingId === categoryLastFirstId) {
              foundPreviousFirstId = true;
              onLog?.(`[NEWEST] [${label}] ✅ Reached previous first ID for ${key}: ${listingId} - Stopping pagination`);
              break; // Stop processing this page
            }

            // Fetch detail page for ALL data (photos, m², price, phone, etc.)
            try {
              if (isDebug) {
                onLog?.(`[NEWEST] [${label}] 🌐 Fetching detail page...`);
              }
              const detail = await this.fetchDetail(detailUrl);
              if (isDebug) {
                onLog?.(`[NEWEST] [${label}] 📝 Parsing detail page (${detail.length} chars)...`);
              }
              const { listing, reason } = this.parseDetailWithReason(detail, detailUrl, key);

              if (!listing) {
                if (isDebug) {
                  onLog?.(`[NEWEST] [${label}] ⏭️ SKIP ${detailUrl.substring(0, 80)}... :: ${reason}`);
                }
              } else {
                // Save listing with all data from detail page
                try {
                  if (onListingFound) {
                    if (isDebug) {
                      onLog?.(`[NEWEST] [${label}] 💾 Saving to DB: ${listing.title.substring(0, 40)}...`);
                    }
                    await onListingFound(listing);
                    if (isDebug) {
                      onLog?.(`[NEWEST] [${label}] ✅ SAVED to DB!`);
                    }
                  } else {
                    if (isDebug) {
                      onLog?.(`[NEWEST] [${label}] ⚠️ No onListingFound callback!`);
                    }
                  }
                } catch (e: any) {
                  if (isDebug) {
                    onLog?.(`[NEWEST] [${label}] ℹ️ Listing exists (normal): ${e?.message || 'duplicate'}`);
                  }
                }

                // Extract phone
                const phone = this.extractPhone(detail);
                if (phone) {
                  if (isDebug) {
                    onLog?.(`[NEWEST] [${label}] 📞 Phone found: ${phone}`);
                  }
                  onPhoneFound?.({ url: detailUrl, phone });
                }

                if (isDebug) {
                  onLog?.(`[NEWEST] [${label}] ✅ COMPLETE: ${listing.category}/${listing.region} :: €${listing.price} :: ${listing.title.substring(0,50)}`);
                }
              }
            } catch (detailError: any) {
              onLog?.(`[NEWEST] [${label}] ❌ ERROR fetching ${detailUrl.substring(0, 60)}... :: ${detailError?.message || detailError}`);
            }

            await sleep(withJitter(60, 120));
          }

          if (foundPreviousFirstId) break; // Stop pagination for this category

        } catch (e: any) {
          onLog?.(`[NEWEST] [${label}] ⚠️ error page ${pageNumber}: ${e?.message || e}`);
        }

        pageNumber++;
        await sleep(withJitter(120, 80));
      }

      if (pageNumber > MAX_SAFETY_PAGES) {
        onLog?.(`[NEWEST] [${label}] ⚠️ Hit safety limit of ${MAX_SAFETY_PAGES} pages - may need to adjust`);
      }

      // PERSIST IMMEDIATELY after each category finishes
      const currentId = this.currentFirstListingIds[key];
      if (currentId) {
        await this.persistLastFirstListingId(key, currentId);
        this.lastFirstListingIds[key] = currentId;
        onLog?.(`[${label}] 💾 Saved state for ${key}: ${currentId}`);
      }
    }
  }

  private getUA() {
    const pool = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
    ];
    return pool[Math.floor(Math.random() * pool.length)];
  }

  private async establishSession(onLog?: (m: string) => void) {
    try {
      const res = await this.proxyRequest('https://www.willhaben.at', { headers: { 'User-Agent': this.getUA() } });
      const cookies = res.headers['set-cookie'];
      if (cookies) {
        this.sessionCookies = cookies.map((c: string) => c.split(';')[0]).join('; ');
      }
      onLog?.('[NEWEST] Session established via proxy');
      await sleep(withJitter(1200, 800));
    } catch {
      onLog?.('[NEWEST] Session establish failed; continue');
    }
  }

  /**
   * ULTRA-FAST: Parse ALL listing data directly from search page JSON
   * Returns complete listing objects WITHOUT fetching detail pages!
   *
   * Strategy: Extract ALL JSON attributes once, then build map per listing
   */
  private parseListingsFromSearchPage(html: string, category: string): Array<{
    listing: any;
    needsPhoneFetch: boolean;
    url: string;
  }> {
    const results: Array<{ listing: any; needsPhoneFetch: boolean; url: string }> = [];

    // Extract ALL JSON attributes at once
    const attributePattern = /\{"name":"([^"]+)","values":\["([^"]*)"\]\}/g;
    const allAttributes = Array.from(html.matchAll(attributePattern));

    // Group attributes by listing (every 90 listings, many attributes each)
    // We identify listing boundaries by ADID or ISPRIVATE
    const listingData: Map<number, Map<string, string>> = new Map();
    let currentListingIndex = -1;

    for (const attr of allAttributes) {
      const fieldName = attr[1];
      const fieldValue = attr[2];

      // ADID marks start of new listing
      if (fieldName === 'ADID') {
        currentListingIndex++;
        listingData.set(currentListingIndex, new Map());
      }

      if (currentListingIndex >= 0) {
        const listingMap = listingData.get(currentListingIndex)!;
        listingMap.set(fieldName, fieldValue);
      }
    }

    // Now process each listing
    for (const [_, attrs] of Array.from(listingData.entries())) {
      // SKIP if not ISPRIVATE=1
      if (attrs.get('ISPRIVATE') !== '1') {
        continue;
      }

      // Extract all fields
      const title = attrs.get('HEADING') || '';
      const priceStr = attrs.get('PRICE') || '0';
      const location = attrs.get('LOCATION') || '';
      const bodyDyn = attrs.get('BODY_DYN') || '';
      const seoUrl = attrs.get('SEO_URL') || '';
      const rooms = attrs.get('NUMBER_OF_ROOMS');
      const livingArea = attrs.get('ESTATE_SIZE/LIVING_AREA');
      const published = attrs.get('PUBLISHED');
      const orgName = attrs.get('ORGNAME');
      const coordinates = attrs.get('COORDINATES');

      // Build full URL
      const url = seoUrl.startsWith('http')
        ? seoUrl
        : `https://www.willhaben.at/iad/${seoUrl}`;

      // Parse price
      const price = parseInt(priceStr) || 0;

      // Determine category and region
      const cat = category.includes('haus') ? 'haus' : 'eigentumswohnung';
      const region = category.includes('wien') ? 'wien' : 'niederoesterreich';

      // Create listing object
      const listing = {
        url,
        title,
        price,
        description: bodyDyn,
        category: cat,
        region,
        source: 'willhaben-newest',
        rooms: rooms ? parseInt(rooms) : null,
        living_area: livingArea ? parseFloat(livingArea) : null,
        location,
        coordinates,
        org_name: orgName,
        is_private: true, // We only keep ISPRIVATE=1
      };

      results.push({
        listing,
        needsPhoneFetch: true, // We still need phone from detail page
        url,
      });
    }

    return results;
  }

  /**
   * ULTRA-FAST: Extract detail URLs WITH ISPRIVATE=1 FILTER and stats
   * FIXED: Extract ADID + ISPRIVATE together from JSON blocks (no mismatch!)
   * Returns filtered URLs + statistics for logging
   */
  private extractDetailUrlsWithISPRIVATE(html: string): {
    filteredUrls: string[];
    totalOnPage: number;
    privateCount: number;
    commercialCount: number;
  } {
    const isDebug = process.env.DEBUG_SCRAPER === 'true';

    // ✅ FIXED: Sequential attribute grouping (100% accurate, no neighbor interference)
    const attributePattern = /\{"name":"([^"]+)","values":\["([^"]*)"\]\}/g;
    const allAttributes = Array.from(html.matchAll(attributePattern));

    if (isDebug) {
      console.log(`[ISPRIVATE-DEBUG] Found ${allAttributes.length} total attributes`);
    }

    // Group attributes by listing using ADID as delimiter
    const listingData = new Map<number, Map<string, string>>();
    let currentListingIndex = -1;

    for (const attr of allAttributes) {
      const fieldName = attr[1];
      const fieldValue = attr[2];

      // ADID marks the start of a new listing block
      if (fieldName === 'ADID') {
        currentListingIndex++;
        listingData.set(currentListingIndex, new Map());
      }

      // Add attribute to the current listing
      // ✅ FIX: Only set if not already present (prevents child-unit data from overwriting parent)
      // This fixes the bug where project listings have multiple SEO_URLs and the wrong one gets used
      if (currentListingIndex >= 0) {
        const currentListing = listingData.get(currentListingIndex)!;
        if (!currentListing.has(fieldName)) {
          currentListing.set(fieldName, fieldValue);
        }
      }
    }

    const totalOnPage = listingData.size;
    let isPrivate0 = 0;
    let isPrivate1 = 0;
    const filteredUrls: string[] = [];
    const privateADIDs: string[] = [];

    if (isDebug) {
      console.log(`[ISPRIVATE-DEBUG] Parsed ${totalOnPage} listings`);
    }

    // ✅ Filter and build URLs for ISPRIVATE=1 only
    for (const [_, attrs] of Array.from(listingData.entries())) {
      const isPrivate = attrs.get('ISPRIVATE');
      const adId = attrs.get('ADID');

      if (isPrivate === '0') {
        isPrivate0++;
      } else if (isPrivate === '1') {
        isPrivate1++;
        if (adId) privateADIDs.push(adId);

        // Build URL
        const seoUrl = attrs.get('SEO_URL');
        let url: string;

        if (seoUrl) {
          if (seoUrl.startsWith('http')) {
            url = seoUrl;
          } else {
            let cleanUrl = seoUrl.startsWith('/') ? seoUrl : `/${seoUrl}`;
            // Add /iad/ if missing
            if (!cleanUrl.startsWith('/iad/')) {
              cleanUrl = cleanUrl.replace(/^\//, '/iad/');
            }
            url = `https://www.willhaben.at${cleanUrl}`;
          }
        } else {
          // Fallback: build URL from ADID (generic format)
          url = `https://www.willhaben.at/iad/immobilien/d/immobilie/${adId}`;

          if (isDebug) {
            console.log(`[ISPRIVATE-DEBUG] No SEO_URL for ${adId}, using fallback URL`);
          }
        }

        filteredUrls.push(url);
      }
    }

    if (isDebug) {
      console.log(`[ISPRIVATE-DEBUG] Private (ISPRIVATE=1): ${isPrivate1}`);
      console.log(`[ISPRIVATE-DEBUG] Commercial (ISPRIVATE=0): ${isPrivate0}`);
      console.log(`[ISPRIVATE-DEBUG] Sample private ADIDs:`, privateADIDs.slice(0, 3));
      console.log(`[ISPRIVATE-DEBUG] ✅ Extracted ${filteredUrls.length} private listing URLs`);
      console.log(`[ISPRIVATE-DEBUG] Sample URLs:`, filteredUrls.slice(0, 2).map(u => u.substring(0, 80) + '...'));
    }

    return {
      filteredUrls,
      totalOnPage: totalOnPage,
      privateCount: isPrivate1,
      commercialCount: isPrivate0
    };
  }

  private async fetchDetail(url: string): Promise<string> {
    // Refresh session every 50 requests to avoid stale cookies
    this.requestCount++;
    if (this.requestCount % 50 === 0) {
      await this.establishSession();
    }

    const headers = {
      'User-Agent': this.getUA(),
      'Referer': 'https://www.willhaben.at/iad/immobilien/',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8',
    };
    const res = await this.proxyRequest(url, { headers });
    const newCookies = res.headers['set-cookie'];
    if (newCookies) this.sessionCookies = newCookies.map((c: string) => c.split(';')[0]).join('; ');
    return res.data as string;
  }

  private parseDetailWithReason(html: string, url: string, key: string): { listing: any | null; reason: string } {
    const $ = load(html);
    const bodyText = $('body').text().toLowerCase();

    // ✅ CRITICAL: Verify ISPRIVATE on detail page (Willhaben has inconsistent data!)
    // Search page sometimes shows ISPRIVATE=1 but detail page shows ISPRIVATE=0
    // Detail page is the SOURCE OF TRUTH - ALWAYS double-check here!
    const isPrivateMatch = html.match(/\{"name":"ISPRIVATE","values":\["(\d)"\]\}/);
    const detailISPRIVATE = isPrivateMatch ? isPrivateMatch[1] : null;

    if (detailISPRIVATE === '0') {
      return { listing: null, reason: 'ISPRIVATE=0 on detail page (commercial)' };
    }

    if (!detailISPRIVATE) {
      return { listing: null, reason: 'no ISPRIVATE flag on detail page' };
    }

    // Check for deleted/404 listings
    const description = this.extractDescription($);
    const title = this.extractTitle($);

    if (title && (title.includes('Die Seite wurde nicht gefunden') || title.includes('nicht gefunden'))) {
      return { listing: null, reason: 'listing deleted/not found' };
    }

    if (bodyText.includes('die seite wurde nicht gefunden') || bodyText.includes('seite existiert nicht')) {
      return { listing: null, reason: 'page not found (404)' };
    }

    const price = this.extractPrice($, bodyText);
    if (price <= 0) return { listing: null, reason: 'no price' };
    const areaStr = this.extractArea($, bodyText);
    const area = areaStr ? parseInt(areaStr) : 0;
    const eurPerM2 = area > 0 ? Math.round(price / area) : 0;
    const images = this.extractImages($);

    const region = key.includes('wien') ? 'wien' : 'niederoesterreich';
    const category = key.includes('eigentumswohnung')
      ? 'eigentumswohnung'
      : key.includes('haus')
        ? 'haus'
        : 'grundstueck';

    const locJson = this.extractLocationFromJson(html);
    const location = locJson || this.extractLocation($, url) || (key.includes('wien') ? 'Wien' : 'Niederösterreich');
    const phoneDirect = this.extractPhone(html);
    const lastChangedAt = this.extractLastChanged($, html);

    return {
      listing: {
        title,
        price,
        area: areaStr || null,
        location,
        url,
        images,
        description,
        phone_number: phoneDirect || null,
        category,
        region,
        eur_per_m2: eurPerM2 ? String(eurPerM2) : null,
        akquise_erledigt: false,
        last_changed_at: lastChangedAt,
      },
      reason: 'ok',
    };
  }

  private extractDescription($: ReturnType<typeof load>): string {
    const t = $('[data-testid="ad-detail-ad-description"], [data-testid="object-description-text"]').text().trim();
    if (t && t.length > 30 && !t.includes('{"props"')) return t.substring(0, 1000);
    const all = $('body').text();
    const m = all.match(/Objektbeschreibung[\s:]*\n?\s*([\s\S]{30,1200})/i);
    const desc = m?.[1]?.trim() || '';
    if (desc.includes('{"props"')) return '';
    return desc;
  }

  private extractTitle($: ReturnType<typeof load>): string {
    const sel = ['[data-testid="ad-detail-ad-title"] h1', 'h1'];
    for (const s of sel) { const el = $(s); if (el.length) return el.text().trim(); }
    return '';
  }

  private extractLocationFromJson(html: string): string | '' {
    try {
      const streetMatch = html.match(/"street"\s*:\s*"([^"]{3,80})"/i);
      const postalMatch = html.match(/"postalCode"\s*:\s*"(\d{4})"/i);
      const cityMatch = html.match(/"postalName"\s*:\s*"([^"]{3,80})"/i);
      if (postalMatch && (streetMatch || cityMatch)) {
        const street = streetMatch ? streetMatch[1] : '';
        const city = cityMatch ? cityMatch[1] : '';
        const formatted = `${postalMatch[1]} ${city}${street ? ", " + street : ''}`.trim();
        if (formatted.length > 6) return formatted;
      }
      return '';
    } catch {
      return '';
    }
  }

  private extractPrice($: ReturnType<typeof load>, bodyText: string): number {
    const cand = $('span:contains("€"), div:contains("Kaufpreis"), [data-testid*="price"]').text();

    // ✅ PRIORITY 1: JSON PRICE attribute (most reliable!)
    const jsonPrice = bodyText.match(/"PRICE","values":\["(\d+)"\]/);
    if (jsonPrice) {
      const v = parseInt(jsonPrice[1]);
      if (v >= 50000 && v <= 99999999) return v;
    }

    // ✅ PRIORITY 2: Support prices up to 99M (XX.XXX.XXX format like € 2.600.000)
    const m1Million = cand.match(/€\s*(\d{1,2})\.(\d{3})\.(\d{3})/);
    if (m1Million) {
      const v = parseInt(m1Million[1] + m1Million[2] + m1Million[3]);
      if (v >= 50000 && v <= 99999999) return v;
    }
    const m2Million = bodyText.match(/€\s*(\d{1,2})\.(\d{3})\.(\d{3})/);
    if (m2Million) {
      const v = parseInt(m2Million[1] + m2Million[2] + m2Million[3]);
      if (v >= 50000 && v <= 99999999) return v;
    }

    // Fallback: Prices under 1M (€ XXX.XXX format)
    const m1 = cand.match(/€\s*(\d{1,3})\.(\d{3})/);
    if (m1) { const v = parseInt(m1[1] + m1[2]); if (v >= 50000 && v <= 9999999) return v; }
    const m2 = bodyText.match(/€\s*(\d{1,3})\.(\d{3})/);
    if (m2) { const v = parseInt(m2[1] + m2[2]); if (v >= 50000 && v <= 9999999) return v; }
    const digits = (bodyText.match(/(\d{3}\.\d{3})/g) || []).map(x => parseInt(x.replace('.', ''))).find(v => v >= 50000 && v <= 9999999);
    return digits || 0;
  }

  private extractArea($: ReturnType<typeof load>, bodyText: string): string | '' {
    const m1 = $('span:contains("m²"), div:contains("Wohnfläche")').text().match(/(\d{1,4})\s*m²/i);
    if (m1) return m1[1];
    const m2 = bodyText.match(/(\d{1,3})\s*m²/i);
    return m2?.[1] || '';
  }

  private extractImages($: ReturnType<typeof load>): string[] {
    const images: string[] = [];
    $('img[src*="cache.willhaben.at"]').each((_, el) => { const src = $(el).attr('src'); if (src && !src.includes('_thumb')) images.push(src); });
    const html = $.html();
    (html.match(/https:\/\/cache\.willhaben\.at\/mmo\/[^"'\s]+\.jpg/gi) || []).forEach(u => { if (!u.includes('_thumb')) images.push(u); });
    return Array.from(new Set(images)).slice(0, 10);
  }

  private extractLocation($: ReturnType<typeof load>, url: string): string {
    const el = $('[data-testid="ad-detail-ad-location"]').text().trim();
    if (el && el.length > 5) return el;

    const header = $('h2:contains("Objektstandort"), div:contains("Objektstandort")').first();
    if (header.length) {
      const next = header.next();
      const txt = (next.text() || header.parent().text() || '').trim();
      if (txt && txt.length > 5) return txt.replace(/\s+/g, ' ');
    }

    const m = url.match(/wien-(\d{4})-([^\/]+)/i);
    if (m) return `${m[1]} Wien, ${m[2].replace(/-/g, ' ')}`;

    const body = $('body').text();
    const street = body.match(/\b([A-ZÄÖÜ][a-zäöüß]+(?:gasse|straße|strasse|platz|allee|ring))\b[^\n,]*/);
    if (street) return street[0].trim().substring(0, 100);

    return '';
  }

  private extractLastChanged($: ReturnType<typeof load>, html: string): Date | null {
    try {
      // Methode 1: Suche im DOM via Cheerio mit data-testid
      const editDateEl = $('[data-testid="ad-detail-ad-edit-date-top"]').text();
      if (editDateEl) {
        // Format: "Zuletzt geändert: 07.01.2026, 16:11 Uhr"
        const match = editDateEl.match(/(\d{2})\.(\d{2})\.(\d{4}),\s*(\d{2}):(\d{2})/);
        if (match) {
          const [, day, month, year, hour, minute] = match;
          // Create date in local timezone (Vienna)
          const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day), parseInt(hour), parseInt(minute));
          return date;
        }
      }

      // Methode 2: Regex fallback im gesamten HTML
      const regexMatch = html.match(/Zuletzt geändert:\s*<!--\s*-->(\d{2})\.(\d{2})\.(\d{4}),\s*(\d{2}):(\d{2})\s*Uhr/);
      if (regexMatch) {
        const [, day, month, year, hour, minute] = regexMatch;
        const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day), parseInt(hour), parseInt(minute));
        return date;
      }

      return null;
    } catch (e) {
      return null;
    }
  }

  private extractPhone(html: string): string | null {
    const $ = load(html);
    const isDebug = process.env.DEBUG_SCRAPER === 'true';

    const normalize = (s: string) => s.replace(/[^+\d]/g, '');
    const score = (n: string) => (n.startsWith('+43') ? 3 : 0) + (n.startsWith('06') ? 2 : 0) + (n.length >= 10 ? 1 : 0);
    const blocked = new Set([
      '0606891308',
      '0667891221',
      '0674400169',
      '078354969801',
      '4378354969801',
      '+4378354969801',
      '43667891221',
      '+43667891221'
    ]);
    const isBlocked = (raw: string) => {
      const d = raw.replace(/[\s\+\-\(\)\/]/g, '');
      const alt = d.replace(/^0/, '+43');
      const bare = d.replace(/^\+43/, '0');

      if (isDebug && blocked.has(d)) {
        console.log(`[PHONE-DEBUG] Blocked number: ${raw} → ${d}`);
      }

      return blocked.has(d) || blocked.has(alt) || blocked.has(bare);
    };

    const directNums: string[] = [];

    // PRIORITY 1: JSON patterns (David's Goldfund!)
    // Pattern 1: {"name":"CONTACT/PHONE","values":["06509903513"]}
    const contactPhonePattern = /\{"name":"CONTACT\/PHONE","values":\["([^"]+)"\]\}/g;
    const contactPhoneMatches = Array.from(html.matchAll(contactPhonePattern));

    if (isDebug) {
      console.log(`[PHONE-DEBUG] CONTACT/PHONE matches: ${contactPhoneMatches.length}`);
    }

    for (const match of contactPhoneMatches) {
      const phone = match[1];
      if (phone && phone.length > 0) {
        directNums.push(phone);
        if (isDebug) {
          console.log(`[PHONE-DEBUG] Found via CONTACT/PHONE: ${phone}`);
        }
      }
    }

    // Pattern 2: [{"id":"phoneNo","description":"Telefon","value":"06509903513"}]
    const phoneNoPattern = /\{"id":"phoneNo","description":"Telefon","value":"([^"]+)"\}/g;
    const phoneNoMatches = Array.from(html.matchAll(phoneNoPattern));

    if (isDebug) {
      console.log(`[PHONE-DEBUG] phoneNo matches: ${phoneNoMatches.length}`);
    }

    for (const match of phoneNoMatches) {
      const phone = match[1];
      if (phone && phone.length > 0) {
        directNums.push(phone);
        if (isDebug) {
          console.log(`[PHONE-DEBUG] Found via phoneNo: ${phone}`);
        }
      }
    }

    // Pattern 3: {"name":"PHONE_NUMBER","values":["..."]} (fallback)
    const phoneNumberPattern = /\{"name":"PHONE_NUMBER","values":\["([^"]+)"\]\}/g;
    const phoneNumberMatches = Array.from(html.matchAll(phoneNumberPattern));

    for (const match of phoneNumberMatches) {
      const phone = match[1];
      if (phone && phone.length > 0) {
        directNums.push(phone);
        if (isDebug) {
          console.log(`[PHONE-DEBUG] Found via PHONE_NUMBER: ${phone}`);
        }
      }
    }

    // PRIORITY 2: Direct HTML links and elements
    $('a[href^="tel:"]').each((_, a) => {
      const href = $(a).attr('href') || '';
      const txt = $(a).text() || '';
      if (href) directNums.push(href.replace(/^tel:/i, ''));
      if (txt) directNums.push(txt);
    });
    $('[data-testid="top-contact-box-phone-number-virtual"], [data-testid="contact-box-phone-number-virtual"]').each((_, el) => {
      const t = $(el).text();
      if (t) directNums.push(t);
    });
    const normalizedDirect = directNums.map(normalize).filter(n => n.length >= 8 && !isBlocked(n));

    if (isDebug) {
      console.log(`[PHONE-DEBUG] Total candidates from JSON/HTML: ${directNums.length}`);
      console.log(`[PHONE-DEBUG] After normalization and filtering: ${normalizedDirect.length}`);
    }

    if (normalizedDirect.length > 0) {
      const best = normalizedDirect.map(n => ({ n: n.startsWith('43') ? `+${n}` : n, s: score(n) })).sort((a, b) => b.s - a.s)[0];
      if (best?.n) {
        if (isDebug) {
          console.log(`[PHONE-DEBUG] ✅ Returning best phone from ${normalizedDirect.length} candidates: ${best.n}`);
        }
        return best.n;
      }
    }

    // DOM-near extraction
    let domNumber: string | null = null;
    $('*:contains("Telefon")').each((_, el) => {
      const text = $(el).text().trim();
      if (!/^Telefon/i.test(text)) return;
      const matchSame = text.match(/Telefon\s*([+\d\s\-()\/]{8,20})/i);
      if (matchSame && matchSame[1]) {
        domNumber = matchSame[1];
        return false as any;
      }
      const nextText = ($(el).next().text() || '') + ' ' + ($(el).parent().text() || '');
      const matchNext = nextText.match(/([+\d\s\-()\/]{8,20})/);
      if (matchNext && matchNext[1]) {
        domNumber = matchNext[1];
        return false as any;
      }
    });

    if (domNumber) {
      const n = normalize(domNumber);
      if (n.length >= 8) return n.startsWith('43') ? `+${n}` : n;
    }

    // Fallback regex
    const htmlNoScripts = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ');
    const candidateRegex = /(?:(?:\+43|0043|43|0)\s*)6[5-9]\s*[\d\s\-/()]{7,12}/g;
    const candidates = (htmlNoScripts.match(candidateRegex) || []).map(normalize).filter(n => n.length >= 8 && !isBlocked(n));
    if (candidates.length === 0) return null;
    const best = candidates.map(n => ({ n: n.startsWith('43') ? `+${n}` : n, s: score(n) })).sort((a, b) => b.s - a.s)[0];
    return best?.n || null;
  }

  /**
   * QUICK CHECK: Lightweight check of first page only
   * Returns true if first listing ID has changed (new listings available)
   */
  private async quickCheck(): Promise<boolean> {
    try {
      // Check first category's first page (eigentumswohnung-wien)
      const categoryKey = 'eigentumswohnung-wien';
      const baseUrl = this.baseUrls[categoryKey];
      const url = `${baseUrl}&page=1`;

      const headers = {
        'User-Agent': this.getUA(),
        'Referer': 'https://www.willhaben.at/',
      };

      const res = await this.proxyRequest(url, { headers });
      const html = res.data as string;

      // Extract first listing ID (use ISPRIVATE filter)
      const { filteredUrls } = this.extractDetailUrlsWithISPRIVATE(html);
      if (filteredUrls.length === 0) {
        this.onLog?.('[QUICK-CHECK] No private listings found on first page');
        return false;
      }

      const firstListingId = this.extractListingIdFromUrl(filteredUrls[0]);
      const categoryLastFirstId = this.lastFirstListingIds[categoryKey];

      if (!categoryLastFirstId) {
        // First run ever - no comparison possible
        this.onLog?.(`[QUICK-CHECK] First run for ${categoryKey} - storing ID: ${firstListingId}`);
        return false;
      }

      const hasChanged = firstListingId !== categoryLastFirstId;

      this.onLog?.(`[QUICK-CHECK] ${categoryKey} - Current: ${firstListingId} | Last: ${categoryLastFirstId} | Changed: ${hasChanged}`);

      return hasChanged;
    } catch (error: any) {
      this.onLog?.(`[QUICK-CHECK] Error: ${error?.message || error}`);
      return false; // Don't trigger scrape on error
    }
  }

  /**
   * DUAL TIMER SYSTEM: Quick check timer (runs every 2-3 minutes)
   */
  private async performQuickCheck(): Promise<void> {
    if (this.scrapeMutex || !this.isRunning) {
      this.onLog?.('[QUICK-CHECK] Skipped - scrape in progress or not running');
      return;
    }

    this.isQuickCheckRunning = true;
    this.lastQuickCheckTime = new Date();

    try {
      const hasNewListings = await this.quickCheck();

      if (hasNewListings) {
        this.onLog?.('[QUICK-CHECK] ✨ New listings detected! Triggering full scrape...');
        await this.runFullScrape();
      } else {
        this.onLog?.('[QUICK-CHECK] ✅ No new listings - all clear');
      }
    } catch (error: any) {
      this.onLog?.(`[QUICK-CHECK] ❌ Error: ${error?.message || error}`);
    } finally {
      this.isQuickCheckRunning = false;
    }
  }

  /**
   * Start quick check timer
   */
  private async startQuickCheckTimer(intervalMinutes = 2): Promise<void> {
    // Initial quick check after 30 seconds (let full scrape finish first)
    setTimeout(async () => {
      await this.performQuickCheck();
    }, 30000);

    // Then regular interval
    this.quickCheckIntervalHandle = setInterval(async () => {
      await this.performQuickCheck();
    }, intervalMinutes * 60 * 1000);
  }

  /**
   * DUAL TIMER SYSTEM: Full scrape execution with mutex protection
   */
  private async runFullScrape(): Promise<void> {
    // Mutex check - prevent concurrent scrapes
    if (this.scrapeMutex) {
      this.onLog?.('[FULL-SCRAPE] Skipped - another scrape in progress');
      return;
    }

    this.scrapeMutex = true;
    this.isFullScrapeRunning = true;
    this.lastFullScrapeTime = new Date();

    try {
      this.currentCycle++;
      this.onLog?.(`[FULL-SCRAPE] ━━━ CYCLE #${this.currentCycle} START ━━━`);

      await this.establishSession(this.onLog);

      // Use smart pagination if we have ANY previous first IDs, otherwise use old method
      const hasAnyState = Object.values(this.lastFirstListingIds).some(id => id !== null);

      if (hasAnyState) {
        // Smart pagination with ISPRIVATE filter
        await this.scrapeUrlSetSmart(
          this.baseUrls,
          'ISPRIVATE=1',
          this.onLog,
          this.onListingFound,
          this.onPhoneFound
        );
      } else {
        // First run - use old method with fixed pages
        this.onLog?.('[FULL-SCRAPE] First run - establishing baseline (fixed 5 pages)');
        await this.scrapeUrlSet(this.baseUrls, 5, 'FIRST-RUN', this.onLog, this.onListingFound, this.onPhoneFound);
      }

      // Reset current IDs for next scrape (states are already persisted per category)
      this.currentFirstListingIds = {};

      this.onLog?.(`[FULL-SCRAPE] ✅ CYCLE #${this.currentCycle} COMPLETE`);
    } catch (error: any) {
      this.onLog?.(`[FULL-SCRAPE] ❌ ERROR: ${error?.message || error}`);
    } finally {
      this.scrapeMutex = false;
      this.isFullScrapeRunning = false;
    }
  }

  /**
   * Start full scrape timer (guaranteed scrape every N minutes)
   */
  private async startFullScrapeTimer(intervalMinutes = 30): Promise<void> {
    this.fullScrapeIntervalHandle = setInterval(async () => {
      await this.runFullScrape();
    }, intervalMinutes * 60 * 1000);
  }

  /**
   * HELPER: Extract listing ID from URL
   * URL format: https://www.willhaben.at/iad/immobilien/d/eigentumswohnung/wien/wien-1150-rudolfsheim/titel-1961300544
   * Returns: "1961300544"
   */
  private extractListingIdFromUrl(url: string): string | null {
    // Willhaben format: ID comes at the end after hyphen (e.g., titel-1234567890)

    // Try format 1: ID at the very end after hyphen
    let match = url.match(/-(\d{8,})(?:[\/\?#]|$)/);
    if (match) return match[1];

    // Try format 2: ID as last segment after slash
    match = url.match(/\/(\d{8,})(?:[\/\?#]|$)/);
    if (match) return match[1];

    // Fallback: extract last segment and check if it's all digits
    const segments = url.split(/[\/\?#]/).filter(s => s.length > 0);
    const lastSegment = segments[segments.length - 1];
    if (/^\d{8,}$/.test(lastSegment)) {
      return lastSegment;
    }

    return null;
  }

  /**
   * STATE PERSISTENCE: Save last first listing ID to database (PER CATEGORY)
   */
  private async persistLastFirstListingId(category: string, listingId: string): Promise<void> {
    try {
      const { db } = await import('../db');
      const { scraper_state } = await import('../../shared/schema');

      // Create category-specific state key (no phase needed - ISPRIVATE filter handles it)
      const stateKey = `newest-scraper-isprivate-${category}`;

      await db
        .insert(scraper_state)
        .values({
          state_key: stateKey,
          next_page: 0,
          state_value: listingId
        })
        .onConflictDoUpdate({
          target: scraper_state.state_key,
          set: {
            state_value: listingId,
            updated_at: new Date()
          }
        });

      this.onLog?.(`[STATE] 💾 Persisted ${category}: ${listingId}`);
    } catch (error) {
      this.onLog?.(`[STATE] ⚠️ Error persisting ${category}: ${error}`);
    }
  }

  /**
   * STATE PERSISTENCE: Load last first listing IDs from database (4 categories)
   */
  private async loadLastFirstListingIds(): Promise<Record<string, string | null>> {
    try {
      const { db } = await import('../db');
      const { scraper_state } = await import('../../shared/schema');
      const { like } = await import('drizzle-orm');

      const rows = await db
        .select()
        .from(scraper_state)
        .where(like(scraper_state.state_key, 'newest-scraper-isprivate-%'));

      const states: Record<string, string | null> = {};

      for (const row of rows) {
        // Extract category from state_key: 'newest-scraper-isprivate-eigentumswohnung-wien' -> 'eigentumswohnung-wien'
        const category = row.state_key.replace('newest-scraper-isprivate-', '');
        states[category] = row.state_value || null;
      }

      return states;
    } catch (error) {
      this.onLog?.(`[STATE] ⚠️ Error loading states: ${error}`);
      return {};
    }
  }
}
