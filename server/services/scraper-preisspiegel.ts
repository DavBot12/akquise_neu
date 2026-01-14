import axios, { AxiosInstance } from 'axios';
import * as cheerio from 'cheerio';
import { load } from 'cheerio';
import { ProxyAgent, fetch as undiciFetch } from 'undici';
import { proxyManager } from './proxy-manager';
import { storage } from '../storage';

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
  private axiosInstance: AxiosInstance;
  private sessionCookies: string = '';
  private isRunning = false;
  private currentCycle = 0;

  private userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0'
  ];

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

  constructor() {
    this.axiosInstance = axios.create({
      timeout: 30000,
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8',
        'Cache-Control': 'no-cache'
      }
    });
  }

  /**
   * Proxy Request mit undici (wie in scraper-newest.ts)
   * In dev mode: direct connection without proxy
   */
  private async proxyRequest(url: string, options: any = {}): Promise<any> {
    const proxyUrl = proxyManager.getProxyUrl();
    // In dev mode proxyUrl is undefined - use direct connection
    const dispatcher = proxyUrl ? new ProxyAgent(proxyUrl) : undefined;

    const headers: Record<string, string> = {
      'User-Agent': options.headers?.['User-Agent'] || this.getRandomUA(),
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
      // Only add dispatcher if using proxy
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
            'User-Agent': this.getRandomUA(),
            'Referer': currentPage > 1 ? `${baseUrl}&page=${currentPage-1}` : 'https://www.willhaben.at/'
          };

          const res = await this.proxyRequest(url, { headers });
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
          await this.sleep(1000 + Math.random() * 800); // 1-1.8s zwischen Seiten

        } catch (error: any) {
          options.onLog?.(`[PREISSPIEGEL] ❌ Error Seite ${currentPage}: ${error?.message || error}`);
          currentPage++;
          await this.sleep(5000); // 5s bei Fehler
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
      const res = await this.proxyRequest('https://www.willhaben.at/iad/immobilien/eigentumswohnung/wien', {
        headers: { 'User-Agent': this.getRandomUA() }
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

  /**
   * Extrahiert Detail-URLs von einer Listing-Seite (OLD - not needed anymore!)
   */
  private extractDetailUrls(html: string): string[] {
    const $ = load(html);
    const urls: string[] = [];

    // Mehrere Selektoren für robuste Extraktion
    const selectors = [
      'a[href*="/iad/immobilien/d/"]',
      'a[data-testid*="result-item"]',
      '.result-item a'
    ];

    selectors.forEach(selector => {
      $(selector).each((_, element) => {
        const href = $(element).attr('href');
        if (href && href.includes('/iad/immobilien/d/')) {
          const fullUrl = href.startsWith('http') ? href : `https://www.willhaben.at${href}`;
          urls.push(fullUrl);
        }
      });
    });

    // Regex Fallback für URLs im HTML
    const regexMatches = html.match(/"(\/iad\/immobilien\/d\/[^"\s>]+)"/g) || [];
    for (const match of regexMatches) {
      const path = match.replace(/"/g, '');
      const fullUrl = `https://www.willhaben.at${path}`;
      urls.push(fullUrl);
    }

    // Deduplizieren und zurückgeben
    return Array.from(new Set(urls));
  }

  /**
   * Fetcht Detail-Seite
   */
  private async fetchDetail(url: string): Promise<string> {
    const headers = {
      'User-Agent': this.getRandomUA(),
      'Referer': 'https://www.willhaben.at/'
    };

    const res = await this.proxyRequest(url, { headers });

    // Update session cookies from response
    const newCookies = res.headers['set-cookie'];
    if (newCookies && newCookies.length > 0) {
      this.sessionCookies = newCookies.map((c: string) => c.split(';')[0]).join('; ');
    }

    return res.data as string;
  }

  /**
   * Parsed Detail-Seite - MINIMAL (nur Marktdaten)
   * Kopiert von scraper-newest.ts - bewährte Logik 1:1
   */
  private parseDetailMinimal(html: string, url: string, category: 'eigentumswohnung' | 'haus', onLog?: (msg: string) => void): any | null {
    const $ = load(html);
    const bodyText = $('body').text().toLowerCase();

    // Preis extrahieren (1:1 von newest)
    const price = this.extractPrice($, bodyText);
    if (price <= 0) {
      onLog?.(`[PREISSPIEGEL] ⚠️ Skip (kein Preis): ${url.substring(0, 60)}`);
      return null;
    }

    // Fläche extrahieren (1:1 von newest)
    const areaStr = this.extractArea($, bodyText);
    const area = areaStr ? parseInt(areaStr) : 0;

    // Plausibilitäts-Check: Mindestgröße für Wohnungen/Häuser
    if (category === 'eigentumswohnung' && area > 0 && area < 20) {
      onLog?.(`[PREISSPIEGEL] ⚠️ Skip (zu klein): ${area}m² (wahrscheinlich Stellplatz)`);
      return null;
    }
    if (category === 'haus' && area > 0 && area < 40) {
      onLog?.(`[PREISSPIEGEL] ⚠️ Skip (Haus zu klein): ${area}m²`);
      return null;
    }

    // €/m² berechnen (1:1 von newest)
    const eurPerM2 = area > 0 ? Math.round(price / area) : 0;

    // Plausibilitäts-Check: Max €/m²
    if (eurPerM2 > 50000) {
      onLog?.(`[PREISSPIEGEL] ⚠️ Skip (unrealistischer €/m²): €${eurPerM2}/m²`);
      return null;
    }

    // Bezirk extrahieren
    const bezirk = this.extractBezirk($, html);
    if (!bezirk) return null;

    // Building Type extrahieren (NUR für Wohnungen)
    let buildingType: 'neubau' | 'altbau' | null = null;
    if (category === 'eigentumswohnung') {
      buildingType = this.extractBuildingType($, html);
    }

    // Last Changed extrahieren
    const lastChangedAt = this.extractLastChanged($, html);

    return {
      category,
      bezirk_code: bezirk.code,
      bezirk_name: bezirk.name,
      building_type: buildingType,
      price: price.toString(),
      area_m2: areaStr || null,
      eur_per_m2: eurPerM2 ? String(eurPerM2) : null,
      url,
      last_changed_at: lastChangedAt,
      is_active: true
    };
  }

  /**
   * Extrahiert Bezirk (Code + Name)
   */
  private extractBezirk($: cheerio.CheerioAPI, html: string): { code: string; name: string } | null {
    // Methode 1: Strukturierte JSON-Daten (wie in scraper-newest.ts)
    try {
      const postalMatch = html.match(/"postalCode"\s*:\s*"(\d{4})"/i);
      if (postalMatch) {
        const plz = postalMatch[1];
        const bezirkInfo = this.wienBezirke[plz];
        if (bezirkInfo) {
          return { code: plz, name: bezirkInfo };
        }
      }
    } catch (e) {
      // Continue with other methods
    }

    // Methode 2: Spezifische Location-Elemente (höchste Priorität bei DOM-Suche)
    const locationSelectors = [
      '[data-testid="object-location-address"]',
      '[data-testid="ad-detail-ad-location"]',
      'div:contains("Objektstandort")',
      'h2:contains("Objektstandort")'
    ];

    for (const selector of locationSelectors) {
      const locationText = $(selector).first().text();
      if (locationText && locationText.length > 5) {
        // Suche nach PLZ im Location-Text
        for (const [code, name] of Object.entries(this.wienBezirke)) {
          if (locationText.includes(code)) {
            return { code, name };
          }
        }
        // Suche nach Bezirksnamen im Location-Text
        for (const [code, name] of Object.entries(this.wienBezirke)) {
          if (locationText.toLowerCase().includes(name.toLowerCase())) {
            return { code, name };
          }
        }
      }
    }

    // Methode 3: URL-Pattern (z.B. /wien-1020-leopoldstadt/)
    const urlMatch = html.match(/wien-(\d{4})-/i);
    if (urlMatch) {
      const plz = urlMatch[1];
      const bezirkInfo = this.wienBezirke[plz];
      if (bezirkInfo) {
        return { code: plz, name: bezirkInfo };
      }
    }

    // Methode 4: Body-Text (nur als Fallback, spezifische Patterns)
    const body = $('body').text();

    // Suche nach "PLZ Wien" Pattern (z.B. "1020 Wien")
    const plzWienMatch = body.match(/(\d{4})\s*Wien/i);
    if (plzWienMatch) {
      const plz = plzWienMatch[1];
      const bezirkInfo = this.wienBezirke[plz];
      if (bezirkInfo) {
        return { code: plz, name: bezirkInfo };
      }
    }

    // Fallback: Wien unbekannt
    return { code: '0000', name: 'Wien (unbekannt)' };
  }

  /**
   * Extrahiert Building Type (Neubau/Altbau) - NUR für Wohnungen
   */
  private extractBuildingType($: cheerio.CheerioAPI, html: string): 'neubau' | 'altbau' | null {
    const body = $('body').text().toLowerCase();

    // Check für explizite Keywords
    if (body.includes('neubau') || body.includes('erstbezug')) {
      return 'neubau';
    }

    // Baujahr-basierte Logik
    const baujahrMatch = body.match(/baujahr[:\s]*(\d{4})/i);
    if (baujahrMatch) {
      const year = parseInt(baujahrMatch[1]);
      if (year >= 2015) return 'neubau';
      if (year < 2015) return 'altbau';
    }

    // Check in Attributen
    let foundBaujahr: number | null = null;
    $('[data-testid^="attribute-"]').each((_, el) => {
      const text = $(el).text();
      if (text.toLowerCase().includes('baujahr')) {
        const match = text.match(/(\d{4})/);
        if (match) {
          foundBaujahr = parseInt(match[1]);
        }
      }
    });

    if (foundBaujahr) {
      if (foundBaujahr >= 2015) return 'neubau';
      if (foundBaujahr < 2015) return 'altbau';
    }

    return null;
  }

  /**
   * Extrahiert "Zuletzt geändert" Datum
   */
  private extractLastChanged($: cheerio.CheerioAPI, html: string): Date | null {
    try {
      // Methode 1: data-testid
      const editDateEl = $('[data-testid="ad-detail-ad-edit-date-top"]').text();
      if (editDateEl) {
        const match = editDateEl.match(/(\d{2})\.(\d{2})\.(\d{4}),\s*(\d{2}):(\d{2})/);
        if (match) {
          const [, day, month, year, hour, minute] = match;
          return new Date(parseInt(year), parseInt(month) - 1, parseInt(day), parseInt(hour), parseInt(minute));
        }
      }

      // Methode 2: Regex im HTML
      const regexMatch = html.match(/Zuletzt geändert:\s*<!--\s*-->(\d{2})\.(\d{2})\.(\d{4}),\s*(\d{2}):(\d{2})\s*Uhr/);
      if (regexMatch) {
        const [, day, month, year, hour, minute] = regexMatch;
        return new Date(parseInt(year), parseInt(month) - 1, parseInt(day), parseInt(hour), parseInt(minute));
      }

      return null;
    } catch (e) {
      return null;
    }
  }

  /**
   * Extrahiert Preis - 1:1 von V3 Scraper (bewährte einfache Logik)
   */
  private extractPrice($: cheerio.CheerioAPI, bodyText: string): number {
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

  /**
   * Extrahiert Fläche - verbesserte Extraktion
   */
  private extractArea($: cheerio.CheerioAPI, bodyText: string): string | '' {
    // Methode 1: Spezifische Selektoren für Wohnfläche/Nutzfläche
    const areaSelectors = [
      '[data-testid*="attribute-living-area"]',
      '[data-testid*="attribute-usable-area"]',
      'div:contains("Wohnfläche")',
      'div:contains("Nutzfläche")',
      'span:contains("Wohnfläche")',
      'span:contains("Nutzfläche")'
    ];

    for (const selector of areaSelectors) {
      const text = $(selector).text();
      const match = text.match(/(\d{1,4}(?:[,.]\d{1,2})?)\s*m²/i);
      if (match) {
        const area = parseFloat(match[1].replace(',', '.'));
        if (area >= 10 && area <= 1000) {
          return Math.round(area).toString();
        }
      }
    }

    // Methode 2: Regex im bodyText - nur valide Bereiche
    const m2 = bodyText.match(/(?:wohnfläche|nutzfläche|fläche)[\s:]*(\d{1,4}(?:[,.]\d{1,2})?)\s*m²/i);
    if (m2) {
      const area = parseFloat(m2[1].replace(',', '.'));
      if (area >= 10 && area <= 1000) {
        return Math.round(area).toString();
      }
    }

    // Methode 3: Generische m²-Suche als Fallback
    const m3 = bodyText.match(/(\d{1,3})\s*m²/i);
    if (m3) {
      const area = parseInt(m3[1]);
      if (area >= 10 && area <= 1000) {
        return area.toString();
      }
    }

    return '';
  }

  private getRandomUA(): string {
    return this.userAgents[Math.floor(Math.random() * this.userAgents.length)];
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Singleton instance
export const preisspiegelScraper = new PreisspiegelScraperService();
