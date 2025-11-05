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

  private categories = [
    'eigentumswohnung-wien'
  ];

  private baseUrls: Record<string, string> = {
    'eigentumswohnung-wien': 'https://www.willhaben.at/iad/immobilien/eigentumswohnung/eigentumswohnung-angebote?areaId=900&areaId=903&rows=25&SELLER_TYPE=PRIVAT&isNavigation=true&keyword=privatverkauf',
    'eigentumswohnung-niederoesterreich': 'https://www.willhaben.at/iad/immobilien/eigentumswohnung/eigentumswohnung-angebote?areaId=904&rows=25&SELLER_TYPE=PRIVAT&isNavigation=true&keyword=privatverkauf',
    'grundstueck-wien': 'https://www.willhaben.at/iad/immobilien/grundstuecke/grundstueck-angebote?areaId=900&areaId=903&rows=25&SELLER_TYPE=PRIVAT&isNavigation=true&keyword=privatverkauf',
    'grundstueck-niederoesterreich': 'https://www.willhaben.at/iad/immobilien/grundstuecke/grundstueck-angebote?areaId=904&rows=25&SELLER_TYPE=PRIVAT&isNavigation=true&keyword=privatverkauf'
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
      options.onProgress('⚠️ 24/7 Scraper läuft bereits!');
      return;
    }

    this.isRunning = true;
    options.onProgress('🚀 24/7 SCRAPER GESTARTET - Kontinuierlicher Modus aktiviert!');
    
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
        options.onProgress(`🔄 24/7 CYCLE ${this.currentCycle} - Scanne alle Kategorien...`);
        
        // Session etablieren
        await this.establishSession(options.onProgress);
        // Load state once per cycle from DB
        await this.loadStateSafe();
        
        // Zufällige Kategorie-Reihenfolge für natürliches Verhalten
        const shuffledCategories = [...this.categories].sort(() => Math.random() - 0.5);
        
        for (const category of shuffledCategories) {
          if (!this.isRunning) break;
          
          await this.scanSingleCategory(category, options);
          
          // Pause zwischen Kategorien (env/NODE_ENV gesteuert)
          const dev = (process.env.NODE_ENV || '').toLowerCase() === 'development';
          const envDelay = Number(process.env.SCRAPER_247_CATEGORY_DELAY_MS || '0');
          const categoryDelay = envDelay > 0
            ? envDelay
            : dev
              ? 10000 + Math.random() * 10000 // 10-20s in Entwicklung
              : 300000 + Math.random() * 600000; // 5-15 Min in Prod
          const categoryDelayHuman = dev ? `${Math.round(categoryDelay/1000)}s` : `${Math.round(categoryDelay/60000)}min`;
          options.onProgress(`⏰ 24/7 Pause: ${categoryDelayHuman} bis nächste Kategorie`);
          await this.sleep(categoryDelay);
        }
        
        // Lange Pause zwischen Zyklen (env/NODE_ENV gesteuert)
        const dev = (process.env.NODE_ENV || '').toLowerCase() === 'development';
        const envCycle = Number(process.env.SCRAPER_247_CYCLE_DELAY_MS || '0');
        const cycleDelay = envCycle > 0
          ? envCycle
          : dev
            ? 30000 + Math.random() * 30000 // 30-60s in Entwicklung
            : 1800000 + Math.random() * 1800000; // 30-60 Min in Prod
        const cycleDelayHuman = dev ? `${Math.round(cycleDelay/1000)}s` : `${Math.round(cycleDelay/60000)}min`;
        options.onProgress(`💤 24/7 CYCLE COMPLETE - Pause ${cycleDelayHuman} bis nächster Zyklus`);
        await this.sleep(cycleDelay);
        
      } catch (error) {
        options.onProgress(`❌ 24/7 ERROR Cycle ${this.currentCycle}: ${error}`);
        
        // Bei Fehler längere Pause
        await this.sleep(600000); // 10 Minuten
      }
    }
    
    options.onProgress('🛑 24/7 SCRAPER GESTOPPT');
  }

  private async scanSingleCategory(category: string, options: ContinuousScrapingOptions): Promise<void> {
    const maxPages = Math.max(1, Number(process.env.SCRAPER_247_MAX_PAGES || '20'));
    const current = this.pageState[category] ?? 1;
    options.onProgress(`🔍 24/7 SCAN: ${category} (page=${current}/${maxPages})`);

    try {
      const urls = await this.getPageUrls(category, current);
      options.onProgress(`📄 24/7: ${urls.length} URLs in ${category} (page=${current})`);

      for (const url of urls) {
        if (!this.isRunning) break;
        const listing = await this.processListing(url, category, options.onProgress);
        if (listing) {
          options.onListingFound(listing);
          options.onProgress(`💎 24/7 FUND: ${listing.title} - €${listing.price}`);
        }
        await this.sleep(8000 + Math.random() * 7000); // 8-15s
      }

      // advance page (linear)
      this.pageState[category] = current + 1;
      await this.saveStateSafe();

    } catch (error: any) {
      options.onProgress(`❌ 24/7 Category Error ${category}: ${error}`);
      // on error, try next page next time to avoid getting stuck
      this.pageState[category] = current + 1;
      await this.saveStateSafe();
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
      
      const commercial = [
        'neubauprojekt','erstbezug','bauträger','anleger','wohnprojekt','immobilienmakler','provisionsaufschlag','fertigstellung','projektentwicklung','immobilienvertrieb','immobilienbüro'
      ];
      if (commercial.some(k => bodyText.includes(k))) return null;

      const privateKeywords = [
        'privatverkauf','privat verkauf','von privat','privater verkäufer','privater anbieter','ohne makler','verkaufe privat','privat zu verkaufen','eigenheim verkauf','private anzeige'
      ];

      const foundPrivate = privateKeywords.find(keyword => 
        bodyText.includes(keyword.toLowerCase())
      );

      if (foundPrivate) {
        const title = this.extractTitle($);
        const price = this.extractPrice($, bodyText);
        const area = this.extractArea($);
        const locJson = this.extractLocationFromJson(html);
        const location = locJson || this.extractLocation($);
        const phoneNumber = this.extractPhoneNumber(bodyText);
        
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
          images: [],
          description: this.extractDescription($),
          phone_number: phoneNumber || null,
          category: listingCategory,
          region,
          eur_per_m2: eurPerM2 ? String(eurPerM2) : null
        };
      }

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

  private extractArea($: cheerio.CheerioAPI): number {
    const selectors = ['[data-testid="ad-detail-ad-properties"]', '.AdDetailProperties'];
    for (const selector of selectors) {
      const element = $(selector);
      const text = element.text();
      const areaMatch = text.match(/(\d+)[\s]*m²/i);
      if (areaMatch) return parseInt(areaMatch[1]);
    }
    return 0;
  }

  private extractLocation($: cheerio.CheerioAPI): string {
    const selectors = ['[data-testid="ad-detail-ad-location"]', '.AdDetailLocation'];
    for (const selector of selectors) {
      const element = $(selector);
      if (element.length > 0) return element.text().trim();
    }
    return 'Unknown Location';
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

  private extractDescription($: cheerio.CheerioAPI): string {
    const selectors = ['[data-testid="ad-detail-ad-description"] p', '.AdDescription-description'];
    for (const selector of selectors) {
      const element = $(selector);
      if (element.length > 0) return element.text().trim();
    }
    return '';
  }

  private extractPhoneNumber(text: string): string | null {
    const norm = (s: string) => s.replace(/[^+\d]/g, '');
    const tnorm = norm(text);
    const blockList = ['0606891308', '0667891221', '43667891221', '+43667891221'];
    for (const b of blockList) {
      const bn = norm(b);
      const variants = [bn, bn.replace(/^\+43/, '0').replace(/^43/, '0'), bn.replace(/^\+/, '')];
      for (let i = 0; i < variants.length; i++) { if (tnorm.includes(variants[i])) return null; }
    }
    const phonePatterns = [
      /(\+43|0043)[\s\-]?[1-9]\d{1,4}[\s\-]?\d{3,8}/g,
      /0[1-9]\d{1,4}[\s\-]?\d{3,8}/g
    ];

    for (const pattern of phonePatterns) {
      const matches = text.match(pattern);
      if (matches && matches.length > 0) {
        return matches[0].replace(/[\s\-]/g, '');
      }
    }
    return null;
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