import axios from 'axios';
import * as cheerio from 'cheerio';
import { storage } from '../storage';

interface ScrapingOptions {
  categories: string[];
  maxPages: number;
  delay: number;
  onProgress: (message: string) => void;
  onListingFound: (listing: any) => Promise<void>;
}

interface ListingData {
  title: string;
  price: number;
  area: number;
  location: string;
  url: string;
  images: string[];
  description: string;
  phoneNumber: string | null;
  category: string;
  region: string;
  eur_per_m2: number;
}

export class ScraperHttpService {
  private isRunning = false;
  private userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  ];

  private getRandomUserAgent(): string {
    return this.userAgents[Math.floor(Math.random() * this.userAgents.length)];
  }

  async startScraping(options: ScrapingOptions): Promise<void> {
    if (this.isRunning) {
      throw new Error('Scraper is already running');
    }

    this.isRunning = true;
    options.onProgress('[INFO] HTTP-basierter Scraper gestartet...');

    try {
      // Für jede Kategorie scrapen
      for (const category of options.categories) {
        await this.scrapeCategory(category, options);
      }

      options.onProgress('[FINAL] HTTP Scraper komplett abgeschlossen');
    } finally {
      this.cleanup();
    }
  }

  private async scrapeCategory(category: string, options: ScrapingOptions): Promise<void> {
    options.onProgress(`[START] Kategorie ${category} wird gescrapt...`);

    let totalFound = 0;
    let detailUrls: string[] = [];
    
    // Schritt 1: Alle Detail-URLs sammeln
    for (let pageNum = 1; pageNum <= options.maxPages; pageNum++) {
      const url = this.buildUrl(category, pageNum);
      options.onProgress(`[LOAD] Seite ${pageNum}: ${url}`);

      try {
        const response = await axios.get(url, {
          headers: {
            'User-Agent': this.getRandomUserAgent(),
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'de,en-US;q=0.7,en;q=0.3',
            'Accept-Encoding': 'gzip, deflate, br',
            'DNT': '1',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1',
            'Referer': 'https://www.willhaben.at/'
          },
          timeout: 30000
        });

        const $ = cheerio.load(response.data);
        
        // Detail-URLs finden (wie in Ihrem Python-Code)
        const links = $('a[href*="/iad/immobilien/d/"]');
        const pageUrls: string[] = [];
        
        links.each((i, link) => {
          const href = $(link).attr('href');
          if (href) {
            const cleanUrl = href.split('?')[0]; // Parameter entfernen
            const fullUrl = href.startsWith('http') ? cleanUrl : `https://www.willhaben.at${cleanUrl}`;
            if (!pageUrls.includes(fullUrl)) {
              pageUrls.push(fullUrl);
            }
          }
        });

        detailUrls.push(...pageUrls);
        options.onProgress(`[FOUND] Seite ${pageNum}: ${pageUrls.length} Detail-URLs gefunden`);
        
        // Längere Pause zwischen Seiten (gegen 429 Fehler)
        if (pageNum < options.maxPages) {
          await new Promise(resolve => setTimeout(resolve, Math.max(options.delay * 3, 5000)));
        }

      } catch (error: any) {
        if (error.response?.status === 429) {
          options.onProgress(`[RATE-LIMIT] Seite ${pageNum}: Warte 10 Sekunden...`);
          await new Promise(resolve => setTimeout(resolve, 10000));
          // Retry einmal
          try {
            const retryResponse = await axios.get(url, {
              headers: {
                'User-Agent': this.getRandomUserAgent(),
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'de,en-US;q=0.7,en;q=0.3',
                'DNT': '1',
                'Connection': 'keep-alive',
                'Upgrade-Insecure-Requests': '1',
                'Referer': 'https://www.willhaben.at/'
              },
              timeout: 30000
            });
            
            const $ = cheerio.load(retryResponse.data);
            const links = $('a[href*="/iad/immobilien/d/"]');
            const pageUrls: string[] = [];
            
            links.each((i, link) => {
              const href = $(link).attr('href');
              if (href) {
                const cleanUrl = href.split('?')[0];
                const fullUrl = href.startsWith('http') ? cleanUrl : `https://www.willhaben.at${cleanUrl}`;
                if (!pageUrls.includes(fullUrl)) {
                  pageUrls.push(fullUrl);
                }
              }
            });

            detailUrls.push(...pageUrls);
            options.onProgress(`[RETRY-SUCCESS] Seite ${pageNum}: ${pageUrls.length} URLs nach Retry`);
          } catch (retryError) {
            options.onProgress(`[ERROR] Seite ${pageNum} auch nach Retry fehlgeschlagen: ${retryError}`);
          }
        } else {
          options.onProgress(`[ERROR] Seite ${pageNum} fehlgeschlagen: ${error}`);
        }
      }
    }

    // Duplikate entfernen
    detailUrls = [...new Set(detailUrls)];
    options.onProgress(`[INFO] Insgesamt ${detailUrls.length} einzigartige Detail-URLs gefunden`);

    // Schritt 2: Jede Detail-Seite einzeln prüfen (wie in Ihrem Python-Code)
    for (let i = 0; i < detailUrls.length; i++) {
      const detailUrl = detailUrls[i];
      options.onProgress(`[CHECK] (${i+1}/${detailUrls.length}) Prüfe: ${detailUrl}`);
      
      try {
        const listingData = await this.scrapeDetailPage(detailUrl, category);
        if (listingData) {
          options.onProgress(`[SUCCESS] Private Anzeige: "${listingData.title}" - €${listingData.price.toLocaleString()}`);
          await options.onListingFound(listingData);
          totalFound++;
        } else {
          options.onProgress(`[SKIP] Gewerblich oder Fehler: ${detailUrl}`);
        }
        
        // Längere Pause zwischen Detail-Anfragen (gegen 429 Fehler)
        await new Promise(resolve => setTimeout(resolve, Math.max(options.delay * 2, 2000)));
        
      } catch (error) {
        options.onProgress(`[ERROR] Detail-Seite fehlgeschlagen: ${error}`);
      }
    }

    options.onProgress(`[COMPLETE] Kategorie ${category}: ${totalFound} private Listings gefunden`);
  }

  private async scrapeDetailPage(url: string, category: string): Promise<ListingData | null> {
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
      const bodyText = $('body').text().toLowerCase();

      // Private Stichworte für später

      // VERSTÄRKTE kommerzielle Ausschlüsse - Vorab-Check
      const preCommercialKeywords = [
        'immobilienmakler',
        'makler gmbh', 
        'immobilien gmbh',
        'remax',
        'century 21',
        'engel & völkers',
        'realitäten gmbh',
        'kaltenegger',
        'otto immobilien',
        'buwog'
      ];

      const foundPreCommercial = preCommercialKeywords.find(keyword => bodyText.includes(keyword.toLowerCase()));
      if (foundPreCommercial) {
        console.log(`[FILTER-1] ❌ VORAB-MAKLER: "${foundPreCommercial}" in ${url}`);
        return null;
      }

      // BESCHREIBUNG LADEN UND FILTERN (wie gewünscht)
      const description = this.extractDetailDescription($);
      console.log(`[FILTER] Prüfe Beschreibung für ${url}...`);
      
      // EINFACHER 2-SCHRITT FILTER: 
      // 1. DOPPELMARKLER suchen (Durchbruch!)
      // 2. Falls nicht gefunden, dann "privat" suchen
      
      const foundDoppelmarkler = (description + ' ' + bodyText).toLowerCase().includes('doppelmarkler');
      
      if (foundDoppelmarkler) {
        console.log(`[FILTER-FINAL] 🎯 DOPPELMARKLER GEFUNDEN in ${url}`);
      } else {
        const foundPrivat = (description + ' ' + bodyText).toLowerCase().includes('privat');
        
        if (foundPrivat) {
          console.log(`[FILTER-FINAL] ✅ PRIVAT GEFUNDEN in ${url}`);
        } else {
          console.log(`[FILTER-FINAL] ❌ WEDER DOPPELMARKLER NOCH PRIVAT in ${url}`);
          return null; // Raus wenn keins von beiden
        }
      }

      // 4. ALLE DETAILS EXTRAHIEREN (nur bei privaten Anzeigen)
      console.log(`[EXTRACT] ✅ Extrahiere alle Details für ${url}...`);
      
      const title = this.extractDetailTitle($);
      if (!title || title.length < 10) return null;

      const price = this.extractDetailPrice($);
      if (price === 0) return null;

      const area = this.extractDetailArea($);
      const location = this.extractDetailLocation($);
      const images = this.extractDetailImages($);
      
      // TELEFONNUMMER EXTRAHIEREN (wichtig für Akquisition)
      const phoneNumber = this.extractPhoneNumber($, bodyText);

      // Metadaten
      const region = category.includes('wien') ? 'wien' : 'niederoesterreich';
      const listingCategory = category.includes('eigentumswohnung') ? 'eigentumswohnung' : 'grundstueck';
      const eur_per_m2 = area > 0 ? Math.round(price / area) : 0;

      console.log(`[EXTRACT] ✅ PRIVATE ANZEIGE KOMPLETT: "${title}" - €${price}${phoneNumber ? ` - Tel: ${phoneNumber}` : ' - KEINE TEL'}`);

      return {
        title,
        price,
        area,
        location,
        url,
        images,
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

  private extractDetailTitle($: cheerio.CheerioAPI): string {
    const selectors = ['h1', 'h2', '[data-testid*="title"]', '.title'];
    
    for (const selector of selectors) {
      const element = $(selector).first();
      if (element.length > 0) {
        const text = element.text().trim();
        if (text && text.length > 5) {
          return text;
        }
      }
    }
    return '';
  }

  private extractDetailPrice($: cheerio.CheerioAPI): number {
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

  private extractDetailArea($: cheerio.CheerioAPI): number {
    const bodyText = $('body').text();
    const areaMatches = bodyText.match(/(\d{2,4})\s*m²/g);
    
    if (areaMatches) {
      for (const match of areaMatches) {
        const number = match.replace(/[^\d]/g, '');
        const area = parseInt(number);
        if (area > 20 && area < 10000) { // Realistischer Bereich
          return area;
        }
      }
    }
    return 0;
  }

  private extractDetailLocation($: cheerio.CheerioAPI): string {
    const bodyText = $('body').text();
    const locationMatch = bodyText.match(/(\d{4}\s+[A-ZÜÄÖSS][a-züäöß\s-]+)/);
    if (locationMatch) {
      return locationMatch[1].trim();
    }
    return '';
  }

  private extractDetailImages($: cheerio.CheerioAPI): string[] {
    const images: string[] = [];
    
    $('img').each((i, img) => {
      if (i >= 3) return false;
      
      const $img = $(img);
      const src = $img.attr('src') || $img.attr('data-src');
      if (src && src.startsWith('http') && !src.includes('logo')) {
        images.push(src);
      }
    });
    
    return images;
  }

  private extractDetailDescription($: cheerio.CheerioAPI): string {
    const descriptions = $('.description, .ad-description, [data-testid*="description"]');
    if (descriptions.length > 0) {
      return descriptions.first().text().trim();
    }
    return '';
  }

  private extractPhoneNumber($: cheerio.CheerioAPI, bodyText: string): string | null {
    // Österreichische Telefonnummer-Patterns
    const phonePatterns = [
      /(?:\+43|0043|0)\s*(\d{1,4})\s*(\d{3,4})\s*(\d{3,4})/g,  // +43 1 234 5678
      /(?:\+43|0043)\s*(\d{1,4})\s*(\d{6,8})/g,                 // +43 1 2345678
      /0(\d{1,4})\s*(\d{3,4})\s*(\d{3,4})/g,                    // 01 234 5678
      /0(\d{1,4})\/(\d{3,4})-?(\d{3,4})/g,                      // 01/234-5678
      /(\d{4})\s*(\d{3,4})\s*(\d{3,4})/g                        // 1234 567 890
    ];

    for (const pattern of phonePatterns) {
      const matches = bodyText.match(pattern);
      if (matches) {
        for (const match of matches) {
          // Nummer bereinigen
          const cleanNumber = match.replace(/[^\d+]/g, '').replace(/^0043/, '+43').replace(/^00/, '+');
          if (cleanNumber.length >= 10 && cleanNumber.length <= 15) {
            return cleanNumber;
          }
        }
      }
    }

    // Zusätzlich in spezifischen Elementen suchen
    const contactSelectors = [
      '[data-testid*="contact"]',
      '.contact',
      '.phone',
      '.telefon',
      '.tel'
    ];

    for (const selector of contactSelectors) {
      const element = $(selector);
      if (element.length > 0) {
        const text = element.text();
        for (const pattern of phonePatterns) {
          const matches = text.match(pattern);
          if (matches && matches[0]) {
            const cleanNumber = matches[0].replace(/[^\d+]/g, '').replace(/^0043/, '+43');
            if (cleanNumber.length >= 10 && cleanNumber.length <= 15) {
              return cleanNumber;
            }
          }
        }
      }
    }

    return null;
  }

  private extractListing($listing: cheerio.Cheerio<any>, category: string): ListingData | null {
    // Titel extrahieren
    const title = this.extractTitle($listing);
    if (!title || title.length < 10) return null;

    // Preis extrahieren
    const price = this.extractPrice($listing);
    if (price === 0) return null;

    // Fläche extrahieren
    const area = this.extractArea($listing);

    // Standort extrahieren
    const location = this.extractLocation($listing);

    // URL generieren
    const url = this.generateSearchUrl(title, price, category);

    // Bilder extrahieren
    const images = this.extractImages($listing);

    // Beschreibung extrahieren
    const description = this.extractDescription($listing);

    // Metadaten
    const region = category.includes('wien') ? 'wien' : 'niederoesterreich';
    const listingCategory = category.includes('eigentumswohnung') ? 'eigentumswohnung' : 'grundstueck';
    const eur_per_m2 = area > 0 ? Math.round(price / area) : 0;

    return {
      title,
      price,
      area,
      location,
      url,
      images,
      description,
      category: listingCategory,
      region,
      eur_per_m2
    };
  }

  private extractTitle($listing: cheerio.Cheerio<any>): string {
    const selectors = [
      'h3',
      'h2', 
      '[data-testid*="title"]',
      'a[title]',
      '.search-result-title',
      '.title',
      '.ad-title'
    ];

    for (const selector of selectors) {
      const element = $listing.find(selector).first();
      if (element.length > 0) {
        const text = element.text().trim();
        if (text && text.length > 5) {
          return text;
        }
      }
    }
    return '';
  }

  private extractPrice($listing: cheerio.Cheerio<any>): number {
    const text = $listing.text();
    
    // Verschiedene Preisformate erkennen
    const pricePatterns = [
      /€\s*([\d.,]+)/g,
      /([\d.,]+)\s*€/g,
      /EUR\s*([\d.,]+)/g,
      /([\d.,]+)\s*EUR/g
    ];

    for (const pattern of pricePatterns) {
      const matches = text.match(pattern);
      if (matches) {
        for (const match of matches) {
          const number = match.replace(/[€EUR\s]/g, '').replace(/,/g, '.');
          const price = parseFloat(number);
          if (price > 50000 && price < 10000000) { // Realistischer Preisbereich
            return Math.round(price);
          }
        }
      }
    }
    return 0;
  }

  private extractArea($listing: cheerio.Cheerio<any>): number {
    const text = $listing.text();
    const areaMatch = text.match(/([\d.,]+)\s*m²/i);
    if (areaMatch) {
      return parseFloat(areaMatch[1].replace(',', '.'));
    }
    return 0;
  }

  private extractLocation($listing: cheerio.Cheerio<any>): string {
    const text = $listing.text();
    
    // Österreichische PLZ + Ort Pattern
    const locationMatch = text.match(/(\d{4}\s+[A-ZÜÄÖSS][a-züäöß\s-]+)/);
    if (locationMatch) {
      return locationMatch[1].trim();
    }
    return '';
  }

  private extractImages($listing: cheerio.Cheerio<any>): string[] {
    const images: string[] = [];
    
    $listing.find('img').each((i, img) => {
      if (i >= 3) return false; // Max 3 Bilder
      
      const $img = $(img);
      const src = $img.attr('src') || $img.attr('data-src');
      if (src && src.startsWith('http') && !src.includes('logo')) {
        images.push(src);
      }
    });
    
    return images;
  }

  private extractDescription($listing: cheerio.Cheerio<any>): string {
    const text = $listing.text();
    // Nehme ersten sinnvollen Text als Beschreibung
    const sentences = text.split('.').filter(s => s.length > 20);
    return sentences.slice(0, 2).join('. ').substring(0, 200);
  }

  private generateSearchUrl(title: string, price: number, category: string): string {
    const cleanTitle = title.toLowerCase()
      .replace(/[^a-züäöß0-9\s]/g, '')
      .trim()
      .substring(0, 40)
      .replace(/\s+/g, '+');
    
    const priceRange = Math.floor(price / 50000) * 50000;
    const maxPrice = priceRange + 50000;
    const areaId = category.includes('wien') ? '900' : '903';
    const propertyType = category.includes('eigentumswohnung') ? 'eigentumswohnung' : 'grundstueck';
    
    return `https://www.willhaben.at/iad/immobilien/${propertyType}/${propertyType}-angebote?` +
           `keyword=${cleanTitle}&` +
           `priceFrom=${priceRange}&` +
           `priceTo=${maxPrice}&` +
           `areaId=${areaId}`;
  }

  private buildUrl(category: string, page: number): string {
    const baseUrls: { [key: string]: string } = {
      'eigentumswohnung-wien': 'https://www.willhaben.at/iad/immobilien/eigentumswohnung/eigentumswohnung-angebote?sfId=f81bdc8f-08a7-4f66-8e9a-6bd19b0c23ae&isNavigation=true&areaId=900&areaId=903&rows=25',
      'grundstueck-wien': 'https://www.willhaben.at/iad/immobilien/grundstueck/grundstueck-angebote?sfId=f81bdc8f-08a7-4f66-8e9a-6bd19b0c23ae&isNavigation=true&areaId=900&areaId=903&rows=25',
      'eigentumswohnung-niederoesterreich': 'https://www.willhaben.at/iad/immobilien/eigentumswohnung/eigentumswohnung-angebote?sfId=f81bdc8f-08a7-4f66-8e9a-6bd19b0c23ae&isNavigation=true&areaId=903&rows=25',
      'grundstueck-niederoesterreich': 'https://www.willhaben.at/iad/immobilien/grundstueck/grundstueck-angebote?sfId=f81bdc8f-08a7-4f66-8e9a-6bd19b0c23ae&isNavigation=true&areaId=903&rows=25'
    };

    const baseUrl = baseUrls[category] || baseUrls['eigentumswohnung-wien'];
    return `${baseUrl}&page=${page}`;
  }

  private cleanup(): void {
    this.isRunning = false;
  }

  public isScrapingActive(): boolean {
    return this.isRunning;
  }

  public async stopScraping(): Promise<void> {
    this.cleanup();
  }
}

export const scraperHttpService = new ScraperHttpService();