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
    'grundstuecke-wien': 'https://www.willhaben.at/iad/immobilien/grundstuecke/grundstuecke-angebote/wien?sort=1',
    'eigentumswohnung-niederoesterreich': 'https://www.willhaben.at/iad/immobilien/eigentumswohnung/eigentumswohnung-angebote/niederoesterreich?sort=1',
    'grundstuecke-niederoesterreich': 'https://www.willhaben.at/iad/immobilien/grundstuecke/grundstuecke-angebote/niederoesterreich?sort=1'
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
      } catch (browserError) {
        const errorMessage = browserError instanceof Error ? browserError.message : String(browserError);
        options.onProgress(`[ERROR] Browser-Start Fehler: ${errorMessage}`);
        if (errorMessage.includes('Host system is missing dependencies')) {
          options.onProgress('[ERROR] Browser dependencies are not installed. Please install them using the System Dependencies panel in Replit.');
          options.onProgress('[INFO] Scraping cannot proceed without browser dependencies.');
          return;
        }
        // Try without executablePath if the specific path fails
        try {
          options.onProgress('[INFO] Versuche Browser ohne spezifischen Pfad...');
          this.browser = await chromium.launch({ 
            headless: true,
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
        } catch (fallbackError) {
          throw browserError;
        }
      }
      
      for (const category of options.categories) {
        if (!this.WILLHABEN_URLS[category as keyof typeof this.WILLHABEN_URLS]) {
          continue;
        }

        options.onProgress(`[INFO] Starte Scraping für ${category}`);
        await this.scrapeCategory(category, options);
      }

      options.onProgress('[SUCCESS] Scraping erfolgreich abgeschlossen');
      if (options.onComplete) {
        options.onComplete();
      }
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
      let currentPage = 1;
      let hasMorePages = true;
      
      while (hasMorePages && currentPage <= options.maxPages) {
        const url = `${baseUrl}?page=${currentPage}`;
        options.onProgress(`[INFO] Lade Seite ${currentPage}: ${url}`);
        
        await page.goto(url, { waitUntil: 'networkidle' });
        await page.waitForTimeout(options.delay);

        // Wait for page to load and debug the page structure
        await page.waitForTimeout(3000);
        
        // Debug: Check page content and structure
        const pageTitle = await page.title();
        options.onProgress(`[DEBUG] Seite geladen: ${pageTitle}`);
        
        // Check for different listing container patterns - modernized Willhaben selectors
        const possibleSelectors = [
          'article',
          '[data-testid*="result"]',
          '[data-testid*="item"]', 
          '[data-testid*="listing"]',
          '.MuiCard-root',
          '.MuiPaper-root',
          '[data-cy*="result"]',
          '[data-cy*="item"]',
          '.search-list-item',
          '.search-result-entry',
          '.result-item',
          '.advertContainer',
          'div[role="article"]',
          'div[data-testid]'
        ];
        
        let listings: any[] = [];
        let usedSelector = '';
        
        for (const selector of possibleSelectors) {
          const found = await page.$$(selector);
          if (found.length > 0) {
            listings = found;
            usedSelector = selector;
            options.onProgress(`[DEBUG] Gefunden mit Selektor "${selector}": ${found.length} Listings`);
            break;
          }
        }
        
        // If still no listings found, try to debug page structure
        if (listings.length === 0) {
          const bodyContent = await page.evaluate(() => {
            const body = document.body;
            const allElements = body.querySelectorAll('*');
            const testIds = Array.from(allElements)
              .map(el => el.getAttribute('data-testid'))
              .filter(id => id)
              .slice(0, 20);
            
            // Also check for common class patterns
            const commonClasses = Array.from(allElements)
              .map(el => el.className)
              .filter(className => className && typeof className === 'string')
              .filter(className => className.includes('result') || className.includes('item') || className.includes('card'))
              .slice(0, 10);
              
            // Check if page loaded correctly
            const hasContent = body.textContent && body.textContent.length > 100;
            
            return { 
              testIds, 
              commonClasses,
              bodyExists: !!body,
              hasContent,
              pageText: body.textContent?.substring(0, 300) || 'Kein Text'
            };
          });
          options.onProgress(`[DEBUG] Detaillierte Seiten-Analyse: ${JSON.stringify(bodyContent, null, 2)}`);
          
          // Try to take a screenshot for debugging
          try {
            await page.screenshot({ path: '/tmp/debug-willhaben.png', fullPage: false });
            options.onProgress(`[DEBUG] Screenshot gespeichert: /tmp/debug-willhaben.png`);
          } catch (e) {
            options.onProgress(`[DEBUG] Screenshot fehlgeschlagen`);
          }
        }
        
        if (listings.length === 0) {
          options.onProgress(`[INFO] Keine Listings auf Seite ${currentPage} gefunden`);
          hasMorePages = false;
          break;
        }

        options.onProgress(`[INFO] ${listings.length} Listings auf Seite ${currentPage} gefunden`);
        
        let privateListingsFound = 0;

        for (let i = 0; i < listings.length; i++) {
          try {
            const listing = listings[i];
            
            // Check if it's a private listing
            const listingText = await listing.evaluate((el: Element) => el.textContent?.toLowerCase() || '');
            const isPrivate = await this.isPrivateListing(listing);
            
            if (!isPrivate) {
              // Debug why it was excluded - show which commercial indicator was found
              const commercialFound = ['realitäten gmbh', 'kaltenegger', 'makler', 'immobilien gmbh', 'remax'].find(term => 
                listingText.includes(term)
              );
              options.onProgress(`[DEBUG] Ausgeschlossen (${commercialFound || 'kommerziell'}): "${listingText.substring(0, 80)}..."`);
              continue;
            }
            privateListingsFound++;
            options.onProgress(`[DEBUG] Private Listing gefunden: "${listingText.substring(0, 80)}..."`);

            const listingData = await this.extractListingData(listing, category);
            if (listingData && listingData.title && listingData.price > 0) {
              options.onProgress(`[SUCCESS] Speichere Listing: "${listingData.title}" - €${listingData.price}`);
              await options.onListingFound(listingData);
            } else {
              const debugInfo = listingData ? 
                `title:'${listingData.title}' price:${listingData.price}` : 
                'null data';
              options.onProgress(`[WARNING] Konnte Listing ${i + 1} nicht extrahieren (${debugInfo})`);
            }
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            options.onProgress(`[WARNING] Fehler bei Listing ${i + 1}: ${errorMessage}`);
          }
        }

        options.onProgress(`[INFO] ${privateListingsFound} private Listings auf Seite ${currentPage} gefunden`);
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
      // Get all text content from the listing
      const allText = await listing.evaluate((el: Element) => el.textContent?.toLowerCase() || '');
      
      // Strong commercial indicators that definitely exclude listings
      const commercialExclusions = [
        'immobilienmakler',
        'makler gmbh',
        'immobilien gmbh',
        'immobilienagentur',
        'immobilienservice',
        'maklerhaus',
        'remax',
        'century 21',
        'realitäten gmbh',
        'realitäten',
        'kaltenegger',
        'otto immobilien',
        'engel & völkers',
        'buwog',
        'are'
      ];
      
      // Check for strong commercial exclusions first
      const hasStrongCommercial = commercialExclusions.some(indicator => 
        allText.includes(indicator)
      );
      
      if (hasStrongCommercial) {
        return false;
      }
      
      // If no strong commercial indicators, assume it could be private
      // Many private listings don't explicitly say "privat"
      
      // Look for explicit private indicators (bonus points)
      const privateIndicators = [
        'privat',
        'private',
        'privatverkauf',
        'von privat',
        'private anzeige',
        'privatperson',
        'eigentümer'
      ];
      
      const hasPrivateIndicator = privateIndicators.some(indicator => 
        allText.includes(indicator)
      );
      
      // Return true if no strong commercial exclusions
      // Private indicator gives bonus but is not required
      return !hasStrongCommercial;
      
    } catch (error) {
      console.error('Error checking private listing:', error);
      // Default to true to avoid missing potential private listings
      return true;
    }
  }

  private async extractListingData(listing: any, category: string): Promise<any | null> {
    try {
      // Extract title - comprehensive selector search
      let title = '';
      const titleSelectors = [
        '[data-testid="search-result-title"]',
        '[data-testid*="title"]',
        'h1', 'h2', 'h3', 'h4',
        '.title',
        '.sf-search-list-item-title',
        '.result-title',
        'a[title]',
        '.advertTitle'
      ];
      
      for (const selector of titleSelectors) {
        const titleElement = await listing.$(selector);
        if (titleElement) {
          title = await titleElement.textContent() || '';
          if (title.trim()) break;
        }
      }
      
      // Fallback: try to get title from link text
      if (!title.trim()) {
        const linkElement = await listing.$('a');
        if (linkElement) {
          title = await linkElement.getAttribute('title') || await linkElement.textContent() || '';
        }
      }

      // Extract price - try multiple selectors
      let priceText = '';
      const priceSelectors = [
        '[data-testid="search-result-price"]',
        '.sf-search-list-item-price',
        '[data-testid="result-price"]',
        '.price'
      ];
      
      for (const selector of priceSelectors) {
        const priceElement = await listing.$(selector);
        if (priceElement) {
          priceText = await priceElement.textContent() || '';
          if (priceText.trim()) break;
        }
      }
      
      const price = this.extractPrice(priceText);

      // Extract location - try multiple selectors
      let location = '';
      const locationSelectors = [
        '[data-testid="search-result-location"]',
        '.sf-search-list-item-location',
        '[data-testid="result-location"]',
        '.location'
      ];
      
      for (const selector of locationSelectors) {
        const locationElement = await listing.$(selector);
        if (locationElement) {
          location = await locationElement.textContent() || '';
          if (location.trim()) break;
        }
      }

      // Extract area - try multiple selectors and text patterns
      let areaText = '';
      const areaSelectors = [
        '[data-testid="search-result-area"]',
        '.sf-search-list-item-area',
        '[data-testid="result-area"]',
        '.area'
      ];
      
      for (const selector of areaSelectors) {
        const areaElement = await listing.$(selector);
        if (areaElement) {
          areaText = await areaElement.textContent() || '';
          if (areaText.trim()) break;
        }
      }
      
      // If no area element found, try to extract from all text
      if (!areaText.trim()) {
        const allText = await listing.evaluate((el: Element) => el.textContent || '');
        const areaMatch = allText.match(/([\d.,]+)\s*m²/);
        areaText = areaMatch ? areaMatch[0] : '';
      }
      
      const area = this.extractArea(areaText);

      // Extract URL - try multiple approaches
      let url = '';
      
      // Try to find link element
      const linkElement = await listing.$('a');
      if (linkElement) {
        let href = await linkElement.getAttribute('href');
        if (href) {
          url = href.startsWith('http') ? href : `https://www.willhaben.at${href}`;
        }
      }
      
      // If no URL found from link, try to construct from any ID or data attribute
      if (!url) {
        const dataTestId = await listing.getAttribute('data-testid');
        if (dataTestId) {
          // This is a fallback - might not work but better than no URL
          url = `https://www.willhaben.at/listing/${dataTestId}`;
        }
      }
      
      console.log(`[URL DEBUG] Found URL: "${url}" from linkElement: ${!!linkElement}`);

      // Extract images
      const imageElements = await listing.$$('img');
      const images = await Promise.all(
        imageElements.map((img: any) => img.getAttribute('src'))
      );
      const validImages = images.filter(Boolean) as string[];

      // Extract description (might need to visit detail page)
      const description = await this.extractDescription(listing);

      if (!title || !price || !url) {
        console.log(`[EXTRACT DEBUG] Missing data - title: "${title}", price: ${price}, url: "${url}"`);
        return null;
      }
      
      console.log(`[EXTRACT SUCCESS] Found complete listing - title: "${title}", price: ${price}`);

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
    // Remove all non-digit characters except dots and commas
    const cleanText = priceText.replace(/[^\d.,]/g, '');
    
    // Look for price patterns
    const patterns = [
      /€\s*([\d.,]+)/,
      /([\d.,]+)\s*€/,
      /([\d]+(?:[.,]\d{3})*(?:[.,]\d{2})?)/
    ];
    
    for (const pattern of patterns) {
      const matches = priceText.match(pattern);
      if (matches) {
        const priceStr = matches[1].replace(/[.,]/g, '');
        const price = parseInt(priceStr);
        if (price > 1000) { // Reasonable price check
          return price;
        }
      }
    }
    
    // Fallback: try to extract any large number
    const numbers = cleanText.match(/\d{4,}/g);
    if (numbers) {
      return parseInt(numbers[0]);
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
