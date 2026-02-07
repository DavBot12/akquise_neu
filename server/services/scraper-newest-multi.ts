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
import { isInAkquiseGebiet, extractPlzAndOrt } from './geo-filter';
import { calculateQualityScore } from './quality-scorer';

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

      // Reset current IDs for next scrape (states are already persisted per category)
      this.currentFirstListingIds = {};

      this.onLog?.(`[MULTI-NEWEST] ✅ Full Scrape completed (Cycle ${this.currentCycle})`);
    } catch (error: any) {
      this.onLog?.(`[MULTI-NEWEST] ❌ Full Scrape error: ${error?.message || error}`);
    } finally {
      this.isFullScrapeRunning = false;
      this.scrapeMutex = false;
      this.nextCycleTime = new Date(Date.now() + this.intervalMinutes * 60 * 1000);
    }
  }

  // ============================================
  // WILLHABEN SCRAPING (SMART PAGINATION - 1:1 from scraper-newest.ts)
  // ============================================

  private async scrapeWillhaben(maxPagesOrSmart: number, label: string): Promise<void> {
    // Check if this is a Quick Check (maxPages=1) or Full Scrape (maxPages=5)
    const isQuickCheck = maxPagesOrSmart === 1;
    const MAX_SAFETY_PAGES = 20; // Safety limit for smart pagination

    for (const [key, baseUrl] of Object.entries(this.willhabenUrls)) {
      if (!this.isRunning) return;

      this.onLog?.(`[MULTI-NEWEST] [Willhaben] [${label}] 🔍 ${key}`);

      // Get category-specific state
      const categoryLastFirstId = this.lastFirstListingIds[key];
      const hasState = categoryLastFirstId !== null && categoryLastFirstId !== undefined;

      // Quick Check: Only page 1, no smart pagination
      if (isQuickCheck) {
        await this.scrapeWillhabenPages(key, baseUrl, 1, 1, label);
        continue;
      }

      // Full Scrape: Use smart pagination if we have state
      if (hasState) {
        this.onLog?.(`[MULTI-NEWEST] [Willhaben] [${label}] 📌 Smart pagination for ${key} - searching for ID: ${categoryLastFirstId}`);

        let foundPreviousFirstId = false;
        let pageNumber = 1;

        while (!foundPreviousFirstId && pageNumber <= MAX_SAFETY_PAGES) {
          if (!this.isRunning) return;

          const url = `${baseUrl}&page=${pageNumber}`;

          try {
            const headers = {
              'User-Agent': rotateUserAgent(),
              'Referer': pageNumber > 1 ? `${baseUrl}&page=${pageNumber-1}` : 'https://www.willhaben.at/',
              'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
              'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8',
            };

            const res = await proxyRequest(url, this.sessionCookies, { headers });
            const html = res.data as string;

            // Filter URLs by ISPRIVATE=1
            const { filteredUrls, totalOnPage, privateCount, commercialCount } = extractDetailUrlsWithISPRIVATE(html);
            this.onLog?.(`[MULTI-NEWEST] [Willhaben] [${label}] page ${pageNumber}: ${totalOnPage} total → ${privateCount} privat (ISPRIVATE=1), ${commercialCount} kommerziell (ISPRIVATE=0)`);

            const isDebug = process.env.DEBUG_SCRAPER === 'true';

            // Process each PRIVATE listing
            for (const detailUrl of filteredUrls) {
              if (!this.isRunning) return;

              // Extract listing ID
              const listingId = extractListingIdFromUrl(detailUrl);

              if (isDebug) {
                this.onLog?.(`[MULTI-NEWEST] [Willhaben] [${label}] 📄 Fetching detail: ${listingId} - ${detailUrl.substring(0, 60)}...`);
              }

              // Store first ID on page 1 for THIS CATEGORY (for next scrape)
              if (pageNumber === 1 && !this.currentFirstListingIds[key] && listingId) {
                this.currentFirstListingIds[key] = listingId;
                if (isDebug) {
                  this.onLog?.(`[MULTI-NEWEST] [Willhaben] [${label}] 📌 Current first ID for ${key}: ${listingId}`);
                }
              }

              // Check if we've reached THIS CATEGORY's previous scrape's first ID
              // Convert both to strings to handle type mismatch (extractListingIdFromUrl returns string, getScraperNextPage returns number)
              const listingIdStr = listingId?.toString();
              const savedIdStr = categoryLastFirstId?.toString();
              if (categoryLastFirstId && listingIdStr === savedIdStr) {
                foundPreviousFirstId = true;
                this.onLog?.(`[MULTI-NEWEST] [Willhaben] [${label}] ✅ Reached previous first ID for ${key}: ${listingIdStr} - Stopping pagination`);
                break; // Stop processing this page
              }

              // Fetch detail page
              try {
                if (isDebug) {
                  this.onLog?.(`[MULTI-NEWEST] [Willhaben] [${label}] 🌐 Fetching detail page...`);
                }
                const detail = await this.fetchWillhabenDetail(detailUrl);
                if (isDebug) {
                  this.onLog?.(`[MULTI-NEWEST] [Willhaben] [${label}] 📝 Parsing detail page (${detail.length} chars)...`);
                }
                const { listing, reason } = this.parseWillhabenDetail(detail, detailUrl, key);

                if (!listing) {
                  if (isDebug) {
                    this.onLog?.(`[MULTI-NEWEST] [Willhaben] [${label}] ⏭️ SKIP ${detailUrl.substring(0, 80)}... :: ${reason}`);
                  }
                } else {
                  // Save listing
                  try {
                    if (this.onListingFound) {
                      if (isDebug) {
                        this.onLog?.(`[MULTI-NEWEST] [Willhaben] [${label}] 💾 Saving to DB: ${listing.title.substring(0, 40)}...`);
                      }
                      await this.onListingFound(listing);
                      if (isDebug) {
                        this.onLog?.(`[MULTI-NEWEST] [Willhaben] [${label}] ✅ SAVED to DB!`);
                      }
                    }
                  } catch (e) {
                    if (isDebug) {
                      this.onLog?.(`[MULTI-NEWEST] [Willhaben] [${label}] ℹ️ Listing exists (normal)`);
                    }
                  }

                  // Extract phone
                  const $detail = load(detail);
                  const phone = extractPhoneFromHtml(detail, $detail);
                  if (phone) {
                    if (isDebug) {
                      this.onLog?.(`[MULTI-NEWEST] [Willhaben] [${label}] 📞 Phone found: ${phone}`);
                    }
                    if (this.onPhoneFound) {
                      this.onPhoneFound({ url: detailUrl, phone });
                    }
                  }

                  if (isDebug) {
                    this.onLog?.(`[MULTI-NEWEST] [Willhaben] [${label}] ✅ COMPLETE: ${listing.category}/${listing.region} :: €${listing.price} :: ${listing.title.substring(0,50)}`);
                  }
                }
              } catch (detailError: any) {
                this.onLog?.(`[MULTI-NEWEST] [Willhaben] [${label}] ❌ ERROR fetching ${detailUrl.substring(0, 60)}... :: ${detailError?.message || detailError}`);
              }

              await sleep(withJitter(60, 120));
            }

            if (foundPreviousFirstId) break; // Stop pagination for this category

          } catch (e: any) {
            this.onLog?.(`[MULTI-NEWEST] [Willhaben] [${label}] ⚠️ error page ${pageNumber}: ${e?.message || e}`);
          }

          pageNumber++;
          await sleep(withJitter(120, 80));
        }

        if (pageNumber > MAX_SAFETY_PAGES) {
          this.onLog?.(`[MULTI-NEWEST] [Willhaben] [${label}] ⚠️ Hit safety limit of ${MAX_SAFETY_PAGES} pages - may need to adjust`);
        }

        // PERSIST IMMEDIATELY after each category finishes
        const currentId = this.currentFirstListingIds[key];
        if (currentId) {
          await this.persistWillhabenState(key, currentId);
          this.lastFirstListingIds[key] = currentId;
          this.onLog?.(`[MULTI-NEWEST] [Willhaben] [${label}] 💾 Saved state for ${key}: ${currentId}`);
        }
      } else {
        // First run - use fixed pages to establish baseline
        this.onLog?.(`[MULTI-NEWEST] [Willhaben] [${label}] First run for ${key} - establishing baseline (fixed 5 pages)`);
        await this.scrapeWillhabenPages(key, baseUrl, 1, 5, label);

        // Save first ID for next time
        const currentId = this.currentFirstListingIds[key];
        if (currentId) {
          await this.persistWillhabenState(key, currentId);
          this.lastFirstListingIds[key] = currentId;
          this.onLog?.(`[MULTI-NEWEST] [Willhaben] [${label}] 💾 Saved initial state for ${key}: ${currentId}`);
        }
      }
    }
  }

  // Helper method to scrape fixed page range (1:1 from scraper-newest.ts logic)
  private async scrapeWillhabenPages(key: string, baseUrl: string, startPage: number, endPage: number, label: string): Promise<void> {
    for (let page = startPage; page <= endPage; page++) {
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

        const isDebug = process.env.DEBUG_SCRAPER === 'true';

        // Process each private listing
        for (const detailUrl of filteredUrls) {
          if (!this.isRunning) return;

          const listingId = extractListingIdFromUrl(detailUrl);

          // Store first ID on page 1
          if (page === 1 && !this.currentFirstListingIds[key] && listingId) {
            this.currentFirstListingIds[key] = listingId;
            if (isDebug) {
              this.onLog?.(`[MULTI-NEWEST] [Willhaben] [${label}] 📌 Stored first ID for ${key}: ${listingId}`);
            }
          }

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

            await sleep(withJitter(60, 60));
          } catch (error: any) {
            // Skip failed detail pages
          }
        }

        await sleep(withJitter(200, 100));
      } catch (error: any) {
        this.onLog?.(`[MULTI-NEWEST] [Willhaben] [${label}] ❌ Error page ${page}: ${error?.message}`);
      }
    }
  }

  // State persistence for all platforms
  private async persistWillhabenState(category: string, listingId: string): Promise<void> {
    await this.persistState(category, listingId);
  }

  private async persistState(category: string, listingId: string): Promise<void> {
    try {
      const stateKey = `multi-newest-${category}`;
      await storage.setScraperNextPage(stateKey, listingId);
    } catch (error) {
      this.onLog?.(`[MULTI-NEWEST] ⚠️ Error persisting ${category}: ${error}`);
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
    const description = extractDescription($, bodyText);
    const title = extractTitle($, bodyText);

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

    // ✅ Geographic filter - check if location is in acquisition area
    const geoCheck = isInAkquiseGebiet(location, region);
    if (!geoCheck.allowed) {
      // Save to geo_blocked_listings table (async, don't wait)
      const { plz, ort } = extractPlzAndOrt(location);
      storage.saveGeoBlockedListing({
        title,
        price,
        location,
        area: areaStr || null,
        eur_per_m2: eurPerM2 ? String(eurPerM2) : null,
        description,
        phone_number: phoneDirect || null,
        images,
        url,
        category,
        region,
        source: 'willhaben',
        original_scraped_at: new Date(),
        original_published_at: publishedAt,
        original_last_changed_at: lastChangedAt,
        block_reason: geoCheck.reason,
        plz,
        ort,
      }).catch(err => console.log(`[SCRAPER] Geo-blocked save error (ignoring): ${err.message}`));

      return { listing: null, reason: `Außerhalb Akquise-Gebiet: ${geoCheck.reason} (${location})` };
    }

    // Build listing object for quality scoring (phoneDirect, lastChangedAt, publishedAt already extracted above)
    const listing = {
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
    };

    // Calculate quality score
    const qualityResult = calculateQualityScore(listing);

    return {
      listing: {
        ...listing,
        quality_score: qualityResult.total,
        quality_tier: qualityResult.tier,
        is_gold_find: qualityResult.isGoldFind,
      },
      reason: 'ok',
    };
  }

  // ============================================
  // DERSTANDARD SCRAPING
  // ============================================

  private async scrapeDerStandard(maxPagesOrSmart: number, label: string): Promise<void> {
    const isQuickCheck = maxPagesOrSmart === 1;
    const MAX_SAFETY_PAGES = 20;

    for (const [key, baseUrl] of Object.entries(this.derStandardUrls)) {
      if (!this.isRunning) return;

      this.onLog?.(`[MULTI-NEWEST] [DerStandard] [${label}] 🔍 ${key}`);

      const categoryLastFirstId = this.lastFirstListingIds[key];
      const hasState = categoryLastFirstId !== null && categoryLastFirstId !== undefined;

      // Quick Check: Only page 1
      if (isQuickCheck) {
        await this.scrapeDerStandardPages(key, baseUrl, 1, 1, label);
        continue;
      }

      // Full Scrape: Use smart pagination if we have state
      if (hasState) {
        this.onLog?.(`[MULTI-NEWEST] [DerStandard] [${label}] 📌 Smart pagination for ${key} - searching for ID: ${categoryLastFirstId}`);

        let foundPreviousFirstId = false;
        let pageNumber = 1;

        while (!foundPreviousFirstId && pageNumber <= MAX_SAFETY_PAGES) {
          if (!this.isRunning) return;

          const url = pageNumber === 1 ? baseUrl : `${baseUrl}&page=${pageNumber}`;

          try {
            const headers = {
              'User-Agent': rotateUserAgent(),
              'Referer': 'https://immobilien.derstandard.at/',
              'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9',
            };

            const res = await proxyRequest(url, this.sessionCookies, { headers });
            const html = res.data as string;
            const detailUrls = this.extractDerStandardUrls(html);

            this.onLog?.(`[MULTI-NEWEST] [DerStandard] [${label}] page ${pageNumber}: ${detailUrls.length} listings`);

            for (const detailUrl of detailUrls) {
              if (!this.isRunning) return;

              // Extract listing ID from URL (/detail/15015102)
              const listingId = detailUrl.match(/\/detail\/(\d+)/)?.[1];

              // Store first ID on page 1
              if (pageNumber === 1 && !this.currentFirstListingIds[key] && listingId) {
                this.currentFirstListingIds[key] = listingId;
              }

              // Check if we've reached previous first ID
              // Convert both to strings to handle type mismatch
              const listingIdStr = listingId?.toString();
              const savedIdStr = categoryLastFirstId?.toString();
              if (categoryLastFirstId && listingIdStr === savedIdStr) {
                foundPreviousFirstId = true;
                this.onLog?.(`[MULTI-NEWEST] [DerStandard] [${label}] ✅ Reached previous first ID for ${key}: ${listingIdStr} - Stopping`);
                break;
              }

              try {
                const detail = await this.fetchDerStandardDetail(detailUrl);
                const { listing, reason } = this.parseDerStandardDetail(detail, detailUrl, key);

                if (listing) {
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

            if (foundPreviousFirstId) break;

          } catch (e: any) {
            this.onLog?.(`[MULTI-NEWEST] [DerStandard] [${label}] ⚠️ error page ${pageNumber}: ${e?.message || e}`);
          }

          pageNumber++;
          await sleep(withJitter(120, 80));
        }

        // Persist state
        const currentId = this.currentFirstListingIds[key];
        if (currentId) {
          await this.persistState(key, currentId);
          this.lastFirstListingIds[key] = currentId;
          this.onLog?.(`[MULTI-NEWEST] [DerStandard] [${label}] 💾 Saved state for ${key}: ${currentId}`);
        }
      } else {
        // First run - establish baseline
        this.onLog?.(`[MULTI-NEWEST] [DerStandard] [${label}] First run for ${key} - establishing baseline (fixed 3 pages)`);
        await this.scrapeDerStandardPages(key, baseUrl, 1, 3, label);

        const currentId = this.currentFirstListingIds[key];
        if (currentId) {
          await this.persistState(key, currentId);
          this.lastFirstListingIds[key] = currentId;
          this.onLog?.(`[MULTI-NEWEST] [DerStandard] [${label}] 💾 Saved initial state for ${key}: ${currentId}`);
        }
      }
    }
  }

  private async scrapeDerStandardPages(key: string, baseUrl: string, startPage: number, endPage: number, label: string): Promise<void> {
    for (let page = startPage; page <= endPage; page++) {
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
        const detailUrls = this.extractDerStandardUrls(html);

        this.onLog?.(`[MULTI-NEWEST] [DerStandard] [${label}] page ${page}: ${detailUrls.length} listings`);

        for (const detailUrl of detailUrls) {
          if (!this.isRunning) return;

          const listingId = detailUrl.match(/\/detail\/(\d+)/)?.[1];

          // Store first ID on page 1
          if (page === 1 && !this.currentFirstListingIds[key] && listingId) {
            this.currentFirstListingIds[key] = listingId;
          }

          try {
            const detail = await this.fetchDerStandardDetail(detailUrl);
            const { listing, reason } = this.parseDerStandardDetail(detail, detailUrl, key);

            if (listing) {
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

        // ✅ Geographic filter - check if location is in acquisition area
        const geoCheck = isInAkquiseGebiet(location, region);
        if (!geoCheck.allowed) {
          // Save to geo_blocked_listings table (async, don't wait)
          const { plz, ort } = extractPlzAndOrt(location);
          storage.saveGeoBlockedListing({
            title,
            price,
            location,
            area: area ? String(area) : null,
            eur_per_m2,
            description: null,
            phone_number: null,
            images: [],
            url,
            category,
            region,
            source: 'derstandard',
            original_scraped_at: new Date(),
            original_published_at: new Date(),
            original_last_changed_at: null,
            block_reason: geoCheck.reason,
            plz,
            ort,
          }).catch(err => console.log(`[SCRAPER] Geo-blocked save error (ignoring): ${err.message}`));

          return { listing: null, reason: `Außerhalb Akquise-Gebiet: ${geoCheck.reason} (${location})` };
        }

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
          rawData: props,
          // Don't set last_changed_at for new listings - will be set on first real change
          last_changed_at: undefined,
          published_at: new Date()
        };

        // Calculate quality score
        const qualityResult = calculateQualityScore(listing);

        return {
          listing: {
            ...listing,
            quality_score: qualityResult.total,
            quality_tier: qualityResult.tier,
            is_gold_find: qualityResult.isGoldFind,
          },
          reason: 'Private person (no company)'
        };
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

  private async scrapeImmoScout(maxPagesOrSmart: number, label: string): Promise<void> {
    const isQuickCheck = maxPagesOrSmart === 1;
    const MAX_SAFETY_PAGES = 20;

    for (const [key, baseUrl] of Object.entries(this.immoScoutUrls)) {
      if (!this.isRunning) return;

      this.onLog?.(`[MULTI-NEWEST] [ImmoScout] [${label}] 🔍 ${key}`);

      const categoryLastFirstId = this.lastFirstListingIds[key];
      const hasState = categoryLastFirstId !== null && categoryLastFirstId !== undefined;

      // Quick Check: Only page 1
      if (isQuickCheck) {
        await this.scrapeImmoScoutPages(key, baseUrl, 1, 1, label);
        continue;
      }

      // Full Scrape: Use smart pagination if we have state
      if (hasState) {
        this.onLog?.(`[MULTI-NEWEST] [ImmoScout] [${label}] 📌 Smart pagination for ${key} - searching for ID: ${categoryLastFirstId}`);

        let foundPreviousFirstId = false;
        let pageNumber = 1;

        while (!foundPreviousFirstId && pageNumber <= MAX_SAFETY_PAGES) {
          if (!this.isRunning) return;

          const url = pageNumber === 1 ? baseUrl : `${baseUrl}&pagenumber=${pageNumber}`;

          try {
            const headers = {
              'User-Agent': rotateUserAgent(),
              'Referer': 'https://www.immobilienscout24.at/',
              'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9',
            };

            const res = await proxyRequest(url, this.sessionCookies, { headers });
            const html = res.data as string;
            const hits = this.extractImmoScoutHits(html);

            this.onLog?.(`[MULTI-NEWEST] [ImmoScout] [${label}] page ${pageNumber}: ${hits.length} listings`);

            for (const hit of hits) {
              if (!this.isRunning) return;

              const listingId = hit.exposeId?.toString();

              // Store first ID on page 1
              if (pageNumber === 1 && !this.currentFirstListingIds[key] && listingId) {
                this.currentFirstListingIds[key] = listingId;
              }

              // Check if we've reached previous first ID
              // Convert both to strings to handle type mismatch
              const listingIdStr = listingId?.toString();
              const savedIdStr = categoryLastFirstId?.toString();
              if (categoryLastFirstId && listingIdStr === savedIdStr) {
                foundPreviousFirstId = true;
                this.onLog?.(`[MULTI-NEWEST] [ImmoScout] [${label}] ✅ Reached previous first ID for ${key}: ${listingIdStr} - Stopping`);
                break;
              }

              try {
                const detailUrl = hit.links?.absoluteURL;
                if (!detailUrl) continue;

                const detail = await this.fetchImmoScoutDetail(detailUrl);
                const productData = this.extractImmoScoutProduct(detail);

                if (!productData) continue;

                const { listing, reason } = this.buildImmoScoutListing(hit, productData, detailUrl, key);

                if (listing) {
                  try {
                    if (this.onListingFound) {
                      await this.onListingFound(listing);
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

            if (foundPreviousFirstId) break;

          } catch (e: any) {
            this.onLog?.(`[MULTI-NEWEST] [ImmoScout] [${label}] ⚠️ error page ${pageNumber}: ${e?.message || e}`);
          }

          pageNumber++;
          await sleep(withJitter(120, 80));
        }

        // Persist state
        const currentId = this.currentFirstListingIds[key];
        if (currentId) {
          await this.persistState(key, currentId);
          this.lastFirstListingIds[key] = currentId;
          this.onLog?.(`[MULTI-NEWEST] [ImmoScout] [${label}] 💾 Saved state for ${key}: ${currentId}`);
        }
      } else {
        // First run - establish baseline
        this.onLog?.(`[MULTI-NEWEST] [ImmoScout] [${label}] First run for ${key} - establishing baseline (fixed 3 pages)`);
        await this.scrapeImmoScoutPages(key, baseUrl, 1, 3, label);

        const currentId = this.currentFirstListingIds[key];
        if (currentId) {
          await this.persistState(key, currentId);
          this.lastFirstListingIds[key] = currentId;
          this.onLog?.(`[MULTI-NEWEST] [ImmoScout] [${label}] 💾 Saved initial state for ${key}: ${currentId}`);
        }
      }
    }
  }

  private async scrapeImmoScoutPages(key: string, baseUrl: string, startPage: number, endPage: number, label: string): Promise<void> {
    for (let page = startPage; page <= endPage; page++) {
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
        const hits = this.extractImmoScoutHits(html);

        this.onLog?.(`[MULTI-NEWEST] [ImmoScout] [${label}] page ${page}: ${hits.length} listings`);

        for (const hit of hits) {
          if (!this.isRunning) return;

          const listingId = hit.exposeId?.toString();

          // Store first ID on page 1
          if (page === 1 && !this.currentFirstListingIds[key] && listingId) {
            this.currentFirstListingIds[key] = listingId;
          }

          try {
            const detailUrl = hit.links?.absoluteURL;
            if (!detailUrl) continue;

            const detail = await this.fetchImmoScoutDetail(detailUrl);
            const productData = this.extractImmoScoutProduct(detail);

            if (!productData) continue;

            const { listing, reason } = this.buildImmoScoutListing(hit, productData, detailUrl, key);

            if (listing) {
              try {
                if (this.onListingFound) {
                  await this.onListingFound(listing);
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
        this.onLog?.(`[MULTI-NEWEST] [ImmoScout] [${label}] ❌ Error page ${page}: ${error?.message}`);
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

  private buildImmoScoutListing(hit: any, product: any, url: string, categoryKey: string): { listing: any | null; reason: string } {
    // Extract region and category from categoryKey
    // wien-wohnung, noe-wohnung, noe-haus
    const region = categoryKey.startsWith('wien') ? 'wien' : 'niederoesterreich';
    const category = categoryKey.includes('haus') ? 'haus' : 'eigentumswohnung';

    // Calculate €/m²
    const price = hit.primaryPrice || product.price;
    const area = hit.primaryArea;
    const eur_per_m2 = (price && area) ? (price / area).toFixed(2) : null;

    const location = hit.addressString || '';
    const title = product.title || hit.headline;

    // ✅ Geographic filter - check if location is in acquisition area
    const geoCheck = isInAkquiseGebiet(location, region);
    if (!geoCheck.allowed) {
      // Save to geo_blocked_listings table (async, don't wait)
      const { plz, ort } = extractPlzAndOrt(location);
      storage.saveGeoBlockedListing({
        title,
        price,
        location,
        area: area ? String(area) : null,
        eur_per_m2,
        description: product.description || null,
        phone_number: null,
        images: product.images || [],
        url,
        category,
        region,
        source: 'immoscout',
        original_scraped_at: new Date(),
        original_published_at: product.datePosted ? new Date(product.datePosted) : new Date(),
        original_last_changed_at: null,
        block_reason: geoCheck.reason,
        plz,
        ort,
      }).catch(err => console.log(`[SCRAPER] Geo-blocked save error (ignoring): ${err.message}`));

      return { listing: null, reason: `Außerhalb Akquise-Gebiet: ${geoCheck.reason} (${location})` };
    }

    const listing = {
      source: 'immoscout',
      title,
      description: product.description || null,
      price,
      area,
      rooms: hit.numberOfRooms,
      location,
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
      },
      // Don't set last_changed_at for new listings - will be set on first real change
      last_changed_at: undefined,
      published_at: product.datePosted ? new Date(product.datePosted) : new Date()
    };

    // Calculate quality score
    const qualityResult = calculateQualityScore(listing);

    return {
      listing: {
        ...listing,
        quality_score: qualityResult.total,
        quality_tier: qualityResult.tier,
        is_gold_find: qualityResult.isGoldFind,
      },
      reason: 'ok'
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
