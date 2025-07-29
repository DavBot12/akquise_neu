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
  category: string;
  region: string;
  eur_per_m2: number;
}

export class ScraperHttpService {
  private isRunning = false;

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
    
    for (let pageNum = 1; pageNum <= options.maxPages; pageNum++) {
      const url = this.buildUrl(category, pageNum);
      options.onProgress(`[LOAD] Seite ${pageNum}: ${url}`);

      try {
        // HTTP Request mit realistischen Headers
        const response = await axios.get(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'de,en-US;q=0.7,en;q=0.3',
            'Accept-Encoding': 'gzip, deflate, br',
            'DNT': '1',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1'
          },
          timeout: 30000
        });

        const $ = cheerio.load(response.data);
        
        // Listings finden mit verschiedenen Selektoren
        const listingSelectors = [
          '[data-testid*="search-result-entry"]',
          'article[data-testid]',
          '.search-results-row',
          '[data-qa="search-result-item"]',
          'article',
          '.aditem',
          '.result-item'
        ];

        let listings: cheerio.Cheerio<any> | null = null;
        let usedSelector = '';

        for (const selector of listingSelectors) {
          const found = $(selector);
          if (found.length > 0) {
            listings = found;
            usedSelector = selector;
            options.onProgress(`[FOUND] ${found.length} Listings mit Selektor: ${selector}`);
            break;
          }
        }

        if (!listings || listings.length === 0) {
          options.onProgress(`[WARN] Seite ${pageNum}: Keine Listings gefunden`);
          continue;
        }

        // Jedes Listing verarbeiten
        let pageListings = 0;
        listings.each((i, element) => {
          try {
            const listingData = this.extractListing($(element), category);
            if (listingData) {
              options.onProgress(`[SUCCESS] Listing: "${listingData.title}" - €${listingData.price.toLocaleString()}`);
              // Asynchrone Verarbeitung
              options.onListingFound(listingData).catch(err => 
                options.onProgress(`[ERROR] Fehler beim Speichern: ${err.message}`)
              );
              pageListings++;
              totalFound++;
            }
          } catch (error) {
            options.onProgress(`[ERROR] Listing ${i+1} fehlgeschlagen: ${error}`);
          }
        });

        options.onProgress(`[PAGE] Seite ${pageNum}: ${pageListings} erfolgreiche Listings`);
        
        // Pause zwischen Seiten
        if (pageNum < options.maxPages) {
          await new Promise(resolve => setTimeout(resolve, options.delay));
        }

      } catch (error) {
        options.onProgress(`[ERROR] Seite ${pageNum} fehlgeschlagen: ${error}`);
      }
    }

    options.onProgress(`[COMPLETE] Kategorie ${category}: ${totalFound} Listings insgesamt`);
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