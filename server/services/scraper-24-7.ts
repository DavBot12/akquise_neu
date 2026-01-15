import * as cheerio from 'cheerio';
import { storage } from '../storage';
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
  extractLocationFromJson,
  extractLocationFromDom,
  extractPhoneFromHtml,
  extractDetailUrlsWithISPRIVATE,
} from './scraper-utils';

interface ContinuousScrapingOptions {
  onProgress: (message: string) => void;
  onListingFound: (listing: any) => void;
}

export class ContinuousScraper247Service {
  private sessionCookies: string = '';
  private isRunning = false;
  private currentCycle = 0;
  private pageState: Record<string, number> = {};

  // ALL CATEGORIES - Scrape everything!
  private categories = [
    'eigentumswohnung-wien',
    'eigentumswohnung-niederoesterreich',
    'grundstueck-wien',
    'grundstueck-niederoesterreich',
    'haus-wien',
    'haus-niederoesterreich'
  ];

  // Allgemeine URLs OHNE Vorfilter - wir filtern selbst nach Keywords!
  private baseUrls: Record<string, string> = {
    'eigentumswohnung-wien': 'https://www.willhaben.at/iad/immobilien/eigentumswohnung/eigentumswohnung-angebote?areaId=900&areaId=903&rows=200',
    'eigentumswohnung-niederoesterreich': 'https://www.willhaben.at/iad/immobilien/eigentumswohnung/niederoesterreich?rows=200',
    'grundstueck-wien': 'https://www.willhaben.at/iad/immobilien/grundstuecke/grundstueck-angebote?areaId=900&areaId=903&rows=200',
    'grundstueck-niederoesterreich': 'https://www.willhaben.at/iad/immobilien/grundstuecke/niederoesterreich?rows=200',
    'haus-wien': 'https://www.willhaben.at/iad/immobilien/haus-kaufen/wien?rows=200',
    'haus-niederoesterreich': 'https://www.willhaben.at/iad/immobilien/haus-kaufen/niederoesterreich?rows=200'
  };

  async start247Scraping(options: ContinuousScrapingOptions): Promise<void> {
    if (this.isRunning) {
      options.onProgress('[24/7] Scraper laeuft bereits!');
      return;
    }

    this.isRunning = true;
    options.onProgress('[24/7] SCRAPER GESTARTET - Kontinuierlicher Modus aktiviert!');

    // Startet die kontinuierliche Schleife
    this.continuousScanLoop(options);
  }

  stop247Scraping(onProgress?: (message: string) => void): void {
    this.isRunning = false;
    onProgress?.('[24/7] ⛔ STOP Signal gesendet');
  }

  getStatus(): { isRunning: boolean; currentCycle: number } {
    return {
      isRunning: this.isRunning,
      currentCycle: this.currentCycle
    };
  }

  private async continuousScanLoop(options: ContinuousScrapingOptions): Promise<void> {
    while (this.isRunning) {
      this.currentCycle++;

      try {
        options.onProgress(`[24/7] CYCLE ${this.currentCycle} - Scanne ALLE 4 Kategorien PARALLEL!`);

        // Session etablieren
        await this.establishSession(options.onProgress);
        // Load state once per cycle from DB
        await this.loadStateSafe();

        // PARALLEL: Alle 4 Kategorien gleichzeitig!
        const categoryPromises = this.categories.map(category =>
          this.scanSingleCategory(category, options)
        );

        // Warte bis ALLE Kategorien fertig sind
        await Promise.all(categoryPromises);

        options.onProgress(`[24/7] CYCLE ${this.currentCycle} COMPLETE - Alle 4 Kategorien fertig!`);
        
        // Pause zwischen Zyklen
        const cycleDelay = 60000 + Math.random() * 60000; // 1-2 Min
        options.onProgress(`[24/7] CYCLE COMPLETE - Pause ${Math.round(cycleDelay/60000)}min bis naechster Zyklus`);
        await sleep(cycleDelay);
        
      } catch (error) {
        options.onProgress(`[24/7] ERROR Cycle ${this.currentCycle}: ${error}`);

        // Bei Fehler Pause
        await sleep(120000); // 2 Minuten
      }
    }

    options.onProgress('[24/7] SCRAPER GESTOPPT');
  }

  private async scanSingleCategory(category: string, options: ContinuousScrapingOptions): Promise<void> {
    const maxPages = Number(process.env.SCRAPER_247_MAX_PAGES || '999'); // UNBEGRENZT!
    let current = this.pageState[category] ?? 1;

    options.onProgress(`[24/7] START: ${category} ab Seite ${current}`);

    // Loop durch ALLE Seiten bis keine URLs mehr
    let emptyPageCount = 0;
    while (this.isRunning && emptyPageCount < 3) { // Stop nach 3 leeren Seiten
      // Retry logic with exponential backoff
      let retries = 3;
      let success = false;

      while (retries > 0 && !success) {
        try {
          const { urls, isPrivate0, isPrivate1 } = await this.getPageUrls(category, current);

          // Wenn keine URLs mehr -> wahrscheinlich am Ende
          if (urls.length === 0) {
            emptyPageCount++;
            options.onProgress(`[24/7] ${category} Seite ${current}: Leer (${emptyPageCount}/3)`);
            if (emptyPageCount >= 3) {
              options.onProgress(`[24/7] ${category}: Ende erreicht - Reset auf Seite 1`);
              this.pageState[category] = 1;
              await this.saveStateSafe();
              return;
            }
            current++;
            success = true;
            break;
          }

          emptyPageCount = 0; // Reset wenn URLs gefunden
          options.onProgress(`[24/7] ${category} Seite ${current}: ${urls.length} URLs → ${isPrivate1} privat (ISPRIVATE=1), ${isPrivate0} kommerziell (ISPRIVATE=0)`);

          let foundCount = 0;
          let skippedCount = 0;

          for (const url of urls) {
            if (!this.isRunning) break;
            const listing = await this.processListing(url, category, options.onProgress);
            if (listing) {
              foundCount++;
              options.onListingFound(listing);
              options.onProgress(`[24/7] FUND #${foundCount}: ${listing.title} - EUR ${listing.price}`);
            } else {
              skippedCount++;
            }
            await sleep(60 + Math.random() * 120); // 60-180ms wie V3
          }

          options.onProgress(`[24/7] ${category} Seite ${current}: ${foundCount} private, ${skippedCount} gefiltert`);

          // Naechste Seite
          current++;
          this.pageState[category] = current;
          await this.saveStateSafe();
          success = true;

        } catch (error: any) {
          retries--;
          if (retries > 0) {
            const backoff = (4 - retries) * 5000; // 5s, 10s, 15s
            options.onProgress(`[24/7] Error ${category}: ${error?.message || error} - Retry in ${backoff/1000}s (${retries} left)`);
            await sleep(backoff);
          } else {
            options.onProgress(`[24/7] FATAL ${category}: ${error?.message || error} - Skipping page ${current}`);
            current++;
            this.pageState[category] = current;
            await this.saveStateSafe();
            success = true; // Continue to next page
          }
        }
      }
    }
  }

  private async getPageUrls(category: string, page: number): Promise<{ urls: string[]; isPrivate0: number; isPrivate1: number }> {
    const baseUrl = this.baseUrls[category];
    if (!baseUrl) return { urls: [], isPrivate0: 0, isPrivate1: 0 };

    const url = `${baseUrl}&page=${page}`;

    const response = await proxyRequest(url, this.sessionCookies, {
      headers: { 'User-Agent': rotateUserAgent() }
    });

    if (response.status >= 400) {
      return { urls: [], isPrivate0: 0, isPrivate1: 0 };
    }

    const html = response.data;
    const { filteredUrls, commercialCount, privateCount } = extractDetailUrlsWithISPRIVATE(html);

    return {
      urls: filteredUrls,
      isPrivate0: commercialCount,
      isPrivate1: privateCount
    };
  }

  private async processListing(url: string, category: string, onProgress: (msg: string) => void): Promise<any | null> {
    try {
      const response = await proxyRequest(url, this.sessionCookies, {
        headers: { 'User-Agent': rotateUserAgent() }
      });

      const html = response.data;
      const $ = cheerio.load(html);
      const bodyText = $('body').text().toLowerCase();

      // 24/7 Scraper: NUR PRIVATE LISTINGS!
      // 1. Commercial-Filter (Bauträger, Projektentwickler etc.)
      const commercial = [
        'neubauprojekt','erstbezug','bauträger','anleger','wohnprojekt','immobilienmakler','provisionsaufschlag','fertigstellung','projektentwicklung','immobilienvertrieb','immobilienbüro'
      ];
      if (commercial.some(k => bodyText.includes(k))) return null;

      // 2. Private-Filter: NUR Listings mit Private-Keywords
      const privateKeywords = [
        'privatverkauf','privat verkauf','von privat','privater verkäufer','privater anbieter','ohne makler','verkaufe privat','privat zu verkaufen','eigenheim verkauf','private anzeige'
      ];

      const foundPrivate = privateKeywords.find(keyword =>
        bodyText.includes(keyword.toLowerCase())
      );

      if (!foundPrivate) return null; // Kein Private-Keyword → Skip!

      // Extrahiere Private Listings using shared utils
      const title = extractTitle($);
      const price = extractPrice($, bodyText);
      const areaStr = extractArea($, bodyText);
      const area = areaStr ? parseInt(areaStr) : 0;
      const locJson = extractLocationFromJson(html);
      const location = locJson || extractLocationFromDom($, url);
      const phoneNumber = extractPhoneFromHtml(html, $);
      const images = extractImages($, html);
      const lastChangedAt = extractLastChanged($, html);
      const description = extractDescription($);

      const region = category.includes('wien') ? 'wien' : 'niederoesterreich';
      const listingCategory = category.includes('eigentumswohnung')
        ? 'eigentumswohnung'
        : category.includes('haus')
          ? 'haus'
          : 'grundstueck';
      if (price <= 0) return null;
      const eurPerM2 = area > 0 ? Math.round(price / area) : 0;

      return {
        title,
        price,
        area: areaStr || null,
        location,
        url,
        images,
        description,
        phone_number: phoneNumber || null,
        category: listingCategory,
        region,
        eur_per_m2: eurPerM2 ? String(eurPerM2) : null,
        last_changed_at: lastChangedAt
      };

    } catch (error) {
      return null;
    }
  }

  private async establishSession(onProgress: (msg: string) => void): Promise<void> {
    try {
      const response = await proxyRequest('https://www.willhaben.at', '', {
        headers: { 'User-Agent': rotateUserAgent() }
      });
      const cookies = response.headers['set-cookie'];
      if (cookies) {
        this.sessionCookies = cookies.map((cookie: string) => cookie.split(';')[0]).join('; ');
      }
      onProgress('[24/7] Session established via proxy');
      await sleep(withJitter(1500, 500));
    } catch (error) {
      // Ignoriere Session-Fehler im 24/7 Modus
    }
  }

  private async loadStateSafe(): Promise<void> {
    const map = await storage.getAllScraperState();
    this.pageState = {};
    for (const cat of this.categories) {
      const key = cat; // use category as key
      const next = map[key] ?? 1;
      this.pageState[cat] = next >= 1 ? next : 1;
    }
  }

  private async saveStateSafe(): Promise<void> {
    const entries = Object.entries(this.pageState);
    for (const [cat, next] of entries) {
      await storage.setScraperNextPage(cat, next);
    }
  }
}