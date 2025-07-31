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
    'eigentumswohnung-wien': 'https://www.willhaben.at/iad/immobilien/eigentumswohnung/eigentumswohnung-angebote?areaId=900&areaId=903&rows=25&SELLER_TYPE=PRIVAT&keyword=privatverkauf',
    'eigentumswohnung-niederoesterreich': 'https://www.willhaben.at/iad/immobilien/eigentumswohnung/eigentumswohnung-angebote?areaId=904&rows=25&SELLER_TYPE=PRIVAT&keyword=privatverkauf',
    'grundstueck-wien': 'https://www.willhaben.at/iad/immobilien/grundstuecke/grundstueck-angebote?areaId=900&areaId=903&rows=25&SELLER_TYPE=PRIVAT&keyword=privatverkauf',
    'grundstueck-niederoesterreich': 'https://www.willhaben.at/iad/immobilien/grundstuecke/grundstueck-angebote?areaId=904&rows=25&SELLER_TYPE=PRIVAT&keyword=privatverkauf',
    'grundstuecke-wien': 'https://www.willhaben.at/iad/immobilien/grundstuecke/grundstueck-angebote?areaId=900&areaId=903&rows=25&SELLER_TYPE=PRIVAT&keyword=privatverkauf',
    'grundstuecke-niederoesterreich': 'https://www.willhaben.at/iad/immobilien/grundstuecke/grundstueck-angebote?areaId=904&rows=25&SELLER_TYPE=PRIVAT&keyword=privatverkauf'
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
        const area = this.extractArea($);
        const location = this.extractLocation($);
        const phoneNumber = this.extractPhoneNumber(bodyText);
        
        // Nur speichern wenn Preis verfügbar
        if (price > 0) {
          const region = category.includes('wien') ? 'wien' : 'niederoesterreich';
          const listingCategory = category.includes('eigentumswohnung') ? 'eigentumswohnung' : 'grundstueck';
          const eur_per_m2 = area > 0 ? Math.round(price / area) : 0;

          const listingData = {
            title,
            price,
            area: area > 0 ? area.toString() : null,
            location,
            url,
            images: [],
            description,
            phone_number: phoneNumber,
            category: listingCategory,
            region,
            eur_per_m2: eur_per_m2 > 0 ? eur_per_m2.toString() : null,
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

    return 'Unknown Title';
  }

  private extractPrice($: cheerio.CheerioAPI): number {
    // Method 1: Search for realistic price patterns in body text
    const bodyText = $('body').text();
    
    // Look for price patterns like "€ 199.000" or "€199.000"
    const pricePatterns = [
      /€\s*(\d{2,3})\.(\d{3})/g,  // €199.000 format
      /€\s*(\d{3,7})[^\d]/g,      // €199000 format  
      /(\d{2,3})\.(\d{3})\s*€/g,  // 199.000 € format
      /(\d{3,7})\s*€/g            // 199000 € format
    ];
    
    for (const pattern of pricePatterns) {
      const matches = bodyText.match(pattern);
      if (matches) {
        for (const match of matches) {
          // Extract only digits and take max 6 digits to avoid huge numbers
          const digits = match.replace(/[^\d]/g, '').substring(0, 6);
          const price = parseInt(digits);
          
          // Realistic Austrian property price range
          if (price >= 50000 && price <= 999999) {
            return price;
          }
        }
      }
    }
    
    // Method 2: Look in specific price selectors
    const selectors = [
      '[data-testid="ad-detail-ad-price"]',
      '.AdDetailPrice',
      '.price-value',
      '[class*="price"]'
    ];

    for (const selector of selectors) {
      const element = $(selector);
      if (element.length > 0) {
        const text = element.text();
        const digits = text.replace(/[^\d]/g, '').substring(0, 6);
        const price = parseInt(digits);
        if (price >= 50000 && price <= 999999) return price;
      }
    }

    return 0;
  }

  private extractArea($: cheerio.CheerioAPI): number {
    const selectors = [
      '[data-testid="ad-detail-ad-properties"]',
      '.AdDetailProperties',
      '.property-info'
    ];

    for (const selector of selectors) {
      const element = $(selector);
      const text = element.text();
      const areaMatch = text.match(/(\d+)[\s]*m²/i);
      if (areaMatch) {
        return parseInt(areaMatch[1]);
      }
    }

    return 0;
  }

  private extractLocation($: cheerio.CheerioAPI): string {
    const selectors = [
      '[data-testid="ad-detail-ad-location"]',
      '.AdDetailLocation',
      '.location-info'
    ];

    for (const selector of selectors) {
      const element = $(selector);
      if (element.length > 0) {
        return element.text().trim();
      }
    }

    return 'Unknown Location';
  }

  private extractPhoneNumber(text: string): string | null {
    const phonePatterns = [
      /(\+43|0043)[\s\-]?[1-9]\d{1,4}[\s\-]?\d{3,8}/g,
      /0[1-9]\d{1,4}[\s\-]?\d{3,8}/g,
      /[1-9]\d{1,4}[\s\-]?\d{3,8}/g
    ];

    for (const pattern of phonePatterns) {
      const matches = text.match(pattern);
      if (matches && matches.length > 0) {
        return matches[0].replace(/[\s\-]/g, '');
      }
    }

    return null;
  }
}