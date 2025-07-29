import axios from 'axios';
import * as cheerio from 'cheerio';

interface ScrapingOptions {
  categories: string[];
  maxPages: number;
  delay: number;
  onProgress: (message: string) => void;
  onListingFound: (listingData: any) => Promise<void>;
}

export class ScraperUltraService {
  private readonly userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
  ];

  private getRandomUserAgent(): string {
    return this.userAgents[Math.floor(Math.random() * this.userAgents.length)];
  }

  async startScraping(options: ScrapingOptions): Promise<void> {
    for (const category of options.categories) {
      options.onProgress(`🚀 ULTRA-SCRAPER START: ${category} mit maximaler URL-Extraktion`);
      await this.scrapeCategory(category, options);
    }
  }

  private async scrapeCategory(category: string, options: ScrapingOptions): Promise<void> {
    const detailUrls: string[] = [];
    let totalFound = 0;

    // SCHRITT 1: ULTRA-AGGRESSIVE URL SAMMLUNG
    for (let pageNum = 1; pageNum <= options.maxPages; pageNum++) {
      const url = this.buildPageUrl(category, pageNum);
      options.onProgress(`⚡ ULTRA-LOAD Seite ${pageNum}: ${url}`);
      
      try {
        const response = await axios.get(url, {
          headers: {
            'User-Agent': this.getRandomUserAgent(),
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'de,en-US;q=0.7,en;q=0.3',
            'Referer': 'https://www.willhaben.at/'
          },
          timeout: 15000
        });

        const $ = cheerio.load(response.data);
        const pageUrls = this.extractAllPossibleUrls($);
        
        detailUrls.push(...pageUrls);
        options.onProgress(`⚡ ULTRA-FOUND Seite ${pageNum}: ${pageUrls.length} URLs extrahiert`);
        
        // Kurze Pause für Speed
        await new Promise(resolve => setTimeout(resolve, options.delay));
        
      } catch (error) {
        options.onProgress(`❌ ULTRA-ERROR Seite ${pageNum}: ${error}`);
      }
    }

    // Duplikate entfernen
    const uniqueUrls = Array.from(new Set(detailUrls));
    options.onProgress(`🎯 ULTRA-TOTAL: ${uniqueUrls.length} einzigartige URLs für DOPPELMARKLER/PRIVAT Check`);

    // SCHRITT 2: ULTRA-SCHNELLER 2-SCHRITT FILTER
    for (let i = 0; i < uniqueUrls.length; i++) {
      const detailUrl = uniqueUrls[i];
      options.onProgress(`🔍 ULTRA-CHECK (${i+1}/${uniqueUrls.length}): ${detailUrl}`);
      
      try {
        const listingData = await this.ultraFastCheck(detailUrl, category);
        if (listingData) {
          options.onProgress(`💎 ULTRA-SUCCESS: "${listingData.title}" - €${listingData.price.toLocaleString()} - Tel: ${listingData.phoneNumber || 'KEINE'}`);
          await options.onListingFound(listingData);
          totalFound++;
        }
        
        // Minimal delay für ultra speed
        await new Promise(resolve => setTimeout(resolve, Math.max(options.delay / 2, 300)));
        
      } catch (error) {
        options.onProgress(`❌ ULTRA-CHECK-ERROR: ${error}`);
      }
    }

    options.onProgress(`🏆 ULTRA-COMPLETE: ${category} - ${totalFound} private Treffer gefunden!`);
  }

  private extractAllPossibleUrls($: cheerio.CheerioAPI): string[] {
    const urls: string[] = [];
    
    // MAXIMUM AGGRESSIVE SELEKTOREN - ALLE LINKS FINDEN
    const selectors = [
      'a[href*="/iad/immobilien/d/"]',
      'a[href*="/immobilien/d/"]',
      'a[data-testid*="result"]',
      'a[data-testid*="listing"]', 
      'a[data-testid*="ad"]',
      '.result-list-entry a',
      '.search-result-entry a',
      '.SearchResultListItem a',
      '.iadResultsAdCard a',
      '.AdItem a',
      '.SearchResultItem a',
      '.result-item a',
      '.listing-item a',
      '[data-testid="result-item"] a',
      '[data-testid="ad-item"] a',
      '[data-testid="listing-card"] a'
    ];
    
    // Durchlaufe ALLE Selektoren aggressiv
    selectors.forEach(selector => {
      $(selector).each((_, element) => {
        const href = $(element).attr('href');
        if (href && (href.includes('/iad/immobilien/d/') || href.includes('/immobilien/d/'))) {
          const cleanUrl = href.split('?')[0];
          const fullUrl = href.startsWith('http') ? cleanUrl : `https://www.willhaben.at${cleanUrl}`;
          if (!urls.includes(fullUrl)) {
            urls.push(fullUrl);
          }
        }
      });
    });
    
    // MEGA-FALLBACK: Alle Links mit Immobilien-Keywords durchsuchen
    $('a').each((_, element) => {
      const href = $(element).attr('href');
      if (href && 
          (href.includes('immobilien') || href.includes('eigentumswohnung') || href.includes('grundstueck')) &&
          href.includes('/d/') &&
          href.length > 30) {
        const cleanUrl = href.split('?')[0];
        const fullUrl = href.startsWith('http') ? cleanUrl : `https://www.willhaben.at${cleanUrl}`;
        if (!urls.includes(fullUrl)) {
          urls.push(fullUrl);
        }
      }
    });

    return urls;
  }

  private async ultraFastCheck(url: string, category: string): Promise<any | null> {
    try {
      const response = await axios.get(url, {
        headers: {
          'User-Agent': this.getRandomUserAgent(),
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Referer': 'https://www.willhaben.at/'
        },
        timeout: 8000
      });

      const $ = cheerio.load(response.data);
      const bodyText = $('body').text().toLowerCase();
      const description = this.extractDescription($);
      const fullText = (description + ' ' + bodyText).toLowerCase();

      // ULTRA-EINFACHER 2-SCHRITT FILTER
      const foundDoppelmarkler = fullText.includes('doppelmarkler');
      
      if (foundDoppelmarkler) {
        console.log(`[ULTRA-FILTER] 🎯 DOPPELMARKLER DURCHBRUCH in ${url}`);
      } else {
        const foundPrivat = fullText.includes('privat');
        
        if (foundPrivat) {
          console.log(`[ULTRA-FILTER] ✅ PRIVAT GEFUNDEN in ${url}`);
        } else {
          console.log(`[ULTRA-FILTER] ❌ WEDER DOPPELMARKLER NOCH PRIVAT in ${url}`);
          return null;
        }
      }

      // Extrahiere alle Daten
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

    } catch (error) {
      return null;
    }
  }

  private buildPageUrl(category: string, page: number): string {
    const baseUrls: Record<string, string> = {
      'eigentumswohnung-wien': 'https://www.willhaben.at/iad/immobilien/eigentumswohnung/eigentumswohnung-angebote?sfId=f81bdc8f-08a7-4f66-8e9a-6bd19b0c23ae&isNavigation=true&areaId=900&areaId=903&rows=25',
      'eigentumswohnung-niederoesterreich': 'https://www.willhaben.at/iad/immobilien/eigentumswohnung/eigentumswohnung-angebote?sfId=f81bdc8f-08a7-4f66-8e9a-6bd19b0c23ae&isNavigation=true&areaId=904&rows=25',
      'grundstueck-wien': 'https://www.willhaben.at/iad/immobilien/grundstueck/grundstueck-angebote?sfId=f81bdc8f-08a7-4f66-8e9a-6bd19b0c23ae&isNavigation=true&areaId=900&areaId=903&rows=25',
      'grundstueck-niederoesterreich': 'https://www.willhaben.at/iad/immobilien/grundstueck/grundstueck-angebote?sfId=f81bdc8f-08a7-4f66-8e9a-6bd19b0c23ae&isNavigation=true&areaId=904&rows=25'
    };

    return `${baseUrls[category]}&page=${page}`;
  }

  private extractDescription($: cheerio.CheerioAPI): string {
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
    const bodyText = $('body').text();
    const pricePatterns = [
      /€\s*([\d.,]+)/g,
      /([\d.,]+)\s*€/g,
      /EUR\s*([\d.,]+)/g,
      /([\d.,]+)\s*EUR/g
    ];

    for (const pattern of pricePatterns) {
      const matches = bodyText.match(pattern);
      if (matches) {
        for (const match of matches) {
          const number = match.replace(/[€EUR\s]/g, '').replace(/\./g, '').replace(/,/g, '.');
          const price = parseFloat(number);
          if (price > 50000 && price < 10000000) {
            return Math.round(price);
          }
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

export const scraperUltraService = new ScraperUltraService();