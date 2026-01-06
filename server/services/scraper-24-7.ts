import axios, { AxiosInstance } from 'axios';
import * as cheerio from 'cheerio';
import { storage } from '../storage';

interface ContinuousScrapingOptions {
  onProgress: (message: string) => void;
  onListingFound: (listing: any) => void;
}

export class ContinuousScraper247Service {
  private axiosInstance: AxiosInstance;
  private sessionCookies: string = '';
  private isRunning = false;
  private currentCycle = 0;
  private pageState: Record<string, number> = {};

  private userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0'
  ];

  // ALL CATEGORIES - Scrape everything!
  private categories = [
    'eigentumswohnung-wien',
    'eigentumswohnung-niederoesterreich',
    'grundstueck-wien',
    'grundstueck-niederoesterreich'
  ];

  // Allgemeine URLs OHNE Vorfilter - wir filtern selbst nach Keywords!
  private baseUrls: Record<string, string> = {
    'eigentumswohnung-wien': 'https://www.willhaben.at/iad/immobilien/eigentumswohnung/eigentumswohnung-angebote?areaId=900&areaId=903&rows=25',
    'eigentumswohnung-niederoesterreich': 'https://www.willhaben.at/iad/immobilien/eigentumswohnung/niederoesterreich?rows=25',
    'grundstueck-wien': 'https://www.willhaben.at/iad/immobilien/grundstuecke/grundstueck-angebote?areaId=900&areaId=903&rows=25',
    'grundstueck-niederoesterreich': 'https://www.willhaben.at/iad/immobilien/grundstuecke/niederoesterreich?rows=25'
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

  stop247Scraping(): void {
    this.isRunning = false;
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
        await this.sleep(cycleDelay);
        
      } catch (error) {
        options.onProgress(`[24/7] ERROR Cycle ${this.currentCycle}: ${error}`);

        // Bei Fehler Pause
        await this.sleep(120000); // 2 Minuten
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
          const urls = await this.getPageUrls(category, current);

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
          options.onProgress(`[24/7] ${category} Seite ${current}: ${urls.length} URLs`);

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
            await this.sleep(1000 + Math.random() * 1000); // 1-2s - SCHNELL!
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
            await this.sleep(backoff);
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

  private async getPageUrls(category: string, page: number): Promise<string[]> {
    const baseUrl = this.baseUrls[category];
    if (!baseUrl) return [];
    
    const url = `${baseUrl}&page=${page}`;
    
    const response = await this.axiosInstance.get(url, {
      headers: {
        'User-Agent': this.getRandomUserAgent(),
        'Cookie': this.sessionCookies,
        'Referer': 'https://www.willhaben.at/',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8'
      },
      validateStatus: (s) => s >= 200 && s < 500
    });

    if (response.status >= 400) {
      return [];
    }

    const html = response.data as string;
    const $ = cheerio.load(html);
    const urls: string[] = [];

    // URL-Extraktion mit mehreren Selektoren
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

    // Regex fallback like V3 for robustness
    const direct = html.match(/"(\/iad\/immobilien\/d\/[^"\s>]+)"/g) || [];
    for (const m of direct) {
      const p = m.replace(/\"/g, '"').replace(/\"/g,'');
      const path = m.replace(/\"/g,'').replace(/"/g,'');
      const full = `https://www.willhaben.at${path}`;
      urls.push(full);
    }

    return Array.from(new Set(urls));
  }

  private async processListing(url: string, category: string, onProgress: (msg: string) => void): Promise<any | null> {
    try {
      const response = await this.axiosInstance.get(url, {
        headers: {
          'User-Agent': this.getRandomUserAgent(),
          'Cookie': this.sessionCookies,
          'Referer': 'https://www.willhaben.at/iad/immobilien/'
        }
      });

      const html = response.data as string;
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

      // Extrahiere Private Listings
      const title = this.extractTitle($);
      const price = this.extractPrice($, bodyText);
      const area = this.extractArea($, bodyText);
      const locJson = this.extractLocationFromJson(html);
      const location = locJson || this.extractLocation($, url);
      const phoneNumber = this.extractPhoneNumber(html, $);
      const images = this.extractImages($, html);

      const region = category.includes('wien') ? 'wien' : 'niederoesterreich';
      const listingCategory = category.includes('eigentumswohnung') ? 'eigentumswohnung' : 'grundstueck';
      if (price <= 0) return null;
      const eurPerM2 = area > 0 ? Math.round(price / area) : 0;

      return {
        title,
        price,
        area,
        location,
        url,
        images,
        description: this.extractDescription($),
        phone_number: phoneNumber || null,
        category: listingCategory,
        region,
        eur_per_m2: eurPerM2 ? String(eurPerM2) : null
      };

      return null;

    } catch (error) {
      return null;
    }
  }

  private async establishSession(onProgress: (msg: string) => void): Promise<void> {
    try {
      const response = await this.axiosInstance.get('https://www.willhaben.at');
      const cookies = response.headers['set-cookie'];
      if (cookies) {
        this.sessionCookies = cookies.map(cookie => cookie.split(';')[0]).join('; ');
      }
      await this.sleep(2000);
    } catch (error) {
      // Ignoriere Session-Fehler im 24/7 Modus
    }
  }

  private getRandomUserAgent(): string {
    return this.userAgents[Math.floor(Math.random() * this.userAgents.length)];
  }

  private async sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Extraction methods
  private extractTitle($: cheerio.CheerioAPI): string {
    const selectors = ['[data-testid="ad-detail-ad-title"] h1', '.AdDetailTitle', 'h1'];
    for (const selector of selectors) {
      const element = $(selector);
      if (element.length > 0) return element.text().trim();
    }
    return 'Unknown Title';
  }

  private extractPrice($: cheerio.CheerioAPI, bodyText: string): number {
    const cand = $('span:contains("€"), div:contains("Kaufpreis"), [data-testid*="price"]').text();
    const m1 = cand.match(/€\s*(\d{1,3})\.(\d{3})/);
    if (m1) { const v = parseInt(m1[1] + m1[2]); if (v >= 50000 && v <= 9999999) return v; }
    const m2 = bodyText.match(/€\s*(\d{1,3})\.(\d{3})/);
    if (m2) { const v = parseInt(m2[1] + m2[2]); if (v >= 50000 && v <= 9999999) return v; }
    const digits = (bodyText.match(/(\d{3}\.\d{3})/g) || []).map(x => parseInt(x.replace('.', ''))).find(v => v >= 50000 && v <= 9999999);
    return digits || 0;
  }

  private extractArea($: cheerio.CheerioAPI, bodyText: string): number {
    // V3 Method: Better extraction with multiple fallbacks
    const m1 = $('span:contains("m²"), div:contains("Wohnfläche"), div:contains("Grundstücksfläche")').text().match(/(\d{1,4})\s*m²/i);
    if (m1) return parseInt(m1[1]);
    const m2 = bodyText.match(/(\d{1,3})\s*m²/i);
    return m2 ? parseInt(m2[1]) : 0;
  }

  // V3 Location Extraction with Multiple Fallbacks
  private extractLocation($: cheerio.CheerioAPI, url: string): string {
    // Primary selector
    const el = $('[data-testid="ad-detail-ad-location"]').text().trim();
    if (el && el.length > 5) return el;

    // Willhaben header/label fallback like "Objektstandort"
    const header = $('h2:contains("Objektstandort"), div:contains("Objektstandort")').first();
    if (header.length) {
      const next = header.next();
      const txt = (next.text() || header.parent().text() || '').trim();
      if (txt && txt.length > 5) return txt.replace(/\s+/g, ' ');
    }

    // URL-based fallback for Vienna district slugs
    const m = url.match(/wien-(\d{4})-([^\/]+)/i);
    if (m) return `${m[1]} Wien, ${m[2].replace(/-/g, ' ')}`;

    // Body text heuristic for addresses/streets
    const body = $('body').text();
    const street = body.match(/\b([A-ZÄÖÜ][a-zäöüß]+(?:gasse|straße|strasse|platz|allee|ring))\b[^\n,]*/);
    if (street) return street[0].trim().substring(0, 100);

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

  // V3 Description Extraction with Fallback
  private extractDescription($: cheerio.CheerioAPI): string {
    const t = $('[data-testid="ad-detail-ad-description"], [data-testid="object-description-text"]').text().trim();
    if (t && t.length > 30 && !t.includes('{"props"')) return t.substring(0, 1000);
    const all = $('body').text();
    // FIX: Don't skip first characters! Look for text after "Objektbeschreibung:" or newline
    const m = all.match(/Objektbeschreibung[\s:]*\n?\s*([\s\S]{30,1200})/i);
    const desc = m?.[1]?.trim() || '';
    if (desc.includes('{"props"')) return '';
    return desc;
  }

  // V3 Images Extraction
  private extractImages($: cheerio.CheerioAPI, html: string): string[] {
    const images: string[] = [];
    $('img[src*="cache.willhaben.at"]').each((_, el) => {
      const src = $(el).attr('src');
      if (src && !src.includes('_thumb')) images.push(src);
    });
    // Regex fallback
    (html.match(/https:\/\/cache\.willhaben\.at\/mmo\/[^"'\s]+\.jpg/gi) || []).forEach(u => {
      if (!u.includes('_thumb')) images.push(u);
    });
    return Array.from(new Set(images)).slice(0, 10);
  }

  // V3 Multi-Layer Phone Extraction (BEST METHOD!)
  private extractPhoneNumber(html: string, $: cheerio.CheerioAPI): string | null {
    // 0) Direct tel: links and known testids
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
    const isBlocked = (n: string) => {
      const d = n.replace(/[^+\d]/g, '');
      const alt = d.replace(/^\+43/, '0').replace(/^43/, '0');
      const bare = d.replace(/^\+/, '');
      return blocked.has(d) || blocked.has(alt) || blocked.has(bare);
    };

    const directNums: string[] = [];
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
    if (normalizedDirect.length > 0) {
      const best = normalizedDirect.map(n => ({ n: n.startsWith('43') ? `+${n}` : n, s: score(n) })).sort((a,b)=>b.s-a.s)[0];
      if (best?.n) return best.n;
    }

    // 1) DOM-near extraction: look for elements containing 'Telefon' and read adjacent text
    let domNumber: string | null = null;
    $('*:contains("Telefon")').each((_, el) => {
      const text = $(el).text().trim();
      if (!/^Telefon/i.test(text)) return;
      // try same element
      const matchSame = text.match(/Telefon\s*([+\d\s\-()\/]{8,20})/i);
      if (matchSame && matchSame[1]) {
        domNumber = matchSame[1];
        return false as any;
      }
      // try next siblings
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

    // 2) Fallback regex across HTML (strip script/style to avoid __NEXT_DATA__ JSON phones)
    const htmlNoScripts = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ');
    // Austrian mobile only: 0650-0699 (accept +43/0043/43/0 prefixes)
    const candidateRegex = /(?:(?:\+43|0043|43|0)\s*)6[5-9]\s*[\d\s\-/()]{7,12}/g;
    const candidates = (htmlNoScripts.match(candidateRegex) || []).map(normalize).filter(n => n.length >= 8 && !isBlocked(n));
    if (candidates.length === 0) return null;
    const best = candidates.map(n => ({ n: n.startsWith('43') ? `+${n}` : n, s: score(n) })).sort((a,b)=>b.s-a.s)[0];
    return best?.n || null;
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