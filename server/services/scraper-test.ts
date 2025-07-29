import axios from 'axios';
import * as cheerio from 'cheerio';

interface TestScrapingOptions {
  category: string;
  startPage?: number; // Neue Funktion: Start bei beliebiger Seite
  maxPages: number;
  delay: number;
  onProgress: (message: string) => void;
}

interface ListingData {
  title: string;
  price: number;
  area: number;
  location: string;
  url: string;
  images: string[];
  description: string;
  phoneNumber?: string;
  category: string;
  region: string;
  eur_per_m2: number;
}

export class ScraperTestService {
  private readonly userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
  ];

  private getRandomUserAgent(): string {
    return this.userAgents[Math.floor(Math.random() * this.userAgents.length)];
  }

  // ROBUSTER DOPPELMARKLER-SCAN mit besserer Fehlerbehandlung
  async testUltraFastDoppelmarklerScan(options: TestScrapingOptions): Promise<void> {
    const { category, maxPages, delay, onProgress } = options;
    
    onProgress(`🚀 ROBUSTER DOPPELMARKLER-SCAN: ${category}`);
    onProgress(`🎯 SUCHE: "Doppelmarkler" und "Dopplermarklertätigkeit"`);
    
    const detailUrls: string[] = [];
    let currentPage = 1;
    let pagesProcessed = 0;
    let consecutiveErrors = 0;

    // SCHRITT 1: SAMMLE URLs mit robuster Fehlerbehandlung
    while (pagesProcessed < maxPages && consecutiveErrors < 5) {
      const url = this.buildSearchUrl(category, currentPage);
      onProgress(`⚡ LOAD Seite ${currentPage}/${maxPages}`);
      
      try {
        const pageUrls = await this.extractListingUrlsWithRetry(url, onProgress);
        detailUrls.push(...pageUrls);
        onProgress(`✅ FOUND ${pageUrls.length} URLs (Total: ${detailUrls.length})`);
        
        consecutiveErrors = 0; // Reset error counter
        
        // Progressive delay basierend auf aktueller Performance
        const baseDelay = Math.max(delay, 2000);
        const progressiveDelay = baseDelay + (consecutiveErrors * 1000);
        await new Promise(resolve => setTimeout(resolve, progressiveDelay));
        
      } catch (error: any) {
        consecutiveErrors++;
        onProgress(`❌ ERROR Seite ${currentPage}: ${error.message || error}`);
        
        if (consecutiveErrors >= 3) {
          onProgress(`⚠️ Zu viele Fehler - beende Kategorie ${category}`);
          break;
        }
        
        // Exponential backoff für Fehler
        const backoffDelay = Math.min(5000 * Math.pow(2, consecutiveErrors), 30000);
        onProgress(`⏰ Warte ${backoffDelay/1000}s wegen Fehlern...`);
        await new Promise(resolve => setTimeout(resolve, backoffDelay));
      }
      
      currentPage++;
      pagesProcessed++;
    }

    // Remove duplicates
    const uniqueUrls = Array.from(new Set(detailUrls));
    onProgress(`🎯 DOPPELMARKLER-SCAN: ${uniqueUrls.length} URLs zu prüfen`);

    // SCHRITT 2: ULTRA-SCHNELLE DOPPELMARKLER SUCHE
    let doppelmarklerFound = 0;
    let totalProcessed = 0;

    for (const url of uniqueUrls) {
      totalProcessed++;
      onProgress(`🔍 DOPPELMARKLER-CHECK (${totalProcessed}/${uniqueUrls.length}): ${url}`);
      
      try {
        const result = await this.checkForDoppelmarkler(url, category);
        if (result) {
          doppelmarklerFound++;
          onProgress(`💎 DOPPELMARKLER GEFUNDEN: ${result.title} - €${result.price} - Tel: ${result.phoneNumber || 'KEINE'}`);
        }
        
        // ROBUSTER DELAY für Detail-Checks
        await new Promise(resolve => setTimeout(resolve, Math.max(delay, 1000)));
        
      } catch (error) {
        onProgress(`❌ DOPPELMARKLER-ERROR: ${error}`);
      }
    }

    onProgress(`🏆 DOPPELMARKLER-SCAN COMPLETE: ${doppelmarklerFound} Treffer gefunden!`);
  }

  private async checkForDoppelmarkler(url: string, category: string): Promise<ListingData | null> {
    try {
      const response = await axios.get(url, {
        headers: {
          'User-Agent': this.getRandomUserAgent(),
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'de,en-US;q=0.7,en;q=0.3',
          'Referer': 'https://www.willhaben.at/',
          'Cache-Control': 'no-cache'
        },
        timeout: 15000,
        maxRedirects: 3
      });

      const $ = cheerio.load(response.data);
      const bodyText = $('body').text().toLowerCase();
      const description = this.extractDetailDescription($);

      // 🎯 DOPPELMARKLER SUCHE - DAS IST DER DURCHBRUCH!
      const doppelmarklerKeywords = [
        'doppelmarkler',
        'dopplermarklertätigkeit',
        'doppelmaklertätigkeit'
      ];

      const foundDoppelmarkler = doppelmarklerKeywords.find(keyword => 
        bodyText.includes(keyword.toLowerCase()) || 
        description.toLowerCase().includes(keyword.toLowerCase())
      );

      if (foundDoppelmarkler) {
        console.log(`🎯 DOPPELMARKLER HIT: "${foundDoppelmarkler}" in ${url}`);
        
        // Extract all data
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
          description,
          phoneNumber,
          category: listingCategory,
          region,
          eur_per_m2
        };
      }

      return null;

    } catch (error) {
      console.error(`DOPPELMARKLER-CHECK ERROR for ${url}:`, error);
      return null;
    }
  }

  private buildSearchUrl(category: string, page: number): string {
    const baseUrls: Record<string, string> = {
      'eigentumswohnung-wien': 'https://www.willhaben.at/iad/immobilien/eigentumswohnung/eigentumswohnung-angebote?sfId=f81bdc8f-08a7-4f66-8e9a-6bd19b0c23ae&isNavigation=true&areaId=900&areaId=903&rows=25',
      'eigentumswohnung-niederoesterreich': 'https://www.willhaben.at/iad/immobilien/eigentumswohnung/eigentumswohnung-angebote?sfId=f81bdc8f-08a7-4f66-8e9a-6bd19b0c23ae&isNavigation=true&areaId=904&rows=25',
      'grundstueck-wien': 'https://www.willhaben.at/iad/immobilien/grundstueck/grundstueck-angebote?sfId=f81bdc8f-08a7-4f66-8e9a-6bd19b0c23ae&isNavigation=true&areaId=900&areaId=903&rows=25',
      'grundstueck-niederoesterreich': 'https://www.willhaben.at/iad/immobilien/grundstueck/grundstueck-angebote?sfId=f81bdc8f-08a7-4f66-8e9a-6bd19b0c23ae&isNavigation=true&areaId=904&rows=25',
      'grundstuecke-wien': 'https://www.willhaben.at/iad/immobilien/grundstueck/grundstueck-angebote?sfId=f81bdc8f-08a7-4f66-8e9a-6bd19b0c23ae&isNavigation=true&areaId=900&areaId=903&rows=25',
      'grundstuecke-niederoesterreich': 'https://www.willhaben.at/iad/immobilien/grundstueck/grundstueck-angebote?sfId=f81bdc8f-08a7-4f66-8e9a-6bd19b0c23ae&isNavigation=true&areaId=904&rows=25'
    };

    const baseUrl = baseUrls[category];
    if (!baseUrl) {
      throw new Error(`Invalid category: ${category}`);
    }
    
    return `${baseUrl}&page=${page}`;
  }

  private async extractListingUrlsWithRetry(url: string, onProgress: (msg: string) => void): Promise<string[]> {
    let retries = 0;
    const maxRetries = 3;
    
    while (retries < maxRetries) {
      try {
        return await this.extractListingUrls(url);
      } catch (error: any) {
        retries++;
        if (error.response?.status === 429) {
          const waitTime = 10000 * retries; // 10s, 20s, 30s
          onProgress(`🚫 Rate limit - Retry ${retries}/${maxRetries} in ${waitTime/1000}s`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
        } else if (retries >= maxRetries) {
          throw error;
        } else {
          onProgress(`⚠️ Retry ${retries}/${maxRetries} wegen: ${error.message}`);
          await new Promise(resolve => setTimeout(resolve, 2000 * retries));
        }
      }
    }
    
    return [];
  }

  private async extractListingUrls(url: string): Promise<string[]> {
    try {
      const response = await axios.get(url, {
        headers: {
          'User-Agent': this.getRandomUserAgent(),
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'de,en-US;q=0.7,en;q=0.3',
          'Referer': 'https://www.willhaben.at/',
          'Cache-Control': 'no-cache'
        },
        timeout: 15000,
        maxRedirects: 5
      });

    const $ = cheerio.load(response.data);
    const urls: string[] = [];

    // Extract listing URLs
    $('a[href*="/iad/immobilien/d/"]').each((_, element) => {
      const href = $(element).attr('href');
      if (href && href.includes('/iad/immobilien/d/')) {
        const fullUrl = href.startsWith('http') ? href : `https://www.willhaben.at${href}`;
        urls.push(fullUrl);
      }
    });

      return urls;
    } catch (error: any) {
      if (error.response?.status === 429) {
        console.log('Rate limit hit, waiting longer...');
        await new Promise(resolve => setTimeout(resolve, 10000));
        throw new Error('Rate limit - retrying later');
      }
      throw error;
    }
  }

  private extractDetailDescription($: cheerio.CheerioAPI): string {
    const selectors = [
      '[data-testid="ad-detail-ad-description"] p',
      '.AdDescription-description',
      '[data-testid="object-description-text"]',
      '.description-text',
      '.ad-description'
    ];

    for (const selector of selectors) {
      const element = $(selector);
      if (element.length > 0) {
        return element.text().trim();
      }
    }

    return '';
  }

  private extractTitle($: cheerio.CheerioAPI): string {
    const selectors = [
      '[data-testid="ad-detail-ad-title"] h1',
      '.AdDetailTitle',
      'h1.AdTitle',
      'h1'
    ];

    for (const selector of selectors) {
      const element = $(selector);
      if (element.length > 0) {
        return element.text().trim();
      }
    }

    return 'Unbekannter Titel';
  }

  private extractPrice($: cheerio.CheerioAPI): number {
    const selectors = [
      '[data-testid="ad-detail-ad-price"] span',
      '.AdDetailPrice',
      '.price-value',
      '.AdPrice'
    ];

    for (const selector of selectors) {
      const element = $(selector);
      if (element.length > 0) {
        const priceText = element.text().replace(/[^\d]/g, '');
        const price = parseInt(priceText);
        if (!isNaN(price) && price > 0) {
          return price;
        }
      }
    }

    return 0;
  }

  private extractArea($: cheerio.CheerioAPI): number {
    const bodyText = $('body').text();
    const areaMatch = bodyText.match(/(\d+(?:[.,]\d+)?)\s*m[²2]/i);
    if (areaMatch) {
      return parseFloat(areaMatch[1].replace(',', '.'));
    }
    return 0;
  }

  private extractLocation($: cheerio.CheerioAPI): string {
    const selectors = [
      '[data-testid="ad-detail-ad-address"]',
      '.AdDetailLocation',
      '.location-text'
    ];

    for (const selector of selectors) {
      const element = $(selector);
      if (element.length > 0) {
        return element.text().trim();
      }
    }

    return 'Unbekannte Lage';
  }

  private extractPhoneNumber(text: string): string | undefined {
    const phonePatterns = [
      /(?:\+43|0043)[\s\-]?(?:\(\d+\)|\d+)[\s\-]?\d+(?:[\s\-]?\d+)*/g,
      /0\d{1,4}[\s\/\-]?\d+(?:[\s\-]?\d+)*/g,
      /(?:\+43|0043)[\s\-]?\d+(?:[\s\-]?\d+)*/g
    ];

    for (const pattern of phonePatterns) {
      const matches = text.match(pattern);
      if (matches) {
        const phone = matches[0].replace(/[\s\-\(\)]/g, '');
        if (phone.length >= 8 && phone.length <= 15) {
          return phone;
        }
      }
    }

    return undefined;
  }
}