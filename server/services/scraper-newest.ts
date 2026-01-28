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

export class NewestScraperService {
  private isRunning = false;
  private intervalHandle: NodeJS.Timeout | null = null;
  private currentCycle = 0;
  private nextCycleTime: Date | null = null;
  private sessionCookies = '';
  private requestCount = 0;

  // Smart pagination state - PER CATEGORY (4 states total - ISPRIVATE filter removes need for 2 phases)
  private lastFirstListingIds: Record<string, string | null> = {};
  private currentFirstListingIds: Record<string, string | null> = {};

  // Quick-check state: stores ALL private IDs on page 1 (for detecting new listings anywhere on page)
  private page1PrivateIds: Record<string, string[]> = {};

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
            'User-Agent': rotateUserAgent(),
            'Referer': page > 1 ? `${baseUrl}&page=${page-1}` : 'https://www.willhaben.at/',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8',
          };

          const res = await proxyRequest(url, this.sessionCookies, { headers });
          const html = res.data as string;

          // ULTRA-FAST: Filter URLs by ISPRIVATE=1 from search page
          const { filteredUrls, totalOnPage, privateCount, commercialCount } = extractDetailUrlsWithISPRIVATE(html);
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
                const $detail = load(detail);
                const phone = extractPhoneFromHtml(detail, $detail);
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
            'User-Agent': rotateUserAgent(),
            'Referer': pageNumber > 1 ? `${baseUrl}&page=${pageNumber-1}` : 'https://www.willhaben.at/',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8',
          };

          const res = await proxyRequest(url, this.sessionCookies, { headers });
          const html = res.data as string;

          // ULTRA-FAST: Filter URLs by ISPRIVATE=1 from search page
          const { filteredUrls, totalOnPage, privateCount, commercialCount } = extractDetailUrlsWithISPRIVATE(html);

          onLog?.(`[NEWEST] [${label}] page ${pageNumber}: ${totalOnPage} total → ${privateCount} privat (ISPRIVATE=1), ${commercialCount} kommerziell (ISPRIVATE=0)`);

          // Process each PRIVATE listing - FETCH DETAIL PAGE for ALL data
          const isDebug = process.env.DEBUG_SCRAPER === 'true';

          if (isDebug) {
            onLog?.(`[NEWEST] [${label}] 🔄 Processing ${filteredUrls.length} PRIVATE listings...`);
          }

          for (const detailUrl of filteredUrls) {
            if (!this.isRunning) return;

            // Extract listing ID
            const listingId = extractListingIdFromUrl(detailUrl);

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
            onLog?.(`[NEWEST] [${label}] 🔍 Checking ID: ${listingId} vs saved: ${categoryLastFirstId} (match: ${listingId === categoryLastFirstId})`);
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
                const $detailPhone = load(detail);
                const phone = extractPhoneFromHtml(detail, $detailPhone);
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

  private async establishSession(onLog?: (m: string) => void) {
    try {
      const res = await proxyRequest('https://www.willhaben.at', '', { headers: { 'User-Agent': rotateUserAgent() } });
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

  private async fetchDetail(url: string): Promise<string> {
    // Refresh session every 50 requests to avoid stale cookies
    this.requestCount++;
    if (this.requestCount % 50 === 0) {
      await this.establishSession();
    }

    const headers = {
      'User-Agent': rotateUserAgent(),
      'Referer': 'https://www.willhaben.at/iad/immobilien/',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8',
    };
    const res = await proxyRequest(url, this.sessionCookies, { headers });
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

    const region = key.includes('wien') ? 'wien' : 'niederoesterreich';
    const category = key.includes('eigentumswohnung')
      ? 'eigentumswohnung'
      : key.includes('haus')
        ? 'haus'
        : 'grundstueck';

    const locJson = extractLocationFromJson(html);
    const location = locJson || extractLocationFromDom($, url) || (key.includes('wien') ? 'Wien' : 'Niederösterreich');

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

  /**
   * QUICK CHECK: Lightweight check of first page only
   * Returns true if ANY private listing ID on page 1 is new (not seen before)
   *
   * FIX: Previously only compared first ID - missed new listings at positions 2-90
   * Now: Extracts ALL private IDs and checks if any are new
   */
  private async quickCheck(): Promise<boolean> {
    try {
      // Check first category's first page (eigentumswohnung-wien)
      const categoryKey = 'eigentumswohnung-wien';
      const baseUrl = this.baseUrls[categoryKey];
      const url = `${baseUrl}&page=1`;

      const headers = {
        'User-Agent': rotateUserAgent(),
        'Referer': 'https://www.willhaben.at/',
      };

      const res = await proxyRequest(url, this.sessionCookies, { headers });
      const html = res.data as string;

      // Extract ALL private listing IDs from page 1
      const { filteredUrls } = extractDetailUrlsWithISPRIVATE(html);
      if (filteredUrls.length === 0) {
        this.onLog?.('[QUICK-CHECK] No private listings found on first page');
        return false;
      }

      // Get all current private IDs on page 1
      const currentIds = filteredUrls
        .map(url => extractListingIdFromUrl(url))
        .filter(id => id !== null) as string[];

      // Get stored IDs from last check
      const lastIdsKey = `${categoryKey}_page1_ids`;
      const lastIds = this.page1PrivateIds?.[lastIdsKey] || [];

      // First run - store IDs and don't trigger
      if (lastIds.length === 0) {
        this.page1PrivateIds = this.page1PrivateIds || {};
        this.page1PrivateIds[lastIdsKey] = currentIds;
        this.onLog?.(`[QUICK-CHECK] First run - stored ${currentIds.length} IDs for ${categoryKey}`);
        return false;
      }

      // Check for NEW IDs (not in last check)
      const lastIdSet = new Set(lastIds);
      const newIds = currentIds.filter(id => !lastIdSet.has(id));

      // Update stored IDs for next check
      this.page1PrivateIds[lastIdsKey] = currentIds;

      if (newIds.length > 0) {
        this.onLog?.(`[QUICK-CHECK] ${categoryKey} - Found ${newIds.length} NEW private listings: ${newIds.slice(0, 3).join(', ')}${newIds.length > 3 ? '...' : ''}`);
        return true;
      }

      this.onLog?.(`[QUICK-CHECK] ${categoryKey} - No new listings (${currentIds.length} private on page 1)`);
      return false;
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
