import axios, { AxiosInstance } from 'axios';
import * as cheerio from 'cheerio';

interface StealthScrapingOptions {
  category: string;
  maxPages: number;
  delay: number;
  onProgress: (message: string) => void;
}

interface ListingData {
  title: string;
  price: number;
  area: string | null;
  location: string;
  url: string;
  images: string[];
  description: string;
  phone_number: string | null;
  category: string;
  region: string;
  eur_per_m2: string | null;
  akquise_erledigt: boolean;
}

export class StealthScraperService {
  private axiosInstance: AxiosInstance;
  private sessionCookies: string = '';
  
  private userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15'
  ];

  private baseUrls: Record<string, string> = {
    'eigentumswohnung-wien': 'https://www.willhaben.at/iad/immobilien/eigentumswohnung/eigentumswohnung-angebote?areaId=900&areaId=903&rows=25&SELLER_TYPE=PRIVAT&sfId=24be9764-9795-47ba-8ddc-216aa619fd6d&isNavigation=true&keyword=privatverkauf',
    'eigentumswohnung-niederoesterreich': 'https://www.willhaben.at/iad/immobilien/eigentumswohnung/eigentumswohnung-angebote?areaId=904&rows=25&SELLER_TYPE=PRIVAT&sfId=24be9764-9795-47ba-8ddc-216aa619fd6d&isNavigation=true&keyword=privatverkauf',
    'grundstueck-wien': 'https://www.willhaben.at/iad/immobilien/grundstuecke/grundstueck-angebote?areaId=900&areaId=903&rows=25&SELLER_TYPE=PRIVAT&sfId=24be9764-9795-47ba-8ddc-216aa619fd6d&isNavigation=true&keyword=privatverkauf',
    'grundstueck-niederoesterreich': 'https://www.willhaben.at/iad/immobilien/grundstuecke/grundstueck-angebote?areaId=904&rows=25&SELLER_TYPE=PRIVAT&sfId=24be9764-9795-47ba-8ddc-216aa619fd6d&isNavigation=true&keyword=privatverkauf',
    'grundstuecke-wien': 'https://www.willhaben.at/iad/immobilien/grundstuecke/grundstueck-angebote?areaId=900&areaId=903&rows=25&SELLER_TYPE=PRIVAT&sfId=24be9764-9795-47ba-8ddc-216aa619fd6d&isNavigation=true&keyword=privatverkauf',
    'grundstuecke-niederoesterreich': 'https://www.willhaben.at/iad/immobilien/grundstuecke/grundstueck-angebote?areaId=904&rows=25&SELLER_TYPE=PRIVAT&sfId=24be9764-9795-47ba-8ddc-216aa619fd6d&isNavigation=true&keyword=privatverkauf'
  };

  constructor() {
    this.axiosInstance = axios.create({
      timeout: 30000,
      maxRedirects: 5,
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Upgrade-Insecure-Requests': '1'
      }
    });
  }

  private getRandomUserAgent(): string {
    return this.userAgents[Math.floor(Math.random() * this.userAgents.length)];
  }

  private async establishSession(onProgress: (msg: string) => void): Promise<void> {
    try {
      onProgress('🔐 Establishing session with Willhaben...');
      
      const response = await this.axiosInstance.get('https://www.willhaben.at', {
        headers: {
          'User-Agent': this.getRandomUserAgent()
        }
      });
      
      // Extract cookies
      const cookies = response.headers['set-cookie'];
      if (cookies) {
        this.sessionCookies = cookies.map(cookie => cookie.split(';')[0]).join('; ');
        onProgress('✅ Session established successfully');
      }
      
      // Random delay to simulate human browsing
      await new Promise(resolve => setTimeout(resolve, 2000 + Math.random() * 3000));
      
    } catch (error) {
      onProgress('⚠️ Session establishment failed, continuing anyway...');
    }
  }

  // STEALTH DOPPELMARKLER-SCAN mit Session-Management
  async stealthDoppelmarklerScan(options: StealthScrapingOptions): Promise<void> {
    const { category, maxPages, delay, onProgress } = options;
    
    onProgress(`🥷 STEALTH DOPPELMARKLER-SCAN: ${category}`);
    
    // Establish session first
    await this.establishSession(onProgress);
    
    const detailUrls: string[] = [];
    let successfulPages = 0;

    // SCHRITT 1: Sammle URLs mit Stealth-Techniken
    for (let page = 1; page <= maxPages && successfulPages < maxPages; page++) {
      try {
        onProgress(`🔍 Stealth-Load Seite ${page}/${maxPages}`);
        
        const pageUrls = await this.getPageUrlsStealth(category, page, onProgress);
        if (pageUrls.length > 0) {
          detailUrls.push(...pageUrls);
          successfulPages++;
          onProgress(`✅ Seite ${page}: ${pageUrls.length} URLs (Total: ${detailUrls.length})`);
        } else {
          onProgress(`⚠️ Seite ${page}: Keine URLs - möglicherweise Ende erreicht`);
        }
        
        // Human-like variable delay
        if (page < maxPages) {
          const humanDelay = delay + Math.random() * 5000; // Add randomness
          onProgress(`⏰ Human-like pause: ${Math.round(humanDelay/1000)}s`);
          await new Promise(resolve => setTimeout(resolve, humanDelay));
          
          // Occasionally refresh session
          if (page % 3 === 0) {
            await this.refreshSession(onProgress);
          }
        }
        
      } catch (error: any) {
        onProgress(`❌ Stealth-Error Seite ${page}: ${error.message}`);
        
        if (error.response?.status === 429) {
          onProgress(`🚫 Rate limit detected - switching to ultra-stealth mode`);
          await this.ultraStealthPause(onProgress);
        } else {
          // Normal error delay
          const errorDelay = delay * 2 + Math.random() * 10000;
          onProgress(`⏰ Error recovery: ${Math.round(errorDelay/1000)}s`);
          await new Promise(resolve => setTimeout(resolve, errorDelay));
        }
      }
    }

    // SCHRITT 2: Stealth Doppelmarkler-Check
    onProgress(`🎯 STEALTH DOPPELMARKLER-SCAN: ${detailUrls.length} URLs`);
    
    let doppelmarklerFound = 0;
    let processed = 0;
    
    for (const url of detailUrls) {
      processed++;
      onProgress(`🕵️ Stealth-Check (${processed}/${detailUrls.length})`);
      
      try {
        const result = await this.checkForDoppelmarklerStealth(url, category, onProgress);
        if (result) {
          // SAVE TO DATABASE!
          try {
            const { db } = await import('../db.js');
            const { listings } = await import('@shared/schema');
            
            // Fix area type conversion (schema expects string, we have number)
            const listingData = {
              ...result,
              area: result.area ? result.area.toString() : null,
              eur_per_m2: result.eur_per_m2 ? result.eur_per_m2.toString() : null
            };
            
            // Direct database insert with type conversion
            const [savedListing] = await db.insert(listings).values(listingData).returning();
            doppelmarklerFound++;
            onProgress(`💾 GESPEICHERT: ${result.title} - €${result.price}`);
          } catch (saveError) {
            onProgress(`❌ SAVE ERROR: ${saveError}`);
          }
        }
        
        // Human-like delay between checks
        if (processed < detailUrls.length) {
          const checkDelay = delay + Math.random() * 3000;
          await new Promise(resolve => setTimeout(resolve, checkDelay));
        }
        
      } catch (error) {
        onProgress(`❌ Detail-Check Error: ${error}`);
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }

    onProgress(`🏆 STEALTH SCAN COMPLETE: ${doppelmarklerFound} Doppelmarkler gefunden!`);
  }

  private async refreshSession(onProgress: (msg: string) => void): Promise<void> {
    onProgress('🔄 Refreshing session...');
    await this.establishSession(onProgress);
  }

  private async ultraStealthPause(onProgress: (msg: string) => void): Promise<void> {
    const ultraDelay = 10000 + Math.random() * 5000; // Nur 10-15 Sekunden statt 60-90
    onProgress(`🛡️ Optimized pause: ${Math.round(ultraDelay/1000)}s (getestet!)`);
    await new Promise(resolve => setTimeout(resolve, ultraDelay));
    
    // Refresh session after pause
    await this.refreshSession(onProgress);
  }

  private async getPageUrlsStealth(category: string, page: number, onProgress: (msg: string) => void): Promise<string[]> {
    const baseUrl = this.baseUrls[category];
    if (!baseUrl) {
      throw new Error(`Unknown category: ${category}`);
    }
    
    const url = `${baseUrl}&page=${page}`;
    
    // Rotate headers for each request
    const headers = {
      'User-Agent': this.getRandomUserAgent(),
      'Referer': page > 1 ? `${baseUrl}&page=${page-1}` : 'https://www.willhaben.at/',
      'Cookie': this.sessionCookies,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
      'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8',
      'Cache-Control': Math.random() > 0.5 ? 'no-cache' : 'max-age=0',
      'Sec-Ch-Ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
      'Sec-Ch-Ua-Mobile': '?0',
      'Sec-Ch-Ua-Platform': '"Windows"',
      'DNT': '1'
    };

    const response = await this.axiosInstance.get(url, { headers });

    // Update cookies if new ones are received
    const newCookies = response.headers['set-cookie'];
    if (newCookies) {
      this.sessionCookies = newCookies.map(cookie => cookie.split(';')[0]).join('; ');
    }

    const $ = cheerio.load(response.data);
    const urls: string[] = [];

    // DEBUG: Check raw HTML content
    const rawHtml = response.data;
    const directMatches = rawHtml.match(/\/iad\/immobilien\/d\/[^"'\s>]*/g);
    onProgress(`🔍 RAW HTML: ${directMatches ? directMatches.length : 0} direct URL matches found`);

    // Method 1: Direct regex on raw HTML (most reliable)
    if (directMatches) {
      directMatches.forEach((match: string) => {
        const fullUrl = `https://www.willhaben.at${match}`;
        urls.push(fullUrl);
      });
    }

    // Method 2: Cheerio parsing als backup
    $('a').each((_, element) => {
      const href = $(element).attr('href');
      if (href && href.includes('/iad/immobilien/d/')) {
        const fullUrl = href.startsWith('http') ? href : `https://www.willhaben.at${href}`;
        urls.push(fullUrl);
      }
    });

    // Method 3: Look for onclick handlers or data attributes
    $('[onclick*="/iad/immobilien/d/"], [data-href*="/iad/immobilien/d/"]').each((_, element) => {
      const onclick = $(element).attr('onclick') || '';
      const dataHref = $(element).attr('data-href') || '';
      
      const urlMatch = (onclick + dataHref).match(/\/iad\/immobilien\/d\/[^"'\s)]*/);
      if (urlMatch) {
        const fullUrl = `https://www.willhaben.at${urlMatch[0]}`;
        urls.push(fullUrl);
      }
    });

    return Array.from(new Set(urls)); // Remove duplicates
  }

  private async checkForDoppelmarklerStealth(url: string, category: string, onProgress: (msg: string) => void): Promise<ListingData | null> {
    try {
      const headers = {
        'User-Agent': this.getRandomUserAgent(),
        'Referer': 'https://www.willhaben.at/iad/immobilien/',
        'Cookie': this.sessionCookies,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8',
        'Cache-Control': 'no-cache'
      };

      const response = await this.axiosInstance.get(url, { headers });

      const $ = cheerio.load(response.data);
      const bodyText = $('body').text().toLowerCase();
      const description = this.extractDetailDescription($);
      const title = this.extractTitle($);

      // STRENGE Makler-Detection - diese Begriffe = MAKLER/BAUTRÄGER
      const commercialKeywords = [
        'neubauprojekt',
        'erstbezug',
        'bauträger', 
        'anleger',
        'wohnprojekt',
        'immobilienmakler',
        'provisionsaufschlag',
        'fertigstellung',
        'projektentwicklung',
        'immobilienvertrieb',
        'besichtigungstermin',
        'immobilienbüro'
      ];

      const foundCommercial = commercialKeywords.find(keyword => 
        bodyText.includes(keyword.toLowerCase()) || 
        description.toLowerCase().includes(keyword.toLowerCase()) ||
        title.toLowerCase().includes(keyword.toLowerCase())
      );

      if (foundCommercial) {
        onProgress(`🏢 MAKLER DETECTED: "${foundCommercial}" - SKIP`);
        return null;
      }

      // Enhanced private detection - NUR echte private Verkäufer
      const privateKeywords = [
        'privatverkauf',
        'privat verkauf', 
        'von privat',
        'privater verkäufer',
        'privater anbieter',
        'ohne makler',
        'verkaufe privat',
        'privat zu verkaufen',
        'eigenheim verkauf',
        'private anzeige'
      ];

      const foundPrivate = privateKeywords.find(keyword => 
        bodyText.includes(keyword.toLowerCase()) || 
        description.toLowerCase().includes(keyword.toLowerCase())
      );
      
      if (foundPrivate) {
        const privateReason = foundPrivate;
        onProgress(`💎 PRIVATE HIT: "${privateReason}"`);
        
        const price = this.extractPrice($);
        const areaString = this.extractArea($);
        const area = areaString ? parseInt(areaString) : 0;
        const location = this.extractLocation($) || this.getLocationFromUrl(url);
        const phoneNumber = this.extractPhoneNumber(bodyText + ' ' + description);
        
        // Nur speichern wenn Preis verfügbar
        if (price > 0) {
          const region = category.includes('wien') ? 'wien' : 'niederoesterreich';
          const listingCategory = category.includes('eigentumswohnung') ? 'eigentumswohnung' : 'grundstueck';
          const eur_per_m2 = area > 0 ? Math.round(price / area) : 0;

          const images = this.extractImages($);
          
          const listingData = {
            title,
            price,
            area: areaString || null,
            location,
            url,
            images,
            description,
            phone_number: phoneNumber,
            category: listingCategory,
            region,
            eur_per_m2: area > 0 ? Math.round(price / area).toString() : null,
            akquise_erledigt: false
          };

          // FINAL PRICE CHECK - avoid database integer overflow
        const finalPrice = price < 999999 ? price : parseInt(price.toString().substring(0, 6));
        
        const finalListingData = {
          ...listingData,
          price: finalPrice,
          eur_per_m2: area > 0 ? Math.round(finalPrice / parseInt(area.toString())).toString() : null
        };
        
        onProgress(`🔧 DEBUG: Preis=${finalPrice}, Area=${area}, Title="${title}"`);
        onProgress(`💾 GESPEICHERT: ${title}`);
        return finalListingData;
        } else {
          onProgress(`❌ SKIP: Kein Preis gefunden (${price}) für ${title || url}`);
        }
      }

      return null;

    } catch (error) {
      console.error(`STEALTH CHECK ERROR for ${url}:`, error);
      return null;
    }
  }

  private extractDetailDescription($: cheerio.CheerioAPI): string {
    // Method 1: Look for Willhaben-specific description sections
    const descriptionSelectors = [
      'h2:contains("Objektbeschreibung")',  // "Objektbeschreibung" header
      'div:contains("Objektbeschreibung")',
      '[data-testid="ad-detail-ad-description"]',
      '.AdDescription-description',
      '[data-testid="object-description-text"]'
    ];

    for (const selector of descriptionSelectors) {
      const element = $(selector);
      if (element.length > 0) {
        // Get text from the element and its following siblings
        let description = '';
        
        if (selector.includes('Objektbeschreibung')) {
          // If we found the "Objektbeschreibung" header, get the next paragraph(s)
          const nextElements = element.nextAll('p, div').first();
          if (nextElements.length > 0) {
            description = nextElements.text().trim();
          }
        } else {
          description = element.text().trim();
        }
        
        if (description && description.length > 20) { // Must be substantial
          return description.substring(0, 1000); // Limit length
        }
      }
    }

    // Method 2: Search for description text patterns in body
    const bodyText = $('body').text();
    const descriptionPatterns = [
      /Objektbeschreibung\s*([\s\S]{30,2000})(?:Mehr anzeigen|Energieausweis|Kontakt|Kreditrechner|Anbieterdetails)/i,
      /Beschreibung\s*([\s\S]{30,2000})(?:Mehr anzeigen|Energieausweis|Kontakt|Kreditrechner|Anbieterdetails)/i
    ];

    for (const pattern of descriptionPatterns) {
      const match = bodyText.match(pattern);
      if (match && match[1]) {
        let description = match[1].trim();
        // Clean up common artifacts
        description = description.replace(/\s+/g, ' '); // Normalize spaces
        description = description.replace(/\n+/g, ' '); // Remove line breaks
        return description.substring(0, 1000);
      }
    }

    // Method 3: Search for long paragraphs that might be descriptions
    const paragraphs = $('p').toArray();
    for (const p of paragraphs) {
      const text = $(p).text().trim();
      if (text.length > 100 && 
          text.includes('Wohnung') && 
          (text.includes('verkauf') || text.includes('privat'))) {
        return text.substring(0, 1000);
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

    return 'Unknown Title';
  }

  private extractPrice($: cheerio.CheerioAPI): number {
    // Method 1: Look for Willhaben-specific price displays (from real HTML structure)
    const priceSelectors = [
      'span:contains("€")',  // Direct span containing €
      'div:contains("Kaufpreis")',  // Kaufpreis section
      '[class*="price"]',
      '[data-testid*="price"]'
    ];

    for (const selector of priceSelectors) {
      const elements = $(selector);
      let result = 0;
      elements.each((_, element) => {
        const text = $(element).text();
        // Look for "€ 379.000" or "Kaufpreis€ 379.000" format
        const priceMatch = text.match(/€\s*(\d{1,3})\.(\d{3})/);
        if (priceMatch) {
          const price = parseInt(priceMatch[1] + priceMatch[2]);
          if (price >= 50000 && price <= 999999) {
            result = price;
            return false; // Break out of each loop
          }
        }
      });
      if (result > 0) return result;
    }

    // Method 2: Enhanced search in body text for specific Willhaben patterns
    const bodyText = $('body').text();
    
    // Willhaben-specific price patterns based on real content
    const pricePatterns = [
      /Kaufpreis€\s*(\d{1,3})\.(\d{3})/gi,  // "Kaufpreis€ 379.000"
      /€\s*(\d{1,3})\.(\d{3})/gi,           // "€ 379.000"
      /(\d{1,3})\.(\d{3})\s*€/gi,           // "379.000 €"
      /preis[:\s]*€?\s*(\d{1,3})\.(\d{3})/gi  // "Preis: € 379.000"
    ];
    
    for (const pattern of pricePatterns) {
      const matches = bodyText.match(pattern);
      if (matches) {
        for (const match of matches) {
          // Extract price from format like "379.000"
          const digits = match.replace(/[^\d]/g, '');
          if (digits.length >= 5) { // At least 5 digits for realistic price
            const price = parseInt(digits);
            // Realistic Austrian property price range
            if (price >= 50000 && price <= 999999) {
              return price;
            }
          }
        }
      }
    }

    return 0;
  }

  private extractArea($: cheerio.CheerioAPI): string {
    // Method 1: Look for Willhaben-specific area display (from real HTML structure)
    const areaSelectors = [
      'span:contains("m²")',  // Direct span containing m²
      'div:contains("Wohnfläche")',  // Wohnfläche section
      '[class*="area"]',
      '[class*="size"]'
    ];

    for (const selector of areaSelectors) {
      const elements = $(selector);
      let result = '';
      elements.each((_, element) => {
        const text = $(element).text();
        const areaMatch = text.match(/(\d{1,4})\s*m²/i);
        if (areaMatch) {
          const area = parseInt(areaMatch[1]);
          if (area >= 15 && area <= 500) { // Realistic apartment sizes
            result = area.toString();
            return false; // Break out of each loop
          }
        }
      });
      if (result) return result;
    }

    // Method 2: Search in complete body text for area patterns
    const bodyText = $('body').text();
    
    // Enhanced patterns based on real Willhaben content
    const areaPatterns = [
      /(\d{1,3})\s*m²/gi,  // "43 m²" format
      /wohnfläche[:\s]*(\d{1,3})\s*m²/gi,  // "Wohnfläche: 43 m²"
      /(\d{1,3})\s*qm/gi,  // "43 qm" format
      /fläche[:\s]*(\d{1,3})/gi,  // "Fläche: 43"
      /(\d{1,3})\s*quadratmeter/gi
    ];
    
    for (const pattern of areaPatterns) {
      const matches = bodyText.match(pattern);
      if (matches) {
        for (const match of matches) {
          const areaMatch = match.match(/(\d{1,3})/);
          if (areaMatch) {
            const area = parseInt(areaMatch[1]);
            if (area >= 15 && area <= 500) { // Realistic apartment sizes
              return area.toString();
            }
          }
        }
      }
    }

    return '';
  }

  private extractLocation($: cheerio.CheerioAPI): string {
    // Method 1: Look for "Objektstandort" section (from real Willhaben structure)
    const locationSelectors = [
      'h2:contains("Objektstandort")',
      'div:contains("Objektstandort")',
      '[data-testid="ad-detail-ad-location"]',
      '.AdDetailLocation'
    ];

    for (const selector of locationSelectors) {
      const element = $(selector);
      if (element.length > 0) {
        if (selector.includes('Objektstandort')) {
          // Get the next element after "Objektstandort" header
          const nextElement = element.next();
          if (nextElement.length > 0) {
            const location = nextElement.text().trim();
            if (location && location.length > 5) {
              return location;
            }
          }
        } else {
          const location = element.text().trim();
          if (location && location.length > 5) {
            return location;
          }
        }
      }
    }

    // Method 2: Extract location from URL path (more reliable)
    const url = $.html(); // Get the current URL context
    const urlLocationMatch = url.match(/wien-(\d{4})-([^\/]+)/i);
    if (urlLocationMatch) {
      const postalCode = urlLocationMatch[1];
      const district = urlLocationMatch[2].replace(/-/g, ' ');
      return `${postalCode} Wien, ${district}`;
    }

    // Method 3: Search for Vienna district patterns in body text  
    const bodyText = $('body').text();
    const locationPatterns = [
      /(\d{4}\s+Wien,\s+\d{2}\.\s+Bezirk[^,]*)/gi,  // "1070 Wien, 07. Bezirk, Neubau"
      /(Wien,\s+\d{2}\.\s+Bezirk[^,\n]*)/gi,        // "Wien, 07. Bezirk, Neubau"
      /(\d{4}\s+Wien[^,\n]*)/gi,                    // "1070 Wien"
      /([A-Z][a-z]+gasse[^,\n]*)/gi,                // Street names ending in "gasse"
      /([A-Z][a-z]+straße[^,\n]*)/gi,               // Street names ending in "straße"
      /([A-Z][a-z]+platz[^,\n]*)/gi                 // Square names ending in "platz"
    ];

    for (const pattern of locationPatterns) {
      const matches = bodyText.match(pattern);
      if (matches && matches.length > 0) {
        const location = matches[0].trim();
        if (location.includes('Wien') || 
            location.includes('gasse') || 
            location.includes('straße') || 
            location.includes('platz')) {
          return location.substring(0, 100); // Limit length
        }
      }
    }

    return 'Wien'; // Default fallback for Vienna listings
  }

  private extractImages($: cheerio.CheerioAPI): string[] {
    const images: string[] = [];
    
    // Method 1: Find all Willhaben cache images (exclude thumbnails immediately)
    $('img[src*="cache.willhaben.at"]').each((_, element) => {
      const src = $(element).attr('src');
      if (src && !src.includes('_thumb') && !images.includes(src)) {
        images.push(src);
      }
    });

    // Method 2: Extract from HTML source for high-quality images
    const htmlSource = $.html();
    const fullSizeMatches = htmlSource.match(/https:\/\/cache\.willhaben\.at\/mmo\/[^"'\s]+\.jpg/gi);
    if (fullSizeMatches) {
      fullSizeMatches.forEach(url => {
        // Only add if it's NOT a thumbnail and not already included
        if (!url.includes('_thumb') && !images.includes(url)) {
          images.push(url);
        }
      });
    }

    // Method 3: Convert any remaining thumbnails to full-size
    const thumbnailImages: string[] = [];
    $('img[src*="_thumb.jpg"]').each((_, element) => {
      const src = $(element).attr('src');
      if (src) {
        const fullSizeUrl = src.replace('_thumb.jpg', '.jpg');
        if (!images.includes(fullSizeUrl)) {
          thumbnailImages.push(fullSizeUrl);
        }
      }
    });
    
    // Add converted full-size images
    images.push(...thumbnailImages);

    return images.slice(0, 15); // Limit to 15 images like Willhaben shows
  }

  private extractPhoneNumber(text: string): string | null {
    // ERWEITERTE FAKE-NUMMER FILTERUNG: Mehr bekannte problematische Nummern
    const fakeNumbers = [
      '01520253035', '1520253035', '0152025303',
      '0800000000', '123456789', '1234567890',
      '0000000000', '1111111111', '9999999999',
      '0123456789', '123123123'
    ];
    
    for (const fake of fakeNumbers) {
      if (text.includes(fake)) {
        console.log(`🚫 FAKE NUMBER BLOCKED: ${fake}`);
        return null;
      }
    }

    // Look for explicit phone number contexts first
    const phoneContexts = [
      /(?:telefon|tel|phone|handy|mobil|kontakt|erreichbar)[:\s]*([+\d\s\-()\/]{8,20})/gi,
      /(?:anrufen|call|rufen)[:\s]*([+\d\s\-()\/]{8,20})/gi,
      /(?:nummer|number)[:\s]*([+\d\s\-()\/]{8,20})/gi
    ];

    for (const pattern of phoneContexts) {
      const matches = text.match(pattern);
      if (matches && matches[1]) {
        const cleanNumber = matches[1].replace(/[\s\-()\/]/g, '');
        
        // Skip if it contains fake numbers
        if (fakeNumbers.some(fake => cleanNumber.includes(fake))) {
          console.log(`🚫 CONTEXT FAKE BLOCKED: ${cleanNumber}`);
          continue;
        }
        
        if (this.isValidAustrianPhone(cleanNumber)) {
          console.log(`📞 CONTEXT PHONE FOUND: ${cleanNumber}`);
          return this.formatPhoneNumber(cleanNumber);
        }
      }
    }

    // Specific Austrian phone patterns - more restrictive
    const austrianPatterns = [
      /(\+43|0043)[\s\-]?[1-9]\d{2,4}[\s\-]?\d{4,8}/g,  // International format
      /0[1-9]\d{2,4}[\s\-]?\d{4,8}/g,  // National format starting with area code
      /066[4-9]\d{7}/g,  // Mobile numbers 0664-0669
      /067[0-7]\d{7}/g,  // Mobile numbers 0670-0677
      /068[0-9]\d{7}/g   // Mobile numbers 0680-0689
    ];

    for (const pattern of austrianPatterns) {
      const matches = text.match(pattern);
      if (matches && matches.length > 0) {
        const cleanNumber = matches[0].replace(/[\s\-]/g, '');
        
        // Skip fake numbers in pattern matches too
        if (fakeNumbers.some(fake => cleanNumber.includes(fake))) {
          console.log(`🚫 PATTERN FAKE BLOCKED: ${cleanNumber}`);
          continue;
        }
        
        if (this.isValidAustrianPhone(cleanNumber)) {
          console.log(`📞 PATTERN PHONE FOUND: ${cleanNumber}`);
          return this.formatPhoneNumber(cleanNumber);
        }
      }
    }

    console.log(`📞 NO VALID PHONE in: ${text.substring(0, 80)}...`);
    return null;
  }

  private formatPhoneNumber(phone: string): string {
    // Format Austrian phone numbers nicely
    if (phone.startsWith('43')) {
      return `+${phone}`;
    } else if (phone.startsWith('0')) {
      return phone;
    }
    return `0${phone}`;
  }

  private isValidAustrianPhone(phone: string): boolean {
    // Remove any remaining spaces or special chars
    const clean = phone.replace(/[^\d+]/g, '');
    
    // CRITICAL: Block known fake numbers at validation level too
    const fakeNumbers = ['01520253035', '1520253035', '0152025303'];
    if (fakeNumbers.some(fake => clean.includes(fake))) {
      console.log(`🚫 VALIDATION FAKE BLOCKED: ${clean}`);
      return false;
    }
    
    // Must be 8-14 digits (realistic Austrian phone length)
    if (clean.length < 8 || clean.length > 14) return false;
    
    // Must not be obviously fake (like sequential numbers, all same digits)
    if (/^(\d)\1{6,}$/.test(clean)) return false; // All same digits
    if (/^(0123456789|1234567890)/.test(clean)) return false; // Sequential
    if (/^(1111111|2222222|3333333)/.test(clean)) return false; // Repeated patterns
    
    // Austrian phone number validation
    if (clean.startsWith('+43')) return clean.length >= 11;
    if (clean.startsWith('0043')) return clean.length >= 14;
    if (clean.startsWith('0')) return clean.length >= 8;
    if (clean.startsWith('66') || clean.startsWith('67') || clean.startsWith('68')) return clean.length >= 10;
    
    return clean.length >= 8 && clean.length <= 12;
  }

  private getLocationFromUrl(url: string): string {
    // Extract location info from Willhaben URL structure
    const urlPatterns = [
      /wien-(\d{4})-([^\/]+)/i,  // wien-1070-neubau
      /wien\/([^\/]+)/i,         // wien/bezirk-name
      /niederoesterreich\/([^\/]+)/i  // niederoesterreich/region
    ];

    for (const pattern of urlPatterns) {
      const match = url.match(pattern);
      if (match) {
        if (match[1] && match[2]) {
          // Format: "1070 Wien, Neubau"
          const postalCode = match[1];
          const district = match[2].replace(/-/g, ' ').replace(/wien /gi, '');
          return `${postalCode} Wien, ${district}`;
        } else if (match[1]) {
          // Format: "Wien, Bezirk"
          const location = match[1].replace(/-/g, ' ').replace(/wien /gi, '');
          return `Wien, ${location}`;
        }
      }
    }

    return 'Wien'; // Default fallback
  }
}