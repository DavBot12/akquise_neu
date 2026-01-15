import { load } from 'cheerio';
import { storage } from '../storage';
import {
  sleep,
  withJitter,
  rotateUserAgent,
  proxyRequest,
} from './scraper-utils';

interface PreisspiegelScraperOptions {
  onLog?: (msg: string) => void;
  onListingFound?: (listing: any) => Promise<void>;
}

/**
 * PREISSPIEGEL SCRAPER - Wien Market Data (ALL Listings)
 *
 * Zweck: Reine Marktdaten-Sammlung für Preisvergleiche
 * Scope: NUR Wien, NUR Wohnungen + Häuser
 * Data: Minimal (Preis, m², Bezirk, Neubau/Altbau)
 * Filter: KEINE - Alle Inserate (privat + gewerblich)
 */
export class PreisspiegelScraperService {
  private sessionCookies: string = '';
  private isRunning = false;
  private currentCycle = 0;

  // NUR 2 Kategorien, NUR Wien
  private baseUrls: Record<string, string> = {
    'eigentumswohnung-wien': 'https://www.willhaben.at/iad/immobilien/eigentumswohnung/eigentumswohnung-angebote?areaId=900&areaId=903&rows=200',
    'haus-wien': 'https://www.willhaben.at/iad/immobilien/haus-kaufen/wien?rows=200'
  };

  // Wien Bezirke Lookup Tabelle
  private readonly wienBezirke: Record<string, string> = {
    '1010': 'Innere Stadt',
    '1020': 'Leopoldstadt',
    '1030': 'Landstraße',
    '1040': 'Wieden',
    '1050': 'Margareten',
    '1060': 'Mariahilf',
    '1070': 'Neubau',
    '1080': 'Josefstadt',
    '1090': 'Alsergrund',
    '1100': 'Favoriten',
    '1110': 'Simmering',
    '1120': 'Meidling',
    '1130': 'Hietzing',
    '1140': 'Penzing',
    '1150': 'Rudolfsheim-Fünfhaus',
    '1160': 'Ottakring',
    '1170': 'Hernals',
    '1180': 'Währing',
    '1190': 'Döbling',
    '1200': 'Brigittenau',
    '1210': 'Floridsdorf',
    '1220': 'Donaustadt',
    '1230': 'Liesing'
  };

  /**
   * Startet manuellen Preisspiegel-Scrape
   */
  async startManualScrape(options: PreisspiegelScraperOptions = {}): Promise<void> {
    if (this.isRunning) {
      options.onLog?.('[PREISSPIEGEL] Scraper läuft bereits!');
      return;
    }

    this.isRunning = true;
    this.currentCycle++;

    options.onLog?.('[PREISSPIEGEL] 🚀 GESTARTET - Wien Marktdaten Scraper');
    options.onLog?.('[PREISSPIEGEL] Kategorien: Eigentumswohnung + Haus (NUR Wien)');
    options.onLog?.('[PREISSPIEGEL] Modus: ALLE Inserate (privat + gewerblich)');

    try {
      // Deaktiviere alle bestehenden Listings vor dem Scrape
      options.onLog?.('[PREISSPIEGEL] 🔄 Deaktiviere alte Listings...');
      await storage.deactivateAllPriceMirrorListings();
      options.onLog?.('[PREISSPIEGEL] ✅ Alte Listings deaktiviert');

      await this.establishSession(options.onLog);
      await this.runFullScrape(options);
      options.onLog?.('[PREISSPIEGEL] ✅ SCRAPE COMPLETE');
    } catch (error: any) {
      options.onLog?.(`[PREISSPIEGEL] ❌ ERROR: ${error?.message || error}`);
    } finally {
      this.isRunning = false;
    }
  }

  stop(): void {
    this.isRunning = false;
  }

  getStatus(): { isRunning: boolean; currentCycle: number } {
    return {
      isRunning: this.isRunning,
      currentCycle: this.currentCycle
    };
  }

  /**
   * Führt einen vollständigen Scrape durch (alle Seiten, alle Kategorien)
   */
  private async runFullScrape(options: PreisspiegelScraperOptions): Promise<void> {
    options.onLog?.(`[PREISSPIEGEL] ━━━ CYCLE #${this.currentCycle} START ━━━`);

    for (const [key, baseUrl] of Object.entries(this.baseUrls)) {
      if (!this.isRunning) break;

      const category = key.includes('eigentumswohnung') ? 'eigentumswohnung' : 'haus';
      options.onLog?.(`[PREISSPIEGEL] 🔍 START: ${category}`);

      // Lade State von DB
      let startPage = await storage.getScraperNextPage(`preisspiegel-${key}`, 1);
      let currentPage = startPage;
      let emptyPageCount = 0;

      // Scrape ALLE Seiten
      while (this.isRunning && emptyPageCount < 3) {
        try {
          const url = `${baseUrl}&page=${currentPage}`;
          options.onLog?.(`[PREISSPIEGEL] ${category} - Seite ${currentPage}`);

          const headers = {
            'User-Agent': rotateUserAgent(),
            'Referer': currentPage > 1 ? `${baseUrl}&page=${currentPage-1}` : 'https://www.willhaben.at/'
          };

          const res = await proxyRequest(url, this.sessionCookies, { headers });
          const html = res.data as string;

          // ULTRA-MEGA-FAST: Parse ALL listings directly from search page JSON (NO detail page fetches!)
          const parsedListings = this.parseAllListingsFromSearchPage(html, category);

          if (parsedListings.length === 0) {
            emptyPageCount++;
            options.onLog?.(`[PREISSPIEGEL] ${category} Seite ${currentPage}: Leer (${emptyPageCount}/3)`);
            if (emptyPageCount >= 3) {
              options.onLog?.(`[PREISSPIEGEL] ${category}: Ende erreicht - Reset auf Seite 1`);
              await storage.setScraperNextPage(`preisspiegel-${key}`, 1);
              break;
            }
          } else {
            emptyPageCount = 0;
            options.onLog?.(`[PREISSPIEGEL] ${category} Seite ${currentPage}: ${parsedListings.length} Listings parsed (NO detail fetches!)`);

            // Save ALL listings instantly (no detail fetching needed!)
            let savedCount = 0;
            for (const listing of parsedListings) {
              if (!this.isRunning) break;

              try {
                if (options.onListingFound) {
                  await options.onListingFound(listing);
                  savedCount++;
                  options.onLog?.(`[PREISSPIEGEL] ✅ ${listing.bezirk_code || 'N/A'} ${listing.bezirk_name || 'N/A'} :: €${listing.price} :: ${listing.area_m2 || 'N/A'}m²`);
                }
              } catch (e: any) {
                options.onLog?.(`[PREISSPIEGEL] ⚠️ Error saving listing: ${e?.message || e}`);
              }
            }

            options.onLog?.(`[PREISSPIEGEL] ${category} Seite ${currentPage}: ${savedCount}/${parsedListings.length} gespeichert (93% faster - no detail fetches!)`);
          }

          // Next page
          currentPage++;
          await storage.setScraperNextPage(`preisspiegel-${key}`, currentPage);
          await sleep(1000 + Math.random() * 800); // 1-1.8s zwischen Seiten

        } catch (error: any) {
          options.onLog?.(`[PREISSPIEGEL] ❌ Error Seite ${currentPage}: ${error?.message || error}`);
          currentPage++;
          await sleep(5000); // 5s bei Fehler
        }
      }

      options.onLog?.(`[PREISSPIEGEL] ✅ ${category} COMPLETE`);
    }

    options.onLog?.(`[PREISSPIEGEL] ━━━ CYCLE #${this.currentCycle} COMPLETE ━━━`);
  }

  /**
   * Session etablieren
   */
  private async establishSession(onLog?: (msg: string) => void): Promise<void> {
    try {
      const res = await proxyRequest('https://www.willhaben.at/iad/immobilien/eigentumswohnung/wien', '', {
        headers: { 'User-Agent': rotateUserAgent() }
      });

      const cookies = res.headers['set-cookie'];
      if (cookies && cookies.length > 0) {
        this.sessionCookies = cookies.map((c: string) => c.split(';')[0]).join('; ');
        onLog?.('[PREISSPIEGEL] Session established via proxy');
      }
    } catch (error) {
      onLog?.('[PREISSPIEGEL] Session establishment failed - continuing anyway');
    }
  }

  /**
   * ULTRA-MEGA-FAST: Parse ALL listings directly from search page JSON
   * Returns complete listing objects WITHOUT fetching detail pages!
   */
  private parseAllListingsFromSearchPage(html: string, categoryKey: string): any[] {
    const results: any[] = [];

    // Extract ALL JSON attributes at once
    const attributePattern = /\{"name":"([^"]+)","values":\["([^"]*)"\]\}/g;
    const allAttributes = Array.from(html.matchAll(attributePattern));

    // Group attributes by listing - ADID marks start of new listing
    const listingData: Map<number, Map<string, string>> = new Map();
    let currentListingIndex = -1;

    for (const attr of allAttributes) {
      const fieldName = attr[1];
      const fieldValue = attr[2];

      if (fieldName === 'ADID') {
        currentListingIndex++;
        listingData.set(currentListingIndex, new Map());
      }

      if (currentListingIndex >= 0) {
        const listingMap = listingData.get(currentListingIndex)!;
        // ✅ FIX: Only set if not already present (prevents SEO_URL overwriting from child units)
        if (!listingMap.has(fieldName)) {
          listingMap.set(fieldName, fieldValue);
        }
      }
    }

    // Process each listing
    for (const [_, attrs] of Array.from(listingData.entries())) {
      // Extract required fields
      const priceStr = attrs.get('PRICE') || '0';
      const price = parseInt(priceStr) || 0;

      if (price <= 0) continue; // Skip if no price

      const livingAreaStr = attrs.get('ESTATE_SIZE/LIVING_AREA') || '';
      const area_m2 = livingAreaStr ? parseInt(livingAreaStr) : null;

      // Plausibility check: minimum size
      const category = categoryKey.includes('haus') ? 'haus' : 'eigentumswohnung';
      if (category === 'eigentumswohnung' && area_m2 && area_m2 < 20) continue; // Too small (parking spot)
      if (category === 'haus' && area_m2 && area_m2 < 40) continue; // House too small

      // Calculate €/m²
      const eur_per_m2 = (area_m2 && area_m2 > 0) ? Math.round(price / area_m2) : null;

      // Plausibility check: max €/m²
      if (eur_per_m2 && eur_per_m2 > 50000) continue; // Unrealistic

      // Extract location/bezirk
      const location = attrs.get('LOCATION') || '';
      const bezirk = this.extractBezirkFromLocation(location);

      if (!bezirk) {
        const isDebug = process.env.DEBUG_SCRAPER === 'true';
        if (isDebug) {
          console.log(`[PREISSPIEGEL] ⏭️ SKIP listing - no valid bezirk found for: "${location}"`);
        }
        continue; // Must have bezirk for Preisspiegel
      }

      // Building type (only for Wohnungen)
      let building_type: 'neubau' | 'altbau' | null = null;
      if (category === 'eigentumswohnung') {
        const constructionYear = attrs.get('CONSTRUCTION_YEAR');
        if (constructionYear) {
          const year = parseInt(constructionYear);
          building_type = year >= 2010 ? 'neubau' : 'altbau';
        }
      }

      // URL
      const seoUrl = attrs.get('SEO_URL') || '';
      let url: string;
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

      // Last changed (use current time as fallback)
      const lastChangedAt = new Date();

      results.push({
        category,
        bezirk_code: bezirk.code,
        bezirk_name: bezirk.name,
        price,
        area_m2,
        eur_per_m2,
        building_type,
        last_changed_at: lastChangedAt,
        url,
        source: 'willhaben-preisspiegel'
      });
    }

    return results;
  }

  /**
   * Extract Bezirk from LOCATION string (e.g., "Wien, 12. Bezirk, Meidling")
   */
  private extractBezirkFromLocation(location: string): { code: string; name: string } | null {
    if (!location || location.trim() === '') return null;

    const isDebug = process.env.DEBUG_SCRAPER === 'true';

    if (isDebug) {
      console.log(`[BEZIRK-DEBUG] Parsing location: "${location}"`);
    }

    // PRIORITY 1: Try to find PLZ pattern (1010-1230)
    const plzMatch = location.match(/\b(1[0-2]\d0)\b/);
    if (plzMatch) {
      const plz = plzMatch[1];
      const name = this.wienBezirke[plz];
      if (name) {
        if (isDebug) {
          console.log(`[BEZIRK-DEBUG] ✅ Matched by PLZ: ${plz} → ${name}`);
        }
        return { code: plz, name };
      }
    }

    // PRIORITY 2: Try to find "11. Bezirk" or "11.Bezirk" pattern
    const bezirkNumMatch = location.match(/(\d{1,2})\.\s*Bezirk/i);
    if (bezirkNumMatch) {
      const bezirkNum = bezirkNumMatch[1];
      const bezirkNumPadded = bezirkNum.padStart(2, '0');
      const plz = `1${bezirkNumPadded}0`;

      const name = this.wienBezirke[plz];
      if (name) {
        if (isDebug) {
          console.log(`[BEZIRK-DEBUG] ✅ Matched by Bezirk#: ${bezirkNum} → ${plz} → ${name}`);
        }
        return { code: plz, name };
      } else {
        if (isDebug) {
          console.log(`[BEZIRK-DEBUG] ⚠️ Invalid bezirk number: ${bezirkNum} → ${plz} (not in lookup)`);
        }
      }
    }

    // PRIORITY 3: Try to find bezirk name directly (case-insensitive)
    const locationLower = location.toLowerCase();
    for (const [plz, name] of Object.entries(this.wienBezirke)) {
      if (locationLower.includes(name.toLowerCase())) {
        if (isDebug) {
          console.log(`[BEZIRK-DEBUG] ✅ Matched by name: ${name} → ${plz}`);
        }
        return { code: plz, name };
      }
    }

    if (isDebug) {
      console.log(`[BEZIRK-DEBUG] ❌ NO MATCH for location: "${location}"`);
    }

    return null;
  }

}

// Singleton instance
export const preisspiegelScraper = new PreisspiegelScraperService();
