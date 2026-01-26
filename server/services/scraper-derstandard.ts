/**
 * DerStandard Scraper Service
 * Scrapes private real estate listings from immobilien.derstandard.at
 *
 * Key Features:
 * - DataLayer-based extraction (JavaScript instead of DOM)
 * - 6-stage filter pipeline for private vs commercial detection
 * - Session management with cookie refresh every 50 requests
 * - Optimized performance: 60-120ms delays (vs 1-2s in old scraper)
 * - Pagination state persistence
 */

import { load } from 'cheerio';
import { storage } from '../storage';
import {
  proxyRequest,
  sleep,
  withJitter,
  rotateUserAgent,
  extractPhoneFromHtml,
  type ProxyRequestResponse
} from './scraper-utils';
import type { InsertListing } from '@shared/schema';

// ============================================
// INTERFACES
// ============================================

export interface DerStandardScraperOptions {
  intervalMinutes?: number;
  maxPages?: number;
  categories?: string[]; // Optional: filter which categories to scrape
  onLog?: (msg: string) => void;
  onListingFound?: (listing: InsertListing) => Promise<void>;
  onPhoneFound?: (payload: { url: string; phone: string }) => void;
}

interface DataLayerProps {
  company: string | null;
  type: string | null;
  title: string | null;
  price: string | null;
  size: string | null;
  rooms: string | null;
  location: string | null;
  plz: string | null;
  rentBuy: string | null;
}

interface FilterResult {
  allowed: boolean;
  reason: string;
  confidence: 'high' | 'medium' | 'low';
}

// ============================================
// MAIN SCRAPER SERVICE
// ============================================

export class DerStandardScraperService {
  private isRunning = false;
  private intervalHandle: NodeJS.Timeout | null = null;
  private currentCycle = 0;
  private processedUrls = new Set<string>();
  private sessionCookies = '';
  private requestCount = 0;

  private baseUrls: Record<string, string> = {
    // Nur KAUFEN - Miete ist rausgenommen
    'wien-kaufen-wohnung': 'https://immobilien.derstandard.at/suche/wien/kaufen-wohnung',
    'noe-kaufen-wohnung': 'https://immobilien.derstandard.at/suche/niederoesterreich/kaufen-wohnung',
    'noe-kaufen-haus': 'https://immobilien.derstandard.at/suche/niederoesterreich/kaufen-haus'
  };

  // ============================================
  // PUBLIC METHODS
  // ============================================

  async start(options: DerStandardScraperOptions = {}): Promise<void> {
    if (this.isRunning) {
      options.onLog?.('⚠️ DerStandard scraper is already running');
      return;
    }

    this.isRunning = true;
    const intervalMinutes = options.intervalMinutes ?? 30; // Use 30 as default, but allow 0 for one-time

    options.onLog?.('🚀 DerStandard scraper started');
    if (intervalMinutes === 0) {
      options.onLog?.(`⏱️ One-time manual execution | Max pages: ${options.maxPages || 3}`);
    } else {
      options.onLog?.(`⏱️ Interval: ${intervalMinutes} min | Max pages: ${options.maxPages || 3}`);
    }

    // Run first cycle immediately
    await this.runCycle(options);

    // Schedule recurring cycles only if intervalMinutes > 0
    if (intervalMinutes > 0) {
      this.intervalHandle = setInterval(async () => {
        if (this.isRunning) {
          await this.runCycle(options);
        }
      }, intervalMinutes * 60 * 1000);
    } else {
      // One-time execution - stop after first cycle
      this.isRunning = false;
      options.onLog?.('✅ DerStandard one-time scrape completed');
    }
  }

  stop(onLog?: (msg: string) => void): void {
    if (!this.isRunning) {
      onLog?.('⚠️ DerStandard scraper is not running');
      return;
    }

    this.isRunning = false;
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }

    onLog?.('🛑 DerStandard scraper stopped');
  }

  getStatus(): { isRunning: boolean; currentCycle: number } {
    return {
      isRunning: this.isRunning,
      currentCycle: this.currentCycle
    };
  }

  // ============================================
  // PRIVATE: LIFECYCLE
  // ============================================

  private async runCycle(options: DerStandardScraperOptions): Promise<void> {
    this.currentCycle++;
    const maxPages = options.maxPages || 3;
    const startTime = Date.now();

    options.onLog?.(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    options.onLog?.(`📊 Cycle #${this.currentCycle} started`);
    options.onLog?.(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

    // Establish session before starting
    await this.establishSession(options.onLog);

    let totalListingsFound = 0;
    let totalListingsBlocked = 0;
    let totalDetailUrlsExtracted = 0;

    // Filter baseUrls by selected categories if provided
    const categoriesToProcess = options.categories && options.categories.length > 0
      ? Object.entries(this.baseUrls).filter(([key]) => options.categories!.includes(key))
      : Object.entries(this.baseUrls);

    options.onLog?.(`📋 Processing ${categoriesToProcess.length} categories: ${categoriesToProcess.map(([k]) => k).join(', ')}`);

    // Process each category
    for (const [key, baseUrl] of categoriesToProcess) {
      options.onLog?.(`\n📂 Category: ${key}`);

      // Load saved page from DB
      const startPage = await storage.getScraperNextPage(`derstandard-${key}`, 1);
      options.onLog?.(`   Starting from page: ${startPage}`);

      for (let page = startPage; page <= maxPages; page++) {
        options.onLog?.(`\n   📄 Page ${page}/${maxPages}`);

        // Fetch search page
        const searchUrl = page === 1 ? baseUrl : `${baseUrl}?p=${page}`;
        let html: string;
        try {
          html = await this.fetchPage(searchUrl, options.onLog);
        } catch (error: any) {
          options.onLog?.(`   ❌ Failed to fetch search page: ${error.message}`);
          continue;
        }

        // Extract detail URLs
        const detailUrls = this.extractDetailUrls(html);
        options.onLog?.(`   ✅ Found ${detailUrls.length} listings on page`);
        totalDetailUrlsExtracted += detailUrls.length;

        if (detailUrls.length === 0) {
          options.onLog?.(`   ⚠️ No listings found, stopping category`);
          break;
        }

        // Process each detail URL
        let pageListingsFound = 0;
        let pageListingsBlocked = 0;
        let pageListingsSkipped = 0;

        for (const detailUrl of detailUrls) {
          // Check if already in database (skip only if already saved)
          const existing = await storage.getListingByUrl(detailUrl);
          if (existing) {
            // Update last seen
            await storage.updateListingOnRescrape(detailUrl, { scraped_at: new Date() });
            pageListingsSkipped++;
            continue;
          }

          // Fetch detail page (axios is 20x faster than Playwright!)
          let detailHtml: string;
          try {
            detailHtml = await this.fetchPage(detailUrl, options.onLog);
          } catch (error: any) {
            options.onLog?.(`   ❌ Failed to fetch detail: ${error.message}`);
            await sleep(withJitter(60, 60));
            continue;
          }

          // Parse and filter listing
          const result = this.parseDetailPageWithReason(detailHtml, detailUrl, key);

          if (result.listing) {
            pageListingsFound++;
            totalListingsFound++;

            // Save to database
            if (options.onListingFound) {
              await options.onListingFound(result.listing);
            } else {
              await storage.createListing(result.listing);
            }

            options.onLog?.(`   ✅ SAVED: ${result.listing.title?.substring(0, 60)} | ${result.reason}`);

            // Try to extract phone
            if (options.onPhoneFound) {
              const $ = load(detailHtml);
              const phone = extractPhoneFromHtml(detailHtml, $);
              if (phone) {
                options.onPhoneFound({ url: detailUrl, phone });
                options.onLog?.(`      📞 Phone found: ${phone}`);
              }
            }
          } else {
            pageListingsBlocked++;
            totalListingsBlocked++;
            // Debug: Log blocked listings in development
            if (process.env.NODE_ENV === 'development') {
              options.onLog?.(`   ❌ BLOCKED: ${result.reason} | ${detailUrl.substring(0, 80)}`);
            }
          }

          // Small delay between detail pages (10ms ± 10ms for testing)
          await sleep(withJitter(10, 10));
        }

        options.onLog?.(`   📊 Page results: ${pageListingsFound} saved, ${pageListingsBlocked} blocked, ${pageListingsSkipped} skipped (already in DB)`);

        // Save page progress to DB
        await storage.setScraperNextPage(`derstandard-${key}`, page + 1);

        // Delay between pages (50ms ± 50ms for testing)
        await sleep(withJitter(50, 50));
      }

      // Reset page to 1 (cycle complete)
      await storage.setScraperNextPage(`derstandard-${key}`, 1);
      options.onLog?.(`   ✅ Category complete, reset to page 1`);
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    options.onLog?.(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    options.onLog?.(`✅ Cycle #${this.currentCycle} complete in ${duration}s`);
    options.onLog?.(`📊 Stats:`);
    options.onLog?.(`   - Detail URLs extracted: ${totalDetailUrlsExtracted}`);
    options.onLog?.(`   - Listings saved: ${totalListingsFound}`);
    options.onLog?.(`   - Listings blocked: ${totalListingsBlocked}`);
    options.onLog?.(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
  }

  private async establishSession(onLog?: (msg: string) => void): Promise<void> {
    try {
      const res = await proxyRequest(
        'https://immobilien.derstandard.at/',
        '',
        {
          headers: { 'User-Agent': rotateUserAgent() },
          timeout: 30000
        }
      );

      if (res.headers['set-cookie'] && res.headers['set-cookie'].length > 0) {
        this.sessionCookies = res.headers['set-cookie']
          .map((c: string) => c.split(';')[0])
          .join('; ');
        onLog?.(`🔐 Session established (${this.sessionCookies.split(';').length} cookies)`);
      }
    } catch (error: any) {
      onLog?.(`⚠️ Session establishment failed: ${error.message}`);
    }
  }

  // ============================================
  // PRIVATE: FETCHING
  // ============================================

  private async fetchPage(url: string, onLog?: (msg: string) => void): Promise<string> {
    this.requestCount++;

    // Refresh session every 50 requests
    if (this.requestCount % 50 === 0) {
      onLog?.(`🔄 Refreshing session (${this.requestCount} requests)`);
      await this.establishSession(onLog);
    }

    const res: ProxyRequestResponse = await proxyRequest(url, this.sessionCookies, {
      headers: {
        'User-Agent': rotateUserAgent(),
        'Referer': 'https://immobilien.derstandard.at/suche/',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      },
      timeout: 30000
    });

    // Update session cookies if server sends new ones
    if (res.headers['set-cookie'] && res.headers['set-cookie'].length > 0) {
      this.sessionCookies = res.headers['set-cookie']
        .map((c: string) => c.split(';')[0])
        .join('; ');
    }

    return res.data as string;
  }


  // ============================================
  // PRIVATE: EXTRACTION
  // ============================================

  private extractDetailUrls(html: string): string[] {
    const $ = load(html);
    const urls: string[] = [];

    $('a[href*="/detail/"]').each((_, el) => {
      const href = $(el).attr('href');
      if (href) {
        const fullUrl = href.startsWith('http')
          ? href
          : `https://immobilien.derstandard.at${href.startsWith('/') ? '' : '/'}${href}`;

        // FILTER: Skip Neubau URLs - they don't have propertyData JSON
        if (fullUrl.includes('/immobiliensuche/neubau/detail/')) {
          return; // Skip this iteration
        }

        urls.push(fullUrl);
      }
    });

    // Unique URLs only
    return Array.from(new Set(urls));
  }

  /**
   * Extract JSON data from Next.js script tag
   * DerStandard uses: self.__next_f.push([1, "{...propertyData...}"])
   */
  private extractNextData(html: string): any | null {
    try {
      // Find ALL __next_f.push statements
      // Pattern must handle escaped quotes: \" inside the string
      // Use: (?:[^"\\]|\\.)* which means: (non-quote-non-backslash OR backslash-followed-by-anything)*
      const pattern = /self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g;
      const matches = html.matchAll(pattern);

      // Find the one that contains propertyData
      let jsonStr: string | null = null;
      for (const match of matches) {
        if (match[1] && match[1].includes('propertyData')) {
          jsonStr = match[1];
          break;
        }
      }

      if (!jsonStr) {
        if (process.env.NODE_ENV === 'development') {
          console.log('[DEBUG] No __next_f.push with propertyData found in HTML');
        }
        return null;
      }

      // The content is escaped JSON - we need to unescape it

      // Unescape common patterns
      jsonStr = jsonStr.replace(/\\"/g, '"');  // \" → "
      jsonStr = jsonStr.replace(/\\\\/g, '\\'); // \\ → \

      // The structure is: [["$","$L52",null,{}],["$","$L53",null,{"propertyData":{...}}]]
      // We need to extract the propertyData object

      // Find propertyData in the unescaped string
      const propertyDataIdx = jsonStr.indexOf('"propertyData":');
      if (propertyDataIdx === -1) {
        if (process.env.NODE_ENV === 'development') {
          console.log('[DEBUG] No propertyData found in JSON');
        }
        return null;
      }

      // Extract from propertyData onwards
      const fromPropertyData = jsonStr.substring(propertyDataIdx);

      // Find the opening brace after propertyData:
      const openBraceIdx = fromPropertyData.indexOf('{');
      if (openBraceIdx === -1) return null;

      // Count braces to find the matching closing brace
      let braceCount = 0;
      let closeBraceIdx = -1;
      for (let i = openBraceIdx; i < fromPropertyData.length; i++) {
        if (fromPropertyData[i] === '{') braceCount++;
        if (fromPropertyData[i] === '}') {
          braceCount--;
          if (braceCount === 0) {
            closeBraceIdx = i + 1;
            break;
          }
        }
      }

      if (closeBraceIdx === -1) return null;

      const propertyDataJson = fromPropertyData.substring(openBraceIdx, closeBraceIdx);

      // Parse the JSON
      const data = JSON.parse(propertyDataJson);

      if (process.env.NODE_ENV === 'development') {
        console.log('[DEBUG] Successfully parsed propertyData JSON');
        console.log('[DEBUG] Has metaData:', !!data.metaData);
        console.log('[DEBUG] Has property:', !!data.property);
        console.log('[DEBUG] isPrivateAd:', data.metaData?.isPrivateAd);
      }

      return data;
    } catch (error: any) {
      if (process.env.NODE_ENV === 'development') {
        console.log('[DEBUG] Error extracting Next data:', error.message);
      }
      return null;
    }
  }

  private extractAllDataLayerProps(html: string): DataLayerProps {
    const nextData = this.extractNextData(html);

    if (!nextData) {
      // Fallback to empty
      return {
        company: null,
        type: null,
        title: null,
        price: null,
        size: null,
        rooms: null,
        location: null,
        plz: null,
        rentBuy: null
      };
    }

    // Extract from the structured JSON
    const advertiser = nextData.advertiser;
    const property = nextData.property;
    const metaData = nextData.metaData;

    // Get company name
    const company = advertiser?.company?.name || advertiser?.contactPerson?.companyName || null;

    // Get type from metaData (isPrivateAd is the key field!)
    const isPrivate = metaData?.isPrivateAd;
    const type = isPrivate === true ? 'Private' : isPrivate === false ? 'Commercial' : null;

    // Get title
    const title = nextData.title || null;

    // Get price from costs
    const mainCost = property?.costs?.main;
    const price = mainCost?.value ? String(mainCost.value) : null;

    // Get size from areas
    const mainArea = property?.areas?.main;
    const size = mainArea?.value ? String(mainArea.value) : null;

    // Get rooms from areas.details
    const roomsDetail = property?.areas?.details?.find((a: any) => a.kind === 'ROOM_COUNT');
    const rooms = roomsDetail?.value ? String(roomsDetail.value) : null;

    // Get location
    const loc = property?.location;
    const location = loc?.city || null;
    const plz = loc?.zipCode || null;
    const rentBuy = nextData.availability?.tenureOption || null;

    return {
      company,
      type,
      title,
      price,
      size,
      rooms,
      location,
      plz,
      rentBuy
    };
  }

  // ============================================
  // PRIVATE: FILTERING & PARSING
  // ============================================

  private filterPrivateListing(props: DataLayerProps, bodyText: string): FilterResult {
    // Stage 1: Direct isPrivateAd check (NEW - most reliable!)
    if (props.type === 'Commercial') {
      return {
        allowed: false,
        reason: 'isPrivateAd: false (Commercial listing)',
        confidence: 'high'
      };
    }

    if (props.type === 'Private') {
      // Double-check for false positives - Commission text
      if (bodyText.includes('provision: 3') || bodyText.includes('nettoprovision') || bodyText.includes('provisionsaufschlag')) {
        return {
          allowed: false,
          reason: 'isPrivateAd: true but has Commission text',
          confidence: 'high'
        };
      }

      // STRICT: Only allow listings WITHOUT Company name (echte Privatpersonen)
      // Block ALL companies (GmbH, Bauträger, Immobilien, Makler, etc.)
      if (props.company) {
        return {
          allowed: false,
          reason: `isPrivateAd: true but has Company: ${props.company} (want private person only)`,
          confidence: 'high'
        };
      }

      return {
        allowed: true,
        reason: 'isPrivateAd: true + NO Company (Private person)',
        confidence: 'high'
      };
    }

    // Stage 3: Company-based filtering
    if (props.company) {
      const lower = props.company.toLowerCase();
      const commercialKeywords = [
        'gmbh', 'immobilien', 'makler', 'agentur', 'real estate',
        'partners', 'group', 'sivag', 'bauträger', 'immo'
      ];

      if (commercialKeywords.some(kw => lower.includes(kw))) {
        return {
          allowed: false,
          reason: `Commercial Company: ${props.company}`,
          confidence: 'high'
        };
      }

      if (lower === 'privat' || lower === 'private') {
        return {
          allowed: true,
          reason: 'Company: Privat',
          confidence: 'high'
        };
      }
    }

    // Stage 4: Body text - commercial keywords
    const commercialBodyKeywords = ['provision: 3', 'nettoprovision', 'provisionsaufschlag'];
    if (commercialBodyKeywords.some(kw => bodyText.includes(kw))) {
      return {
        allowed: false,
        reason: 'Body: Provision mentioned',
        confidence: 'medium'
      };
    }

    // Stage 5: Body text - private keywords
    const privateKeywords = [
      'von privat', 'privatverkauf', 'ohne makler',
      'privater verkäufer', 'verkaufe privat'
    ];
    if (privateKeywords.some(kw => bodyText.includes(kw))) {
      return {
        allowed: true,
        reason: 'Body: Private keywords found',
        confidence: 'medium'
      };
    }

    // Stage 6: Default BLOCK (conservative)
    return {
      allowed: false,
      reason: 'Uncertain - defaulting to block',
      confidence: 'low'
    };
  }

  private parseDetailPageWithReason(html: string, url: string, key: string): { listing: InsertListing | null; reason: string } {
    const $ = load(html);
    const bodyText = $('body').text().toLowerCase();

    // Extract dataLayer props AND the full nextData for images/description
    const props = this.extractAllDataLayerProps(html);
    const nextData = this.extractNextData(html);

    // Filter: Private vs Commercial
    const filterResult = this.filterPrivateListing(props, bodyText);

    if (!filterResult.allowed) {
      return { listing: null, reason: filterResult.reason };
    }

    // Parse price
    const price = this.parsePrice(props.price);

    // Parse area
    const area = this.parseArea(props.size);

    // Parse location
    const location = this.parseLocation(props.plz, props.location);

    // Calculate EUR/m²
    const eurPerM2 = area > 0 ? Math.round(price / area) : 0;

    // Determine region
    const region = this.determineRegion(location, props.plz);

    // Determine category
    const category = this.determineCategory(key);

    // Extract images from nextData
    const images = this.extractImages(nextData);

    // Extract description from nextData or fallback to DOM
    const description = this.extractDescriptionFromNextData(nextData, $, html);

    // Build listing
    const listing: InsertListing = {
      url,
      title: props.title || 'Untitled',
      price,
      area: area > 0 ? area : null, // NULL statt empty string
      eur_per_m2: eurPerM2 > 0 ? eurPerM2 : null, // NULL statt empty string
      location,
      description: description || '',
      images,
      category,
      region,
      source: 'derstandard',
      scraped_at: new Date(),
      first_seen_at: new Date()
    };

    return { listing, reason: filterResult.reason };
  }

  // ============================================
  // PRIVATE: PARSING HELPERS
  // ============================================

  private parsePrice(priceStr: string | null): number {
    if (!priceStr) return 0;

    // Handle ranges "394900,00 - 5903000,00" → take first
    const first = priceStr.split('-')[0].trim();

    // Remove dots (thousands separator), replace comma with dot
    const clean = first.replace(/\./g, '').replace(/,/g, '.');

    return parseFloat(clean) || 0;
  }

  private parseArea(sizeStr: string | null): number {
    if (!sizeStr) return 0;

    // Handle ranges "33 - 373" → take first
    const first = sizeStr.split('-')[0].trim();

    return parseInt(first) || 0;
  }

  private parseLocation(plz: string | null, city: string | null): string {
    const cleanPLZ = plz ? plz.replace('AT-', '').trim() : '';
    const cleanCity = city ? city.trim() : '';

    if (cleanPLZ && cleanCity) return `${cleanPLZ} ${cleanCity}`;
    if (cleanPLZ) return cleanPLZ;
    if (cleanCity) return cleanCity;
    return 'Unknown';
  }

  private determineRegion(location: string, plz: string | null): string {
    const lowerLocation = location.toLowerCase();
    const cleanPLZ = plz ? plz.replace('AT-', '') : '';

    if (lowerLocation.includes('wien') || cleanPLZ.startsWith('1')) {
      return 'Wien';
    }
    if (lowerLocation.includes('niederösterreich') || lowerLocation.includes('niederoesterreich')) {
      return 'Niederösterreich';
    }

    return 'Sonstige';
  }

  private determineCategory(key: string): string {
    if (key.includes('kaufen-wohnung')) return 'Wohnung kaufen';
    if (key.includes('mieten-wohnung')) return 'Wohnung mieten';
    if (key.includes('kaufen-haus')) return 'Haus kaufen';
    return 'Sonstige';
  }

  private extractImages(nextData: any): string[] {
    if (!nextData || !nextData.media || !nextData.media.images) {
      return [];
    }

    // Extract all image paths from the media.images array
    const images = nextData.media.images
      .map((img: any) => img.path)
      .filter((path: string) => path && path.startsWith('http'));

    return images;
  }

  private extractDescriptionFromNextData(nextData: any, $: any, html: string): string | null {
    // DerStandard stores description in __next_f.push chunks as unicode-escaped HTML
    // We need to search through ALL chunks to find it

    // Try 1: Search __next_f.push chunks for description HTML
    try {
      const pattern = /self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g;
      const matches = html.matchAll(pattern);

      for (const match of matches) {
        let chunk = match[1];

        // Look for unicode-escaped HTML with description-like text
        if (chunk.includes('\\u003cp\\u003e') && chunk.length > 100) {
          // Unescape unicode
          chunk = chunk.replace(/\\u003c/g, '<');
          chunk = chunk.replace(/\\u003e/g, '>');
          chunk = chunk.replace(/\\"/g, '"');
          chunk = chunk.replace(/\\\\/g, '\\');

          // Parse HTML and extract text
          const $chunk = load(chunk);
          const plainText = $chunk('body').text().trim();

          // Check if it looks like a property description
          if (plainText.length > 100) {
            const keywords = ['verkauf', 'wohnung', 'zimmer', 'lage', 'haus', 'immobilie', 'balkon', 'neubau'];
            const hasKeyword = keywords.some(kw => plainText.toLowerCase().includes(kw));

            if (hasKeyword) {
              return plainText.substring(0, 2000);
            }
          }
        }
      }
    } catch (e) {
      // If chunk parsing fails, continue to fallbacks
    }

    // Try 2: Check DOM (if description was rendered)
    const descText = $('[data-testid="object-description-text"], .description, [itemprop="description"]')
      .text()
      .trim();

    if (descText && descText.length > 30) {
      return descText.substring(0, 2000);
    }

    // Try 3: Check nextData for direct text (not reference)
    if (nextData && nextData.description && typeof nextData.description === 'string' && !nextData.description.startsWith('$')) {
      return nextData.description.substring(0, 2000);
    }

    // No description found (many private listings don't have one)
    return null;
  }
}

// ============================================
// SINGLETON EXPORT
// ============================================

export const derStandardScraper = new DerStandardScraperService();
