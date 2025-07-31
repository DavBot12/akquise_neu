import axios, { AxiosInstance } from 'axios';
import * as cheerio from 'cheerio';

interface ContinuousScrapingOptions {
  onProgress: (message: string) => void;
  onListingFound: (listing: any) => void;
}

export class ContinuousScraper247Service {
  private axiosInstance: AxiosInstance;
  private sessionCookies: string = '';
  private isRunning = false;
  private currentCycle = 0;
  
  private userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0'
  ];

  // Alle verfügbaren Kategorien und Regionen
  private categories = [
    'eigentumswohnung-wien',
    'eigentumswohnung-niederoesterreich', 
    'grundstueck-wien',
    'grundstueck-niederoesterreich'
  ];

  private baseUrls: Record<string, string> = {
    'eigentumswohnung-wien': 'https://www.willhaben.at/iad/immobilien/eigentumswohnung/eigentumswohnung-angebote?areaId=900&areaId=903&rows=25&SELLER_TYPE=PRIVATE',
    'eigentumswohnung-niederoesterreich': 'https://www.willhaben.at/iad/immobilien/eigentumswohnung/eigentumswohnung-angebote?areaId=904&rows=25&SELLER_TYPE=PRIVATE',
    'grundstueck-wien': 'https://www.willhaben.at/iad/immobilien/grundstueck/grundstueck-angebote?areaId=900&areaId=903&rows=25&SELLER_TYPE=PRIVATE',
    'grundstueck-niederoesterreich': 'https://www.willhaben.at/iad/immobilien/grundstueck/grundstueck-angebote?areaId=904&rows=25&SELLER_TYPE=PRIVATE'
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
        
        // Zufällige Kategorie-Reihenfolge für natürliches Verhalten
        const shuffledCategories = [...this.categories].sort(() => Math.random() - 0.5);
        
        for (const category of shuffledCategories) {
          if (!this.isRunning) break;
          
          await this.scanSingleCategory(category, options);
          
          // Pause zwischen Kategorien (5-15 Minuten)
          const categoryDelay = 300000 + Math.random() * 600000; // 5-15 Min
          options.onProgress(`⏰ 24/7 Pause: ${Math.round(categoryDelay/60000)}min bis nächste Kategorie`);
          await this.sleep(categoryDelay);
        }
        
        // Lange Pause zwischen Zyklen (30-60 Minuten)
        const cycleDelay = 1800000 + Math.random() * 1800000; // 30-60 Min
        options.onProgress(`💤 24/7 CYCLE COMPLETE - Pause ${Math.round(cycleDelay/60000)}min bis nächster Zyklus`);
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
    options.onProgress(`🔍 24/7 SCAN: ${category}`);
    
    try {
      // Nur erste Seite scannen für kontinuierlichen Betrieb
      const urls = await this.getPageUrls(category, 1);
      options.onProgress(`📄 24/7: ${urls.length} URLs in ${category}`);
      
      // Verarbeite URLs mit sanften Delays
      for (const url of urls) {
        if (!this.isRunning) break;
        
        const listing = await this.processListing(url, category, options.onProgress);
        if (listing) {
          options.onListingFound(listing);
          options.onProgress(`💎 24/7 FUND: ${listing.title} - €${listing.price}`);
        }
        
        // Sanftes Delay zwischen Detail-Checks
        await this.sleep(8000 + Math.random() * 7000); // 8-15s
      }
      
    } catch (error) {
      options.onProgress(`❌ 24/7 Category Error ${category}: ${error}`);
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
        'Referer': 'https://www.willhaben.at/'
      }
    });

    const $ = cheerio.load(response.data);
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

      const $ = cheerio.load(response.data);
      const bodyText = $('body').text().toLowerCase();
      
      // Private Verkäufer Keywords
      const privateKeywords = [
        'privatverkauf',
        'privat verkauf',
        'von privat',
        'privater verkäufer',
        'doppelmarkler'
      ];

      const foundPrivate = privateKeywords.find(keyword => 
        bodyText.includes(keyword.toLowerCase())
      );

      if (foundPrivate) {
        const title = this.extractTitle($);
        const price = this.extractPrice($);
        const area = this.extractArea($);
        const location = this.extractLocation($);
        const phoneNumber = this.extractPhoneNumber(bodyText);
        
        const region = category.includes('wien') ? 'wien' : 'niederoesterreich';
        const listingCategory = category.includes('eigentumswohnung') ? 'eigentumswohnung' : 'grundstueck';
        const eur_per_m2 = area > 0 ? Math.round(price / area) : 0;

        return {
          title,
          price,
          area,
          location,
          url,
          images: [],
          description: this.extractDescription($),
          phoneNumber,
          category: listingCategory,
          region,
          eur_per_m2
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

  private extractPrice($: cheerio.CheerioAPI): number {
    const selectors = ['[data-testid="ad-detail-ad-price"] span', '.AdDetailPrice', '.price-value'];
    for (const selector of selectors) {
      const element = $(selector);
      if (element.length > 0) {
        const priceText = element.text().replace(/[^\d]/g, '');
        const price = parseInt(priceText);
        if (price > 0) return price;
      }
    }
    return 0;
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

  private extractDescription($: cheerio.CheerioAPI): string {
    const selectors = ['[data-testid="ad-detail-ad-description"] p', '.AdDescription-description'];
    for (const selector of selectors) {
      const element = $(selector);
      if (element.length > 0) return element.text().trim();
    }
    return '';
  }

  private extractPhoneNumber(text: string): string | null {
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
}