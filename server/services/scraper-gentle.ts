import axios from 'axios';
import * as cheerio from 'cheerio';
// Import types from existing files
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

interface GentleScrapingOptions {
  category: string;
  maxPages: number;
  delay: number;
  onProgress: (message: string) => void;
}

export class GentleScraperService {
  private userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0'
  ];

  private baseUrls: Record<string, string> = {
    'eigentumswohnung-wien': 'https://www.willhaben.at/iad/immobilien/eigentumswohnung/eigentumswohnung-angebote?sfId=f81bdc8f-08a7-4f66-8e9a-6bd19b0c23ae&isNavigation=true&areaId=900&areaId=903&rows=25',
    'eigentumswohnung-niederoesterreich': 'https://www.willhaben.at/iad/immobilien/eigentumswohnung/eigentumswohnung-angebote?sfId=f81bdc8f-08a7-4f66-8e9a-6bd19b0c23ae&isNavigation=true&areaId=904&rows=25',
    'grundstueck-wien': 'https://www.willhaben.at/iad/immobilien/grundstueck/grundstueck-angebote?sfId=f81bdc8f-08a7-4f66-8e9a-6bd19b0c23ae&isNavigation=true&areaId=900&areaId=903&rows=25',
    'grundstueck-niederoesterreich': 'https://www.willhaben.at/iad/immobilien/grundstueck/grundstueck-angebote?sfId=f81bdc8f-08a7-4f66-8e9a-6bd19b0c23ae&isNavigation=true&areaId=904&rows=25',
    'grundstuecke-wien': 'https://www.willhaben.at/iad/immobilien/grundstueck/grundstueck-angebote?sfId=f81bdc8f-08a7-4f66-8e9a-6bd19b0c23ae&isNavigation=true&areaId=900&areaId=903&rows=25',
    'grundstuecke-niederoesterreich': 'https://www.willhaben.at/iad/immobilien/grundstueck/grundstueck-angebote?sfId=f81bdc8f-08a7-4f66-8e9a-6bd19b0c23ae&isNavigation=true&areaId=904&rows=25'
  };

  private getRandomUserAgent(): string {
    return this.userAgents[Math.floor(Math.random() * this.userAgents.length)];
  }

  // SANFTER DOPPELMARKLER-SCAN ohne Rate-Limits
  async gentleDoppelmarklerScan(options: GentleScrapingOptions): Promise<void> {
    const { category, maxPages, delay, onProgress } = options;
    
    onProgress(`🕊️ SANFTER DOPPELMARKLER-SCAN: ${category}`);
    onProgress(`⏰ Minimaler Delay: ${delay}ms zwischen Requests`);
    
    const detailUrls: string[] = [];
    let successfulPages = 0;

    // SCHRITT 1: Sammle URLs ganz langsam und freundlich
    for (let page = 1; page <= maxPages && successfulPages < maxPages; page++) {
      try {
        onProgress(`📄 Lade Seite ${page}/${maxPages} (sanft)`);
        
        const pageUrls = await this.getPageUrlsGently(category, page);
        if (pageUrls.length > 0) {
          detailUrls.push(...pageUrls);
          successfulPages++;
          onProgress(`✅ Seite ${page}: ${pageUrls.length} URLs (Total: ${detailUrls.length})`);
        } else {
          onProgress(`⚠️ Seite ${page}: Keine URLs gefunden - möglicherweise Ende erreicht`);
        }
        
        // LANGER DELAY zwischen Seiten um freundlich zu bleiben
        if (page < maxPages) {
          const gentleDelay = Math.max(delay, 8000); // Mindestens 8 Sekunden
          onProgress(`⏰ Warte ${gentleDelay/1000}s vor nächster Seite...`);
          await new Promise(resolve => setTimeout(resolve, gentleDelay));
        }
        
      } catch (error: any) {
        onProgress(`❌ Fehler bei Seite ${page}: ${error.message}`);
        
        // Bei Fehlern noch länger warten
        const errorDelay = Math.max(delay * 2, 15000);
        onProgress(`⏰ Extra-Pause wegen Fehler: ${errorDelay/1000}s`);
        await new Promise(resolve => setTimeout(resolve, errorDelay));
      }
    }

    // SCHRITT 2: Doppelmarkler-Check mit sehr sanften Delays
    onProgress(`🎯 DOPPELMARKLER-SCAN: ${detailUrls.length} URLs zu prüfen`);
    
    let doppelmarklerFound = 0;
    let processed = 0;
    
    for (const url of detailUrls) {
      processed++;
      onProgress(`🔍 SANFT-CHECK (${processed}/${detailUrls.length}): ${url}`);
      
      try {
        const result = await this.checkForDoppelmarklerGently(url, category);
        if (result) {
          doppelmarklerFound++;
          onProgress(`💎 DOPPELMARKLER GEFUNDEN: ${result.title} - €${result.price} - Tel: ${result.phoneNumber || 'KEINE'}`);
        }
        
        // SEHR SANFTER DELAY zwischen Detail-Checks
        if (processed < detailUrls.length) {
          const detailDelay = Math.max(delay, 3000); // Mindestens 3 Sekunden
          await new Promise(resolve => setTimeout(resolve, detailDelay));
        }
        
      } catch (error) {
        onProgress(`❌ DETAIL-ERROR: ${error}`);
        // Extra Pause bei Detail-Fehlern
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }

    onProgress(`🏆 SANFTER SCAN COMPLETE: ${doppelmarklerFound} Doppelmarkler gefunden!`);
  }

  private async getPageUrlsGently(category: string, page: number): Promise<string[]> {
    const baseUrl = this.baseUrls[category];
    if (!baseUrl) {
      throw new Error(`Unbekannte Kategorie: ${category}`);
    }
    
    const url = `${baseUrl}&page=${page}`;
    
    const response = await axios.get(url, {
      headers: {
        'User-Agent': this.getRandomUserAgent(),
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'de,en-US;q=0.7,en;q=0.3',
        'Referer': 'https://www.willhaben.at/',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      },
      timeout: 20000,
      maxRedirects: 3
    });

    const $ = cheerio.load(response.data);
    const urls: string[] = [];

    // Extract listing URLs
    $('a[href*="/iad/immobilien/d/"]').each((_, element) => {
      const href = $(element).attr('href');
      if (href && href.includes('/iad/immobilien/d/')) {
        const fullUrl = href.startsWith('http') ? href : `https://www.willhaben.at${href}`;
        urls.push(fullUrl);
      }
    });

    return Array.from(new Set(urls)); // Remove duplicates
  }

  private async checkForDoppelmarklerGently(url: string, category: string): Promise<ListingData | null> {
    try {
      const response = await axios.get(url, {
        headers: {
          'User-Agent': this.getRandomUserAgent(),
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'de,en-US;q=0.7,en;q=0.3',
          'Referer': 'https://www.willhaben.at/',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive'
        },
        timeout: 20000,
        maxRedirects: 3
      });

      const $ = cheerio.load(response.data);
      const bodyText = $('body').text().toLowerCase();
      const description = this.extractDetailDescription($);

      // Doppelmarkler-Suche
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
        console.log(`🎯 SANFTER DOPPELMARKLER HIT: "${foundDoppelmarkler}" in ${url}`);
        
        // Extract all data
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
      console.error(`SANFTER DOPPELMARKLER-CHECK ERROR for ${url}:`, error);
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

    return 'Unbekannter Titel';
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

    return 'Unbekannte Location';
  }

  private extractPhoneNumber(text: string): string | null {
    // Austrian phone number patterns
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