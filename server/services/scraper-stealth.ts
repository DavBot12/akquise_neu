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
    'eigentumswohnung-wien': 'https://www.willhaben.at/iad/immobilien/eigentumswohnung/eigentumswohnung-angebote?areaId=900&areaId=903&rows=25&SELLER_TYPE=PRIVATE&keyword=Privatverkauf',
    'eigentumswohnung-niederoesterreich': 'https://www.willhaben.at/iad/immobilien/eigentumswohnung/eigentumswohnung-angebote?areaId=904&rows=25&SELLER_TYPE=PRIVATE&keyword=Privatverkauf',
    'grundstueck-wien': 'https://www.willhaben.at/iad/immobilien/grundstueck/grundstueck-angebote?areaId=900&areaId=903&rows=25&SELLER_TYPE=PRIVATE&keyword=Privatverkauf',
    'grundstueck-niederoesterreich': 'https://www.willhaben.at/iad/immobilien/grundstueck/grundstueck-angebote?areaId=904&rows=25&SELLER_TYPE=PRIVATE&keyword=Privatverkauf',
    'grundstuecke-wien': 'https://www.willhaben.at/iad/immobilien/grundstueck/grundstueck-angebote?areaId=900&areaId=903&rows=25&SELLER_TYPE=PRIVATE&keyword=Privatverkauf',
    'grundstuecke-niederoesterreich': 'https://www.willhaben.at/iad/immobilien/grundstueck/grundstueck-angebote?areaId=904&rows=25&SELLER_TYPE=PRIVATE&keyword=Privatverkauf'
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
          doppelmarklerFound++;
          onProgress(`💎 STEALTH DOPPELMARKLER: ${result.title} - €${result.price}`);
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

    // Extract listing URLs with multiple selectors
    const selectors = [
      'a[href*="/iad/immobilien/d/"]',
      'a[data-testid*="result-item"]',
      '.result-item a',
      '[data-testid="search-result-item"] a'
    ];

    selectors.forEach(selector => {
      $(selector).each((_, element) => {
        const href = $(element).attr('href');
        if (href && href.includes('/iad/immobilien/d/')) {
          const fullUrl = href.startsWith('http') ? href : `https://www.willhaben.at${href}`;
          urls.push(fullUrl);
        }
      });
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

      // Doppelmarkler keywords
      const doppelmarklerKeywords = [
        'doppelmarkler',
        'dopplermarklertätigkeit',
        'doppelmaklertätigkeit'
      ];

      const foundDoppelmarkler = doppelmarklerKeywords.find(keyword => 
        bodyText.includes(keyword.toLowerCase()) || 
        description.toLowerCase().includes(keyword.toLowerCase())
      );

      if (foundDoppelmarkler) {
        onProgress(`🎯 STEALTH HIT: "${foundDoppelmarkler}"`);
        
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
    const selectors = [
      '[data-testid="ad-detail-ad-price"] span',
      '.AdDetailPrice',
      '.price-value',
      '.AdPrice'
    ];

    for (const selector of selectors) {
      const element = $(selector);
      if (element.length > 0) {
        const priceText = element.text().replace(/[^\d]/g, '');
        const price = parseInt(priceText);
        if (price > 0) return price;
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