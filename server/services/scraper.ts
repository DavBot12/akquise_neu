import { chromium, Browser, Page } from 'playwright-core';

export interface ScrapingOptions {
  categories: string[];
  maxPages: number;
  delay: number;
  onProgress: (message: string) => void;
  onListingFound: (listing: any) => Promise<void>;
  onComplete?: () => void;
}

export class ScraperService {
  private browser: Browser | null = null;
  private isRunning = false;

  private readonly WILLHABEN_URLS = {
    'eigentumswohnung-wien': 'https://www.willhaben.at/iad/immobilien/eigentumswohnung/eigentumswohnung-angebote/wien?sort=1',
    'grundstueck-wien': 'https://www.willhaben.at/iad/immobilien/grundstueck/grundstueck-angebote/wien?sort=1',
    'eigentumswohnung-niederoesterreich': 'https://www.willhaben.at/iad/immobilien/eigentumswohnung/eigentumswohnung-angebote/niederoesterreich?sort=1',
    'grundstueck-niederoesterreich': 'https://www.willhaben.at/iad/immobilien/grundstueck/grundstueck-angebote/niederoesterreich?sort=1'
  };

  async startScraping(options: ScrapingOptions): Promise<void> {
    if (this.isRunning) {
      throw new Error('Scraper is already running');
    }

    this.isRunning = true;
    options.onProgress('[INFO] Scraper wird gestartet...');

    try {
      // Start Chromium browser
      this.browser = await chromium.launch({ 
        headless: true,
        executablePath: '/nix/store/qa9cnw4v5xkxyip6mb9kxqfq1z4x2dx1-chromium-138.0.7204.100/bin/chromium',
        args: [
          '--no-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--disable-background-timer-throttling',
          '--disable-backgrounding-occluded-windows',
          '--disable-renderer-backgrounding'
        ]
      });
      options.onProgress('[SUCCESS] Browser erfolgreich gestartet');
      
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
      if (options.onComplete) {
        options.onComplete();
      }
    }
  }

  private async scrapeCategory(category: string, options: ScrapingOptions): Promise<void> {
    const baseUrl = this.WILLHABEN_URLS[category as keyof typeof this.WILLHABEN_URLS];
    const page = await this.browser!.newPage();
    
    try {
      let totalListingsFound = 0;
      
      // Process multiple pages for this category
      for (let currentPage = 1; currentPage <= options.maxPages; currentPage++) {
        const url = currentPage === 1 ? baseUrl : `${baseUrl}&page=${currentPage}`;
        options.onProgress(`[INFO] Lade Seite ${currentPage}/${options.maxPages} für ${category}`);
        
        await page.goto(url, { 
          waitUntil: 'networkidle',
          timeout: 30000 
        });
        
        await page.waitForTimeout(Math.max(options.delay, 1500));
        
        // Find listings using the most reliable selectors
        const listings = await page.$$('article[data-testid*="search-result-entry"]');
        
        if (listings.length === 0) {
          // Try alternative selectors
          const alternativeListings = await page.$$('div[data-testid*="search-result-entry"]');
          if (alternativeListings.length > 0) {
            listings.push(...alternativeListings);
          }
        }
        
        options.onProgress(`[INFO] ${listings.length} potentielle Listings auf Seite ${currentPage} gefunden`);
        
        if (listings.length === 0) {
          options.onProgress(`[WARN] Keine Listings auf Seite ${currentPage} - überspringe`);
          continue;
        }
        
        // Process listings efficiently - mit mehr Debug-Info
        let privateListingsFound = 0;
        let commercialCount = 0;
        let skippedCount = 0;
        const maxListingsPerPage = Math.min(listings.length, 15);
        
        options.onProgress(`[INFO] Prüfe ${maxListingsPerPage} von ${listings.length} Listings auf Seite ${currentPage}`);
        
        for (let i = 0; i < maxListingsPerPage; i++) {
          try {
            const listing = listings[i];
            
            // Quick validation
            const listingText = await listing.evaluate((el: Element) => el.textContent?.toLowerCase() || '');
            
            if (listingText.length < 30 || 
                !listingText.includes('€') || 
                listingText.includes('show-results') ||
                listingText.includes('pagination')) {
              skippedCount++;
              continue;
            }
            
            // Check if private - with detailed debugging
            const isPrivate = await this.isPrivateListing(listing);
            if (!isPrivate) {
              commercialCount++;
              // Zeige ersten Teil des Textes für Debug
              const debugText = listingText.substring(0, 120).replace(/\s+/g, ' ');
              options.onProgress(`[DEBUG] Nicht-privat (${i+1}): "${debugText}..."`);
              continue;
            }
            
            privateListingsFound++;
            
            // Extract data
            const listingData = await this.extractListingData(listing, category);
            if (listingData && listingData.title && listingData.price > 0) {
              options.onProgress(`[SUCCESS] Privates Listing: "${listingData.title}" - €${listingData.price.toLocaleString()}`);
              await options.onListingFound(listingData);
            }
          } catch (error) {
            // Skip failed listings
            continue;
          }
        }
        
        totalListingsFound += privateListingsFound;
        options.onProgress(`[STATS] Seite ${currentPage}: ${privateListingsFound} privat, ${commercialCount} kommerziell, ${skippedCount} übersprungen (von ${listings.length} total)`);
        
        // Delay between pages
        if (currentPage < options.maxPages) {
          await page.waitForTimeout(Math.max(options.delay, 1000));
        }
      }
      
      options.onProgress(`[FINAL] Kategorie ${category}: ${totalListingsFound} private Listings insgesamt gefunden`);
    } finally {
      await page.close();
    }
  }

  private async isPrivateListing(listing: any): Promise<boolean> {
    try {
      const allText = await listing.evaluate((el: Element) => el.textContent?.toLowerCase() || '');
      
      // Suche explizit nach privaten Verkäufer-Begriffen
      const privateIndicators = [
        'privat',
        'private',
        'privatverkauf',
        'von privat',
        'private anzeige',
        'privatperson',
        'privater verkauf',
        'kein makler',
        'ohne makler',
        'direkt vom eigentümer',
        'eigentümer',
        'privatanbieter'
      ];
      
      // Nur als privat einstufen wenn explizit erwähnt
      const foundIndicator = privateIndicators.find(indicator => 
        allText.includes(indicator)
      );
      
      return !!foundIndicator;
    } catch (error) {
      return false; // Im Zweifel als nicht-privat behandeln (sicherer)
    }
  }

  private async extractListingData(listing: any, category: string): Promise<any | null> {
    try {
      // Extract title
      let title = '';
      const titleSelectors = ['a h3', 'h3', 'h2', 'a[title]'];
      
      for (const selector of titleSelectors) {
        const titleElement = await listing.$(selector);
        if (titleElement) {
          const text = await titleElement.textContent();
          if (text && text.trim().length > 10) {
            title = text.trim();
            break;
          }
        }
      }
      
      // Extract price
      let priceText = '';
      const allElements = await listing.$$('*');
      for (const element of allElements) {
        const text = await element.textContent();
        if (text && text.includes('€') && text.match(/€\s*[\d.,]+/)) {
          priceText = text;
          break;
        }
      }
      
      const price = this.extractPrice(priceText);
      
      // Extract area
      let areaText = '';
      for (const element of allElements) {
        const text = await element.textContent();
        if (text && text.includes('m²')) {
          areaText = text;
          break;
        }
      }
      const area = this.extractArea(areaText);
      
      // Extract URL
      let url = '';
      const linkElements = await listing.$$('a');
      for (const linkElement of linkElements) {
        const href = await linkElement.getAttribute('href');
        if (href && href.includes('/iad/')) {
          url = href.startsWith('http') ? href : `https://www.willhaben.at${href}`;
          break;
        }
      }
      
      // Extract location
      let location = '';
      const allText = await listing.evaluate((el: Element) => el.textContent || '');
      const locationPatterns = [
        /(\d{4}\s+[a-züäöß\s]+)/gi,
        /([a-züäöß\s]+stadt)/gi,
      ];
      
      for (const pattern of locationPatterns) {
        const matches = allText.match(pattern);
        if (matches && matches[0].length > 5) {
          location = matches[0].trim();
          break;
        }
      }
      
      // Validate required data
      if (!title || price === 0 || !url) {
        return null;
      }
      
      const eur_per_m2 = area > 0 ? Math.round(price / area) : 0;
      const region = category.includes('wien') ? 'wien' : 'niederoesterreich';
      const listingCategory = category.includes('eigentumswohnung') ? 'eigentumswohnung' : 'grundstueck';
      
      // Extract images
      const images: string[] = [];
      const imgElements = await listing.$$('img');
      for (const img of imgElements.slice(0, 3)) {
        const src = await img.getAttribute('src');
        if (src && src.startsWith('http')) {
          images.push(src);
        }
      }
      
      return {
        title,
        price,
        location,
        area: area.toString(),
        eur_per_m2: eur_per_m2.toString(),
        description: '',
        images,
        url,
        scraped_at: new Date().toISOString(),
        akquise_erledigt: false,
        price_evaluation: 'im_schnitt',
        category: listingCategory,
        region
      };
    } catch (error) {
      return null;
    }
  }

  private extractPrice(priceText: string): number {
    if (!priceText) return 0;
    
    const patterns = [
      /€\s*([\d]+(?:[.,]\d{3})*)/,
      /([\d]+(?:[.,]\d{3})*)\s*€/,
      /€\s*([\d]+)/,
      /([\d]+)\s*€/
    ];
    
    for (const pattern of patterns) {
      const matches = priceText.match(pattern);
      if (matches) {
        let priceStr = matches[1].replace(/[.,]/g, '');
        const price = parseInt(priceStr);
        
        if (price >= 10000 && price <= 50000000) {
          return price;
        }
      }
    }
    
    return 0;
  }

  private extractArea(areaText: string): number {
    if (!areaText) return 0;
    
    const match = areaText.match(/([\d.,]+)\s*m²/);
    if (match) {
      const areaStr = match[1].replace(',', '.');
      return parseFloat(areaStr);
    }
    
    return 0;
  }

  stopScraping(): void {
    this.isRunning = false;
  }

  isScrapingRunning(): boolean {
    return this.isRunning;
  }
}