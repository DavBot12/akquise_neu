import { chromium, Browser, Page } from 'playwright';
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

export class ScraperV2Service {
  private browser: Browser | null = null;
  private isRunning = false;

  async startScraping(options: ScrapingOptions): Promise<void> {
    if (this.isRunning) {
      throw new Error('Scraper is already running');
    }

    this.isRunning = true;
    options.onProgress('[INFO] Neuer Scraper V2 gestartet...');

    try {
      // Browser mit erweiterten Einstellungen für Replit-Umgebung starten
      this.browser = await chromium.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--disable-software-rasterizer',
          '--disable-background-timer-throttling',
          '--disable-backgrounding-occluded-windows',
          '--disable-renderer-backgrounding',
          '--disable-features=VizDisplayCompositor',
          '--disable-extensions',
          '--disable-plugins',
          '--disable-web-security',
          '--disable-features=TranslateUI',
          '--disable-ipc-flooding-protection',
          '--use-gl=swiftshader',
          '--enable-unsafe-swiftshader'
        ],
        chromiumSandbox: false
      });

      options.onProgress('[SUCCESS] Browser V2 erfolgreich gestartet');

      // Für jede Kategorie scrapen
      for (const category of options.categories) {
        await this.scrapeCategory(category, options);
      }

      options.onProgress('[FINAL] Scraper V2 komplett abgeschlossen');
    } finally {
      await this.cleanup();
    }
  }

  private async scrapeCategory(category: string, options: ScrapingOptions): Promise<void> {
    if (!this.browser) return;

    const page = await this.browser.newPage();
    
    try {
      // User-Agent setzen
      await page.setExtraHTTPHeaders({
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      });
      
      options.onProgress(`[START] Kategorie ${category} wird gescrapt...`);

      let totalFound = 0;
      
      for (let pageNum = 1; pageNum <= options.maxPages; pageNum++) {
        const url = this.buildUrl(category, pageNum);
        options.onProgress(`[LOAD] Seite ${pageNum}: ${url}`);

        // Seite laden
        await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
        await page.waitForTimeout(Math.max(options.delay, 1000));

        // Listings finden mit robusten Selektoren
        const listingSelectors = [
          '[data-testid*="search-result-entry"]',
          'article[data-testid]',
          '.search-results-row',
          '[data-qa="search-result-item"]'
        ];

        let listings: any[] = [];
        for (const selector of listingSelectors) {
          listings = await page.$$(selector);
          if (listings.length > 0) {
            options.onProgress(`[FOUND] ${listings.length} Listings mit Selektor: ${selector}`);
            break;
          }
        }

        if (listings.length === 0) {
          options.onProgress(`[WARN] Seite ${pageNum}: Keine Listings gefunden`);
          continue;
        }

        // Jedes Listing verarbeiten
        let pageListings = 0;
        for (let i = 0; i < listings.length; i++) {
          try {
            const listingData = await this.extractListing(listings[i], category, page);
            if (listingData) {
              options.onProgress(`[SUCCESS] Listing: "${listingData.title}" - €${listingData.price.toLocaleString()}`);
              await options.onListingFound(listingData);
              pageListings++;
              totalFound++;
            }
          } catch (error) {
            options.onProgress(`[ERROR] Listing ${i+1} fehlgeschlagen: ${error}`);
          }
        }

        options.onProgress(`[PAGE] Seite ${pageNum}: ${pageListings} erfolgreiche Listings`);
        
        // Pause zwischen Seiten
        if (pageNum < options.maxPages) {
          await page.waitForTimeout(options.delay);
        }
      }

      options.onProgress(`[COMPLETE] Kategorie ${category}: ${totalFound} Listings insgesamt`);
    } finally {
      await page.close();
    }
  }

  private async extractListing(listing: any, category: string, page: Page): Promise<ListingData | null> {
    // Titel extrahieren
    const title = await this.extractTitle(listing);
    if (!title || title.length < 10) return null;

    // Preis extrahieren
    const price = await this.extractPrice(listing);
    if (price === 0) return null;

    // Fläche extrahieren
    const area = await this.extractArea(listing);

    // Standort extrahieren
    const location = await this.extractLocation(listing);

    // URL generieren (funktionale Such-URL)
    const url = this.generateSearchUrl(title, price, category);

    // Bilder extrahieren
    const images = await this.extractImages(listing);

    // Beschreibung extrahieren
    const description = await this.extractDescription(listing);

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

  private async extractTitle(listing: any): Promise<string> {
    const selectors = [
      'h3',
      'h2', 
      '[data-testid*="title"]',
      'a[title]',
      '.search-result-title'
    ];

    for (const selector of selectors) {
      try {
        const element = await listing.$(selector);
        if (element) {
          const text = await element.textContent();
          if (text && text.trim().length > 5) {
            return text.trim();
          }
        }
      } catch (error) {
        continue;
      }
    }
    return '';
  }

  private async extractPrice(listing: any): Promise<number> {
    try {
      const text = await listing.evaluate((el: Element) => el.textContent || '');
      
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
    } catch (error) {
      // Ignore extraction errors
    }
    return 0;
  }

  private async extractArea(listing: any): Promise<number> {
    try {
      const text = await listing.evaluate((el: Element) => el.textContent || '');
      const areaMatch = text.match(/([\d.,]+)\s*m²/i);
      if (areaMatch) {
        return parseFloat(areaMatch[1].replace(',', '.'));
      }
    } catch (error) {
      // Ignore extraction errors
    }
    return 0;
  }

  private async extractLocation(listing: any): Promise<string> {
    try {
      const text = await listing.evaluate((el: Element) => el.textContent || '');
      
      // Österreichische PLZ + Ort Pattern
      const locationMatch = text.match(/(\d{4}\s+[A-ZÜÄÖSS][a-züäöß\s-]+)/);
      if (locationMatch) {
        return locationMatch[1].trim();
      }
    } catch (error) {
      // Ignore extraction errors
    }
    return '';
  }

  private async extractImages(listing: any): Promise<string[]> {
    const images: string[] = [];
    try {
      const imgElements = await listing.$$('img');
      for (const img of imgElements.slice(0, 3)) { // Max 3 Bilder
        const src = await img.getAttribute('src');
        if (src && src.startsWith('http') && !src.includes('logo')) {
          images.push(src);
        }
      }
    } catch (error) {
      // Ignore extraction errors
    }
    return images;
  }

  private async extractDescription(listing: any): Promise<string> {
    try {
      const text = await listing.evaluate((el: Element) => el.textContent || '');
      // Nehme ersten sinnvollen Text als Beschreibung
      const sentences = text.split('.').filter((s: string) => s.length > 20);
      return sentences.slice(0, 2).join('. ').substring(0, 200);
    } catch (error) {
      return '';
    }
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

  private async cleanup(): Promise<void> {
    this.isRunning = false;
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }

  public isScrapingActive(): boolean {
    return this.isRunning;
  }

  public async stopScraping(): Promise<void> {
    await this.cleanup();
  }
}

export const scraperV2Service = new ScraperV2Service();