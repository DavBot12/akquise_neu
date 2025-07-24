import { chromium, Browser, Page } from 'playwright';

export interface ScrapingOptions {
  categories: string[];
  maxPages: number;
  delay: number;
  onProgress: (message: string) => void;
  onListingFound: (listing: any) => Promise<void>;
}

export class ScraperService {
  private browser: Browser | null = null;
  private isRunning = false;

  private readonly WILLHABEN_URLS = {
    'eigentumswohnung-wien': 'https://www.willhaben.at/iad/immobilien/eigentumswohnung/eigentumswohnung-angebote/wien',
    'grundstuecke-wien': 'https://www.willhaben.at/iad/immobilien/grundstuecke/grundstuecke-angebote/wien',
    'eigentumswohnung-niederoesterreich': 'https://www.willhaben.at/iad/immobilien/eigentumswohnung/eigentumswohnung-angebote/niederoesterreich',
    'grundstuecke-niederoesterreich': 'https://www.willhaben.at/iad/immobilien/grundstuecke/grundstuecke-angebote/niederoesterreich'
  };

  async startScraping(options: ScrapingOptions): Promise<void> {
    if (this.isRunning) {
      throw new Error('Scraper is already running');
    }

    this.isRunning = true;
    options.onProgress('[INFO] Scraper wird gestartet...');

    try {
      // Check if browser dependencies are available
      try {
        this.browser = await chromium.launch({ headless: true });
      } catch (browserError) {
        const errorMessage = browserError instanceof Error ? browserError.message : String(browserError);
        if (errorMessage.includes('Host system is missing dependencies')) {
          throw new Error('Browser dependencies are not installed. Please install them using the System Dependencies panel in Replit, or contact support if you need help setting up the scraper.');
        }
        throw browserError;
      }
      
      for (const category of options.categories) {
        if (!this.WILLHABEN_URLS[category as keyof typeof this.WILLHABEN_URLS]) {
          continue;
        }

        options.onProgress(`[INFO] Starte Scraping für ${category}`);
        await this.scrapeCategory(category, options);
      }

      options.onProgress('[SUCCESS] Scraping erfolgreich abgeschlossen');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      options.onProgress(`[ERROR] Scraping Fehler: ${errorMessage}`);
      throw error;
    } finally {
      if (this.browser) {
        await this.browser.close();
        this.browser = null;
      }
      this.isRunning = false;
    }
  }

  private async scrapeCategory(category: string, options: ScrapingOptions): Promise<void> {
    const baseUrl = this.WILLHABEN_URLS[category as keyof typeof this.WILLHABEN_URLS];
    const page = await this.browser!.newPage();
    
    try {
      let currentPage = 1;
      let hasMorePages = true;
      
      while (hasMorePages && currentPage <= options.maxPages) {
        const url = `${baseUrl}?page=${currentPage}`;
        options.onProgress(`[INFO] Lade Seite ${currentPage}: ${url}`);
        
        await page.goto(url, { waitUntil: 'networkidle' });
        await page.waitForTimeout(options.delay);

        // Check if page exists
        const listings = await page.$$('[data-testid="search-result-item"]');
        
        if (listings.length === 0) {
          options.onProgress(`[INFO] Keine Listings auf Seite ${currentPage} gefunden`);
          hasMorePages = false;
          break;
        }

        options.onProgress(`[INFO] ${listings.length} Listings auf Seite ${currentPage} gefunden`);

        for (let i = 0; i < listings.length; i++) {
          try {
            const listing = listings[i];
            
            // Check if it's a private listing
            const isPrivate = await this.isPrivateListing(listing);
            if (!isPrivate) {
              continue;
            }

            const listingData = await this.extractListingData(listing, category);
            if (listingData) {
              options.onProgress(`[SUCCESS] Speichere Listing: "${listingData.title}"`);
              await options.onListingFound(listingData);
            }
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            options.onProgress(`[WARNING] Fehler bei Listing ${i + 1}: ${errorMessage}`);
          }
        }

        currentPage++;
        
        // Check if there's a next page
        const nextPageButton = await page.$('[data-testid="pagination-next"]');
        hasMorePages = nextPageButton !== null && await nextPageButton.isEnabled();
      }
    } finally {
      await page.close();
    }
  }

  private async isPrivateListing(listing: any): Promise<boolean> {
    try {
      // Look for "Privat" indicator
      const privatTexts = await listing.$$eval('*', (elements: Element[]) => 
        elements.map(el => el.textContent?.toLowerCase() || '').filter(text => 
          text.includes('privat') || text.includes('private')
        )
      );
      
      return privatTexts.length > 0;
    } catch (error) {
      return false;
    }
  }

  private async extractListingData(listing: any, category: string): Promise<any | null> {
    try {
      // Extract title
      const titleElement = await listing.$('[data-testid="search-result-title"]');
      const title = titleElement ? await titleElement.textContent() : '';

      // Extract price
      const priceElement = await listing.$('[data-testid="search-result-price"]');
      const priceText = priceElement ? await priceElement.textContent() : '';
      const price = this.extractPrice(priceText);

      // Extract location
      const locationElement = await listing.$('[data-testid="search-result-location"]');
      const location = locationElement ? await locationElement.textContent() : '';

      // Extract area
      const areaElement = await listing.$('[data-testid="search-result-area"]');
      const areaText = areaElement ? await areaElement.textContent() : '';
      const area = this.extractArea(areaText);

      // Extract URL
      const linkElement = await listing.$('a');
      const relativeUrl = linkElement ? await linkElement.getAttribute('href') : '';
      const url = relativeUrl ? `https://www.willhaben.at${relativeUrl}` : '';

      // Extract images
      const imageElements = await listing.$$('img');
      const images = await Promise.all(
        imageElements.map((img: any) => img.getAttribute('src'))
      );
      const validImages = images.filter(Boolean) as string[];

      // Extract description (might need to visit detail page)
      const description = await this.extractDescription(listing);

      if (!title || !price || !url) {
        return null;
      }

      const eur_per_m2 = area > 0 ? Math.round(price / area) : 0;
      const region = category.includes('wien') ? 'wien' : 'niederoesterreich';
      const listingCategory = category.includes('eigentumswohnung') ? 'eigentumswohnung' : 'grundstueck';

      return {
        title: title.trim(),
        price,
        location: location.trim(),
        area,
        eur_per_m2,
        description: description.trim(),
        images: validImages,
        url,
        category: listingCategory,
        region,
      };
    } catch (error) {
      console.error('Error extracting listing data:', error);
      return null;
    }
  }

  private extractPrice(priceText: string): number {
    const matches = priceText.match(/€\s*([\d.,]+)/);
    if (matches) {
      return parseInt(matches[1].replace(/[.,]/g, ''));
    }
    return 0;
  }

  private extractArea(areaText: string): number {
    const matches = areaText.match(/([\d.,]+)\s*m²/);
    if (matches) {
      return parseFloat(matches[1].replace(',', '.'));
    }
    return 0;
  }

  private async extractDescription(listing: any): Promise<string> {
    try {
      const descElement = await listing.$('[data-testid="search-result-description"]');
      return descElement ? await descElement.textContent() || '' : '';
    } catch (error) {
      return '';
    }
  }

  isScrapingActive(): boolean {
    return this.isRunning;
  }
}
