import { load } from 'cheerio';
import {
  sleep,
  withJitter,
  rotateUserAgent,
  proxyRequest,
  extractPrice,
  extractArea,
  extractTitle,
  extractDescription,
  extractImages,
  extractLastChanged,
  extractPublishedDate,
  extractLocationFromJson,
  extractLocationFromDom,
  extractPhoneFromHtml,
  extractDetailUrlsWithISPRIVATE,
  extractListingIdFromUrl,
} from './scraper-utils';
import { storage } from '../storage';

/**
 * MULTI-PLATFORM NEWEST SCRAPER
 *
 * Scrapt ALLE Plattformen (Willhaben, DerStandard, ImmoScout24)
 * 1:1 nach dem funktionierenden scraper-newest.ts gebaut
 *
 * Features:
 * - Dual timer system (Quick Check + Full Scrape)
 * - Smart pagination per platform
 * - Platform-specific extractors
 * - ISPRIVATE filtering (Willhaben)
 * - isPrivateAd filtering (DerStandard)
 * - isPrivateInsertion URL param (ImmoScout24)
 */

interface MultiScraperOptions {
  intervalMinutes?: number;
  onLog?: (msg: string) => void;
  onListingFound?: (listing: any) => Promise<void>;
  onPhoneFound?: (payload: { url: string; phone: string }) => void;
}

export class MultiNewestScraperService {
  private isRunning = false;
  private intervalMinutes = 30;
  private currentCycle = 0;
  private nextCycleTime: Date | null = null;
  private sessionCookies = '';
  private requestCount = 0;

  // Smart pagination state per platform
  private lastFirstListingIds: Record<string, string | null> = {};
  private currentFirstListingIds: Record<string, string | null> = {};
  private page1PrivateIds: Record<string, string[]> = {};

  // Dual timer system
  private quickCheckIntervalHandle: NodeJS.Timeout | null = null;
  private fullScrapeIntervalHandle: NodeJS.Timeout | null = null;
  private scrapeMutex = false;

  // Status tracking
  private lastQuickCheckTime: Date | null = null;
  private lastFullScrapeTime: Date | null = null;
  private isQuickCheckRunning = false;
  private isFullScrapeRunning = false;

  // Callbacks
  private onLog?: (msg: string) => void;
  private onListingFound?: (listing: any) => Promise<void>;
  private onPhoneFound?: (payload: { url: string; phone: string }) => void;

  // Platform URLs
  private readonly willhabenUrls: Record<string, string> = {
    'eigentumswohnung-wien': 'https://www.willhaben.at/iad/immobilien/eigentumswohnung/eigentumswohnung-angebote?areaId=900&areaId=903&rows=90&sort=1',
    'eigentumswohnung-niederoesterreich': 'https://www.willhaben.at/iad/immobilien/eigentumswohnung/niederoesterreich?rows=90&sort=1',
    'haus-wien': 'https://www.willhaben.at/iad/immobilien/haus-kaufen/wien?rows=90&sort=1',
    'haus-niederoesterreich': 'https://www.willhaben.at/iad/immobilien/haus-kaufen/niederoesterreich?rows=90&sort=1'
  };

  private readonly derStandardUrls: Record<string, string> = {
    'wien-kaufen-wohnung': 'https://immobilien.derstandard.at/suche/wien/kaufen-wohnung?sort=datePublishedDesc',
    'noe-kaufen-wohnung': 'https://immobilien.derstandard.at/suche/niederoesterreich/kaufen-wohnung?sort=datePublishedDesc',
    'noe-kaufen-haus': 'https://immobilien.derstandard.at/suche/niederoesterreich/kaufen-haus?sort=datePublishedDesc'
  };

  private readonly immoScoutUrls: Record<string, string> = {
    'wien-wohnung': 'https://www.immobilienscout24.at/regional/wien/wien/wohnung-kaufen?isPrivateInsertion=true&sort=3',
    'noe-wohnung': 'https://www.immobilienscout24.at/regional/niederoesterreich/wohnung-kaufen?isPrivateInsertion=true&sort=3',
    'noe-haus': 'https://www.immobilienscout24.at/regional/niederoesterreich/haus-kaufen?isPrivateInsertion=true&sort=3'
  };

  async start(options: MultiScraperOptions = {}): Promise<void> {
    if (this.isRunning) {
      options.onLog?.('[MULTI-NEWEST] Scraper läuft bereits!');
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

    onLog?.('[MULTI-NEWEST] 🚀 GESTARTET - Multi-Platform Smart Scraping');
    onLog?.(`[MULTI-NEWEST] ⏱️ Quick Check: 2 min | Full Scrape: ${intervalMinutes} min`);
    onLog?.('[MULTI-NEWEST] 📊 Platforms: Willhaben, DerStandard, ImmoScout24');

    // Load persisted state
    try {
      this.lastFirstListingIds = await this.loadLastFirstListingIds();
      const totalStates = Object.keys(this.lastFirstListingIds).length;
      onLog?.(`[MULTI-NEWEST] 📂 Loaded ${totalStates} persisted states`);
    } catch (error: any) {
      onLog?.(`[MULTI-NEWEST] ⚠️ Could not load state: ${error?.message || error}`);
    }

    // First execution with RETRY LOGIC
    let retries = 0;
    const MAX_RETRIES = 3;

    while (retries < MAX_RETRIES) {
      try {
        await this.runFullScrape();
        onLog?.('[MULTI-NEWEST] ✅ Initial scrape completed successfully');
        break;
      } catch (error: any) {
        retries++;
        onLog?.(`[MULTI-NEWEST] ❌ Initial scrape failed (attempt ${retries}/${MAX_RETRIES}): ${error?.message || error}`);

        if (retries < MAX_RETRIES) {
          const waitSeconds = retries * 10;
          onLog?.(`[MULTI-NEWEST] ⏳ Retrying in ${waitSeconds} seconds...`);
          await sleep(waitSeconds * 1000);
        } else {
          onLog?.('[MULTI-NEWEST] ⚠️ Max retries reached - continuing with timers');
        }
      }
    }

    // Start dual timer system
    await this.startQuickCheckTimer(2); // 2 minutes
    await this.startFullScrapeTimer(intervalMinutes); // 30 minutes default

    this.nextCycleTime = new Date(Date.now() + intervalMinutes * 60 * 1000);
    onLog?.('[MULTI-NEWEST] ⏰ Dual timer system started');
  }

  stop(onLog?: (msg: string) => void): void {
    if (this.quickCheckIntervalHandle) {
      clearInterval(this.quickCheckIntervalHandle);
      this.quickCheckIntervalHandle = null;
    }
    if (this.fullScrapeIntervalHandle) {
      clearInterval(this.fullScrapeIntervalHandle);
      this.fullScrapeIntervalHandle = null;
    }

    this.isRunning = false;
    this.scrapeMutex = false;
    onLog?.('[MULTI-NEWEST] ⛔ GESTOPPT - All timers cleared');
  }

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

  // ============================================
  // TIMER SYSTEM
  // ============================================

  private async startQuickCheckTimer(minutes: number): Promise<void> {
    this.quickCheckIntervalHandle = setInterval(async () => {
      await this.runQuickCheck();
    }, minutes * 60 * 1000);

    this.onLog?.(`[MULTI-NEWEST] ⏰ Quick Check Timer: Every ${minutes} min`);
  }

  private async startFullScrapeTimer(minutes: number): Promise<void> {
    this.fullScrapeIntervalHandle = setInterval(async () => {
      await this.runFullScrape();
    }, minutes * 60 * 1000);

    this.onLog?.(`[MULTI-NEWEST] ⏰ Full Scrape Timer: Every ${minutes} min`);
  }

  private async runQuickCheck(): Promise<void> {
    if (this.scrapeMutex) {
      this.onLog?.('[MULTI-NEWEST] ⏸️ Quick Check skipped (scrape in progress)');
      return;
    }

    this.scrapeMutex = true;
    this.isQuickCheckRunning = true;
    this.lastQuickCheckTime = new Date();

    try {
      this.onLog?.('[MULTI-NEWEST] 🔍 Quick Check started (page 1 only)');

      // Scrape all platforms - page 1 only
      await this.scrapeWillhaben(1, 'Quick Check');
      await this.scrapeDerStandard(1, 'Quick Check');
      await this.scrapeImmoScout(1, 'Quick Check');

      this.onLog?.('[MULTI-NEWEST] ✅ Quick Check completed');
    } catch (error: any) {
      this.onLog?.(`[MULTI-NEWEST] ❌ Quick Check error: ${error?.message || error}`);
    } finally {
      this.isQuickCheckRunning = false;
      this.scrapeMutex = false;
    }
  }

  private async runFullScrape(): Promise<void> {
    if (this.scrapeMutex) {
      this.onLog?.('[MULTI-NEWEST] ⏸️ Full Scrape skipped (scrape in progress)');
      return;
    }

    this.scrapeMutex = true;
    this.isFullScrapeRunning = true;
    this.lastFullScrapeTime = new Date();
    this.currentCycle++;

    try {
      this.onLog?.(`[MULTI-NEWEST] 🔄 Full Scrape started (Cycle ${this.currentCycle})`);

      // Scrape all platforms - multiple pages
      await this.scrapeWillhaben(5, 'Full Scrape');
      await this.scrapeDerStandard(3, 'Full Scrape');
      await this.scrapeImmoScout(3, 'Full Scrape');

      this.onLog?.(`[MULTI-NEWEST] ✅ Full Scrape completed (Cycle ${this.currentCycle})`);

      // Save state
      await this.saveLastFirstListingIds();
    } catch (error: any) {
      this.onLog?.(`[MULTI-NEWEST] ❌ Full Scrape error: ${error?.message || error}`);
    } finally {
      this.isFullScrapeRunning = false;
      this.scrapeMutex = false;
      this.nextCycleTime = new Date(Date.now() + this.intervalMinutes * 60 * 1000);
    }
  }

  // ============================================
  // WILLHABEN SCRAPING
  // ============================================

  private async scrapeWillhaben(maxPages: number, label: string): Promise<void> {
    for (const [key, baseUrl] of Object.entries(this.willhabenUrls)) {
      if (!this.isRunning) return;

      this.onLog?.(`[MULTI-NEWEST] [Willhaben] [${label}] 🔍 ${key}`);

      for (let page = 1; page <= maxPages; page++) {
        if (!this.isRunning) return;

        const url = `${baseUrl}&page=${page}`;

        try {
          const headers = {
            'User-Agent': rotateUserAgent(),
            'Referer': page > 1 ? `${baseUrl}&page=${page-1}` : 'https://www.willhaben.at/',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8',
          };

          const res = await proxyRequest(url, this.sessionCookies, { headers });
          const html = res.data as string;

          // Filter URLs by ISPRIVATE=1
          const { filteredUrls, totalOnPage, privateCount, commercialCount } = extractDetailUrlsWithISPRIVATE(html);
          this.onLog?.(`[MULTI-NEWEST] [Willhaben] [${label}] page ${page}: ${totalOnPage} total → ${privateCount} privat`);

          // Process each private listing
          for (const detailUrl of filteredUrls) {
            if (!this.isRunning) return;

            try {
              const detail = await this.fetchWillhabenDetail(detailUrl);
              const { listing, reason } = this.parseWillhabenDetail(detail, detailUrl, key);

              if (!listing) {
                // Skip silently
              } else {
                // Save listing
                try {
                  if (this.onListingFound) {
                    await this.onListingFound(listing);
                  }
                } catch (e) {
                  // Already exists - normal
                }

                // Extract phone
                const $detail = load(detail);
                const phone = extractPhoneFromHtml(detail, $detail);
                if (phone && this.onPhoneFound) {
                  this.onPhoneFound({ url: detailUrl, phone });
                }
              }

              await sleep(withJitter(60, 60)); // 60ms ± 60ms
            } catch (error: any) {
              // Skip failed detail pages
            }
          }

          await sleep(withJitter(200, 100)); // 200ms ± 100ms between pages
        } catch (error: any) {
          this.onLog?.(`[MULTI-NEWEST] [Willhaben] [${label}] ❌ Error page ${page}: ${error?.message}`);
        }
      }
    }
  }

  private async fetchWillhabenDetail(url: string): Promise<string> {
    this.requestCount++;
    if (this.requestCount % 50 === 0) {
      await this.establishSession();
    }

    const headers = {
      'User-Agent': rotateUserAgent(),
      'Referer': 'https://www.willhaben.at/iad/immobilien/eigentumswohnung',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9',
    };

    const res = await proxyRequest(url, this.sessionCookies, { headers });

    if (res.headers['set-cookie']) {
      this.sessionCookies = res.headers['set-cookie']
        .map((c: string) => c.split(';')[0])
        .join('; ');
    }

    return res.data as string;
  }

  private parseWillhabenDetail(html: string, url: string, categoryKey: string): { listing: any | null; reason: string } {
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
    const description = extractDescription($);
    const title = extractTitle($);

    if (title && (title.includes('Die Seite wurde nicht gefunden') || title.includes('nicht gefunden'))) {
      return { listing: null, reason: 'listing deleted/not found' };
    }

    if (bodyText.includes('die seite wurde nicht gefunden') || bodyText.includes('seite existiert nicht')) {
      return { listing: null, reason: 'page not found (404)' };
    }

    const price = extractPrice($, bodyText);
    if (price <= 0) return { listing: null, reason: 'no price' };
    const areaStr = extractArea($, bodyText);
    const area = areaStr ? parseInt(areaStr) : 0;
    const eurPerM2 = area > 0 ? Math.round(price / area) : 0;
    const images = extractImages($, html);

    const region = categoryKey.includes('wien') ? 'wien' : 'niederoesterreich';
    const category = categoryKey.includes('eigentumswohnung')
      ? 'eigentumswohnung'
      : categoryKey.includes('haus')
        ? 'haus'
        : 'grundstueck';

    const locJson = extractLocationFromJson(html);
    const location = locJson || extractLocationFromDom($, url) || (categoryKey.includes('wien') ? 'Wien' : 'Niederösterreich');
    const phoneDirect = extractPhoneFromHtml(html, $);
    const lastChangedAt = extractLastChanged($, html);
    const publishedAt = extractPublishedDate(html);

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
        published_at: publishedAt,
      },
      reason: 'ok',
    };
  }

  // ============================================
  // DERSTANDARD SCRAPING
  // ============================================

  private async scrapeDerStandard(maxPages: number, label: string): Promise<void> {
    for (const [key, baseUrl] of Object.entries(this.derStandardUrls)) {
      if (!this.isRunning) return;

      this.onLog?.(`[MULTI-NEWEST] [DerStandard] [${label}] 🔍 ${key}`);

      for (let page = 1; page <= maxPages; page++) {
        if (!this.isRunning) return;

        const url = page === 1 ? baseUrl : `${baseUrl}&page=${page}`;

        try {
          const headers = {
            'User-Agent': rotateUserAgent(),
            'Referer': 'https://immobilien.derstandard.at/',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9',
          };

          const res = await proxyRequest(url, this.sessionCookies, { headers });
          const html = res.data as string;

          // Extract detail URLs
          const detailUrls = this.extractDerStandardUrls(html);
          this.onLog?.(`[MULTI-NEWEST] [DerStandard] [${label}] page ${page}: ${detailUrls.length} listings`);

          // Process each listing
          for (const detailUrl of detailUrls) {
            if (!this.isRunning) return;

            try {
              const detail = await this.fetchDerStandardDetail(detailUrl);
              const { listing, reason } = this.parseDerStandardDetail(detail, detailUrl, key);

              if (!listing) {
                // Skip (commercial or filter)
              } else {
                try {
                  if (this.onListingFound) {
                    await this.onListingFound({ ...listing, source: 'derstandard' });
                  }
                } catch (e) {
                  // Already exists
                }
              }

              await sleep(withJitter(60, 60));
            } catch (error: any) {
              // Skip failed detail pages
            }
          }

          await sleep(withJitter(200, 100));
        } catch (error: any) {
          this.onLog?.(`[MULTI-NEWEST] [DerStandard] [${label}] ❌ Error page ${page}: ${error?.message}`);
        }
      }
    }
  }

  private extractDerStandardUrls(html: string): string[] {
    const urls: string[] = [];
    const pattern = /href="(\/detail\/\d+)"/g;
    let match;

    while ((match = pattern.exec(html)) !== null) {
      const url = `https://immobilien.derstandard.at${match[1]}`;
      if (!urls.includes(url)) {
        urls.push(url);
      }
    }

    return urls;
  }

  private async fetchDerStandardDetail(url: string): Promise<string> {
    this.requestCount++;
    if (this.requestCount % 50 === 0) {
      await this.establishSession();
    }

    const headers = {
      'User-Agent': rotateUserAgent(),
      'Referer': 'https://immobilien.derstandard.at/suche/',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9',
    };

    const res = await proxyRequest(url, this.sessionCookies, { headers });

    if (res.headers['set-cookie']) {
      this.sessionCookies = res.headers['set-cookie']
        .map((c: string) => c.split(';')[0])
        .join('; ');
    }

    return res.data as string;
  }

  private parseDerStandardDetail(html: string, url: string, categoryKey: string): { listing: any | null; reason: string } {
    try {
      // Extract dataLayer properties
      const props = this.extractAllDataLayerProps(html);

      // STRICT FILTER: Only private persons (NO companies)
      if (props.type === 'Private') {
        // Check for commission text
        if (html.includes('provision: 3') || html.includes('nettoprovision') || html.includes('provisionsaufschlag')) {
          return { listing: null, reason: 'isPrivateAd: true but has Commission text' };
        }

        // STRICT: Block ANY listing with company name
        if (props.company) {
          return { listing: null, reason: `isPrivateAd: true but has Company: ${props.company}` };
        }

        // Parse listing
        const price = this.parsePrice(props.price);
        const area = this.parseArea(props.size);
        const title = props.title || '';
        const location = props.location || '';

        if (!price || !title) {
          return { listing: null, reason: 'Missing required fields' };
        }

        const region = categoryKey.includes('wien') ? 'wien' : 'niederoesterreich';
        const category = categoryKey.includes('haus') ? 'haus' : 'eigentumswohnung';
        const eur_per_m2 = (price && area) ? (price / area).toFixed(2) : null;

        const listing = {
          source: 'derstandard',
          title,
          description: null, // TODO: extract from DOM
          price,
          area,
          location,
          url,
          images: [],
          phone_number: null,
          category,
          region,
          eur_per_m2,
          rawData: props
        };

        return { listing, reason: 'Private person (no company)' };
      }

      // Block all other types
      return { listing: null, reason: `Type: ${props.type || 'unknown'} (not Private)` };
    } catch (error: any) {
      return { listing: null, reason: `Parse error: ${error?.message}` };
    }
  }

  private extractAllDataLayerProps(html: string): Record<string, string | null> {
    const props: Record<string, string | null> = {
      company: this.extractDataLayerProp(html, 'objectCompany'),
      type: this.extractDataLayerProp(html, 'objectType'),
      title: this.extractDataLayerProp(html, 'objectTitle'),
      price: this.extractDataLayerProp(html, 'objectPrice'),
      size: this.extractDataLayerProp(html, 'objectSize'),
      rooms: this.extractDataLayerProp(html, 'objectRooms'),
      location: this.extractDataLayerProp(html, 'objectLocationName'),
      plz: this.extractDataLayerProp(html, 'objectPLZ'),
      rentBuy: this.extractDataLayerProp(html, 'objectRentBuy'),
    };
    return props;
  }

  private extractDataLayerProp(html: string, prop: string): string | null {
    const pattern = new RegExp(
      `putPropertyToObjectIfNotEmpty\\(dataLayerObject,\\s*"${prop}",\\s*"([^"]+)"\\)`
    );
    const match = html.match(pattern);
    return match ? match[1] : null;
  }

  private parsePrice(priceStr: string | null): number | null {
    if (!priceStr) return null;
    const cleaned = priceStr.replace(/[^\d,.-]/g, '').replace(',', '.');
    const parts = cleaned.split('-');
    const firstPrice = parseFloat(parts[0].trim());
    return isNaN(firstPrice) ? null : firstPrice;
  }

  private parseArea(sizeStr: string | null): number | null {
    if (!sizeStr) return null;
    const cleaned = sizeStr.replace(/[^\d,.-]/g, '').replace(',', '.');
    const parts = cleaned.split('-');
    const firstArea = parseFloat(parts[0].trim());
    return isNaN(firstArea) ? null : firstArea;
  }

  // ============================================
  // IMMOSCOUT SCRAPING
  // ============================================

  private async scrapeImmoScout(maxPages: number, label: string): Promise<void> {
    for (const [key, baseUrl] of Object.entries(this.immoScoutUrls)) {
      if (!this.isRunning) return;

      this.onLog?.(`[MULTI-NEWEST] [ImmoScout] [${label}] 🔍 ${key}`);

      for (let page = 1; page <= maxPages; page++) {
        if (!this.isRunning) return;

        const url = page === 1 ? baseUrl : `${baseUrl}&pagenumber=${page}`;

        try {
          const headers = {
            'User-Agent': rotateUserAgent(),
            'Referer': 'https://www.immobilienscout24.at/',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9',
          };

          const res = await proxyRequest(url, this.sessionCookies, { headers });
          const html = res.data as string;

          // Extract search results from __INITIAL_STATE__
          const hits = this.extractImmoScoutHits(html);
          this.onLog?.(`[MULTI-NEWEST] [ImmoScout] [${label}] page ${page}: ${hits.length} listings`);

          // Process each hit
          for (const hit of hits) {
            if (!this.isRunning) return;

            try {
              const detailUrl = hit.links?.absoluteURL;
              if (!detailUrl) continue;

              const detail = await this.fetchImmoScoutDetail(detailUrl);
              const productData = this.extractImmoScoutProduct(detail);

              if (!productData) continue;

              const listing = this.buildImmoScoutListing(hit, productData, detailUrl, key);

              try {
                if (this.onListingFound) {
                  await this.onListingFound(listing);
                }
              } catch (e) {
                // Already exists
              }

              await sleep(withJitter(60, 60));
            } catch (error: any) {
              // Skip failed detail pages
            }
          }

          await sleep(withJitter(200, 100));
        } catch (error: any) {
          this.onLog?.(`[MULTI-NEWEST] [ImmoScout] [${label}] ❌ Error page ${page}: ${error?.message}`);
        }
      }
    }
  }

  private extractImmoScoutHits(html: string): any[] {
    try {
      // Find window.__INITIAL_STATE__
      const match = html.match(/window\.__INITIAL_STATE__\s*=\s*({[\s\S]+?});?\s*(?:window\.|<\/script>)/);

      if (!match) {
        return [];
      }

      // Replace undefined with null for valid JSON
      const json = match[1].replace(/:\s*undefined/g, ': null');
      const state = JSON.parse(json);

      // Navigate to results
      const results = state.reduxAsyncConnect?.pageData?.results;

      if (!results || !results.hits) {
        return [];
      }

      return results.hits || [];

    } catch (e) {
      return [];
    }
  }

  private async fetchImmoScoutDetail(url: string): Promise<string> {
    this.requestCount++;
    if (this.requestCount % 50 === 0) {
      await this.establishSession();
    }

    const headers = {
      'User-Agent': rotateUserAgent(),
      'Referer': 'https://www.immobilienscout24.at/',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9',
    };

    const res = await proxyRequest(url, this.sessionCookies, { headers });

    if (res.headers['set-cookie']) {
      this.sessionCookies = res.headers['set-cookie']
        .map((c: string) => c.split(';')[0])
        .join('; ');
    }

    return res.data as string;
  }

  private extractImmoScoutProduct(html: string): any | null {
    try {
      const productIndex = html.indexOf('"@type":"Product"');
      if (productIndex === -1) return null;

      // Find start by counting braces backwards
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

      // Find end by counting braces forward
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
        let description = json.description || '';
        description = description.replace(/<br\s*\/?>/gi, '\n');
        description = description.replace(/<[^>]+>/g, '');

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

  private buildImmoScoutListing(hit: any, product: any, url: string, categoryKey: string): any {
    // Extract region and category from categoryKey
    // wien-wohnung, noe-wohnung, noe-haus
    const region = categoryKey.startsWith('wien') ? 'wien' : 'niederoesterreich';
    const category = categoryKey.includes('haus') ? 'haus' : 'eigentumswohnung';

    // Calculate €/m²
    const price = hit.primaryPrice || product.price;
    const area = hit.primaryArea;
    const eur_per_m2 = (price && area) ? (price / area).toFixed(2) : null;

    return {
      source: 'immoscout',
      title: product.title || hit.headline,
      description: product.description || null,
      price,
      area,
      rooms: hit.numberOfRooms,
      location: hit.addressString,
      url,
      images: product.images,
      phone_number: null,
      category,
      region,
      eur_per_m2,
      rawData: {
        exposeId: hit.exposeId,
        badges: hit.badges || [],
        datePosted: product.datePosted,
      }
    };
  }

  // ============================================
  // SESSION MANAGEMENT
  // ============================================

  private async establishSession(): Promise<void> {
    try {
      const res = await proxyRequest(
        'https://www.willhaben.at/',
        '',
        { headers: { 'User-Agent': rotateUserAgent() } }
      );

      if (res.headers['set-cookie']) {
        this.sessionCookies = res.headers['set-cookie']
          .map((c: string) => c.split(';')[0])
          .join('; ');
      }
    } catch (e) {
      // Ignore session errors
    }
  }

  // ============================================
  // STATE PERSISTENCE
  // ============================================

  private async loadLastFirstListingIds(): Promise<Record<string, string | null>> {
    const allKeys = [
      ...Object.keys(this.willhabenUrls),
      ...Object.keys(this.derStandardUrls),
      ...Object.keys(this.immoScoutUrls)
    ];

    const state: Record<string, string | null> = {};

    for (const key of allKeys) {
      try {
        const value = await storage.getScraperNextPage(`multi-newest-${key}`, '');
        state[key] = value || null;
      } catch (e) {
        state[key] = null;
      }
    }

    return state;
  }

  private async saveLastFirstListingIds(): Promise<void> {
    for (const [key, value] of Object.entries(this.currentFirstListingIds)) {
      if (value) {
        try {
          await storage.setScraperNextPage(`multi-newest-${key}`, value);
        } catch (e) {
          // Ignore save errors
        }
      }
    }
  }
}
