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
      // Process multiple pages for this category
      for (let currentPage = 1; currentPage <= options.maxPages; currentPage++) {
        const url = currentPage === 1 ? baseUrl : `${baseUrl}&page=${currentPage}`;
        options.onProgress(`[INFO] Seite ${currentPage}/${options.maxPages} für ${category}: ${url}`);
        
        await page.goto(url, { 
          waitUntil: 'domcontentloaded',
          timeout: 30000 
        });
        await page.waitForTimeout(options.delay);

        // Wait for page to load properly
        await page.waitForTimeout(2000);
        
        // Check if this page has content
        const pageHasContent = await page.evaluate(() => {
          return document.body.innerText.includes('€') && document.body.innerText.includes('m²');
        });
        
        if (!pageHasContent) {
          options.onProgress(`[WARN] Seite ${currentPage} hat keine Immobilien-Inhalte - möglicherweise Ende erreicht`);
          break;
        }
        
        // Debug: Check page content and structure
        const pageTitle = await page.title();
        options.onProgress(`[DEBUG] Seite geladen: ${pageTitle}`);
        
        // Focus on main listing containers based on successful patterns
        const possibleSelectors = [
          'article[data-testid*="search-result-entry-"]',   // Main Willhaben listing articles
          'article',                                        // Fallback for generic articles
          '.MuiCard-root:has(h1, h2, h3)',                 // Material-UI cards with content
          '[data-testid*="result"]:has(a)',                // Result elements with links
          '.search-result-entry',                          // Legacy selector
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
            
            // Pre-filter: Skip obviously non-listing elements
            const listingText = await listing.evaluate((el: Element) => el.textContent?.toLowerCase() || '');
            
            // Skip elements that are clearly sub-components or too small
            if (listingText.length < 50 || 
                !listingText.includes('€') || 
                !listingText.includes('m²') ||
                listingText.includes('show-results') ||
                listingText.includes('action-bar')) {
              continue;
            }
            
            // Check if it's a private listing
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
        
        // For simplicity, we'll continue through all requested pages
        // Real pagination checking would be more complex on Willhaben
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
      // Extract title with modern Willhaben structure understanding
      let title = '';
      
      // Modern Willhaben often uses specific patterns - try comprehensive approach
      const titleSelectors = [
        'a h3',
        'a h2', 
        'h3',
        'h2',
        'h1',
        '[data-testid*="title"]',
        'a[title]',
        '.MuiTypography-h6',
        '.MuiTypography-h5',
        'a span',
        '.title'
      ];
      
      for (const selector of titleSelectors) {
        const titleElement = await listing.$(selector);
        if (titleElement) {
          const text = await titleElement.textContent();
          if (text && text.trim() && text.length > 10) { // Must be substantial text
            title = text.trim();
            console.log(`[TITLE DEBUG] Found with selector "${selector}": "${title}"`);
            break;
          }
        }
      }
      
      // Fallback: get title from link attribute or longest text
      if (!title.trim()) {
        const linkElement = await listing.$('a');
        if (linkElement) {
          title = await linkElement.getAttribute('title') || '';
          if (!title.trim()) {
            // Get the longest text content from the link
            const linkText = await linkElement.textContent() || '';
            if (linkText.length > 15) {
              title = linkText.trim();
            }
          }
        }
      }
      
      console.log(`[TITLE FINAL] Extracted title: "${title}"`);

      // Extract price with better logic for modern Willhaben
      let priceText = '';
      const priceSelectors = [
        'strong:contains("€")',
        '.MuiTypography-body1:contains("€")', 
        '[data-testid*="price"]',
        'span:contains("€")',
        '.price',
        'div:contains("€")'
      ];
      
      // Since :contains() doesn't work in querySelector, we need a different approach
      const allElements = await listing.$$('*');
      for (const element of allElements) {
        const text = await element.textContent();
        if (text && text.includes('€') && text.match(/€\s*[\d.,]+/)) {
          priceText = text;
          console.log(`[PRICE DEBUG] Found price text: "${priceText}"`);
          break;
        }
      }
      
      const price = this.extractPrice(priceText);
      console.log(`[PRICE FINAL] Extracted price: ${price}`);

      // Extract location from all text - Willhaben typically shows location in listing text
      let location = '';
      
      // Look for Austrian postal codes and city names in the text
      const locationPatterns = [
        /(\d{4}\s+[a-züäöß\s]+)/gi,     // 1020 Wien, 2500 Baden etc
        /([a-züäöß\s]+,\s*\d+\.\s*bezirk)/gi,  // Wien, 02. Bezirk
        /([a-züäöß\s]+stadt)/gi,        // Leopoldstadt etc
      ];
      
      const allText = await listing.evaluate((el: Element) => el.textContent || '');
      for (const pattern of locationPatterns) {
        const matches = allText.match(pattern);
        if (matches && matches[0].length > 5) {
          location = matches[0].trim();
          console.log(`[LOCATION DEBUG] Found: "${location}"`);
          break;
        }
      }
      
      // Fallback: look for common Austrian cities
      if (!location) {
        const cities = ['wien', 'baden', 'mödling', 'wiener neustadt', 'st. pölten'];
        for (const city of cities) {
          if (allText.toLowerCase().includes(city)) {
            location = city;
            break;
          }
        }
      }
      
      console.log(`[LOCATION FINAL] Extracted: "${location}"`);

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
      const linkElements = await listing.$$('a');
      
      for (const linkElement of linkElements) {
        let href = await linkElement.getAttribute('href');
        if (href && href.includes('/iad/')) {
          url = href.startsWith('http') ? href : `https://www.willhaben.at${href}`;
          console.log(`[URL DEBUG] Found URL: "${url}"`);
          break;
        }
      }
      
      // If no URL found, try to get any link
      if (!url && linkElements.length > 0) {
        const href = await linkElements[0].getAttribute('href');
        if (href) {
          url = href.startsWith('http') ? href : `https://www.willhaben.at${href}`;
        }
      }
      
      console.log(`[URL FINAL] Final URL: "${url}", found ${linkElements.length} links`);

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
      
      console.log(`[EXTRACT SUCCESS] Complete listing - title: "${title}", price: ${price}, location: "${location}"`);

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
    if (!priceText) return 0;
    
    console.log(`[PRICE EXTRACT] Processing: "${priceText}"`);
    
    // Look for European price patterns (Austrian style)
    const patterns = [
      /€\s*([\d]+(?:[.,]\d{3})*)/,      // € 350.000 or € 350,000
      /([\d]+(?:[.,]\d{3})*)\s*€/,      // 350.000 € or 350,000 €
      /€\s*([\d]+)/,                    // € 350000
      /([\d]+)\s*€/,                    // 350000 €
      /([\d]+(?:[.,]\d{3})+)/           // 350.000 or 350,000
    ];
    
    for (const pattern of patterns) {
      const matches = priceText.match(pattern);
      if (matches) {
        // Clean the number: remove dots and commas used as thousand separators
        let priceStr = matches[1].replace(/[.,]/g, '');
        const price = parseInt(priceStr);
        
        // Sanity check: price should be reasonable for real estate
        if (price >= 10000 && price <= 50000000) {
          console.log(`[PRICE EXTRACT] Success: ${price} from "${matches[1]}"`);
          return price;
        }
      }
    }
    
    console.log(`[PRICE EXTRACT] Failed to extract from: "${priceText}"`);
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
