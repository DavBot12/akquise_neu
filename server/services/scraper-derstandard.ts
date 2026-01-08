import axios, { AxiosInstance } from 'axios';
import { load } from 'cheerio';
import { chromium, Browser, Page } from 'playwright-core';

/**
 * derStandard.at SCRAPER SERVICE
 *
 * Zweck:
 * - Scraping von derStandard.at Immobilien (Wien + Niederösterreich)
 * - Kategorien: Eigentumswohnungen + Häuser (KEINE Grundstücke)
 * - Speichert Listings in gleicher Tabelle wie Willhaben mit source='derstandard'
 * - Verwendet Playwright für JavaScript-Rendering (Next.js App)
 */

interface DerStandardScraperOptions {
  intervalMinutes?: number;
  maxPages?: number;
  onLog?: (msg: string) => void;
  onListingFound?: (listing: any) => Promise<void>;
  onPhoneFound?: (payload: { url: string; phone: string }) => void;
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }
function withJitter(base = 800, jitter = 700) { return base + Math.floor(Math.random() * jitter); }

export class DerStandardScraperService {
  private isRunning = false;
  private intervalHandle: NodeJS.Timeout | null = null;
  private currentCycle = 0;
  private axiosInstance: AxiosInstance;
  private sessionCookies = '';
  private requestCount = 0;

  // derStandard.at URLs für Eigentumswohnungen + Häuser (Wien + NÖ)
  private readonly baseUrls: Record<string, string> = {
    // Eigentumswohnungen Wien
    'eigentumswohnung-wien': 'https://immobilien.derstandard.at/suche/wien/kaufen-wohnung',
    // Eigentumswohnungen Niederösterreich
    'eigentumswohnung-niederoesterreich': 'https://immobilien.derstandard.at/suche/niederoesterreich/kaufen-wohnung',
    // Häuser Wien
    'haus-wien': 'https://immobilien.derstandard.at/suche/wien/kaufen-haus',
    // Häuser Niederösterreich
    'haus-niederoesterreich': 'https://immobilien.derstandard.at/suche/niederoesterreich/kaufen-haus'
  };

  constructor() {
    this.axiosInstance = axios.create({ timeout: 30000, maxRedirects: 5 });
  }

  /**
   * Startet den derStandard-Scraper
   */
  async start(options: DerStandardScraperOptions = {}): Promise<void> {
    if (this.isRunning) {
      options.onLog?.('[DERSTANDARD] Scraper läuft bereits!');
      return;
    }

    const {
      intervalMinutes = 30,
      maxPages = 3,
      onLog,
      onListingFound,
      onPhoneFound
    } = options;

    this.isRunning = true;
    onLog?.('[DERSTANDARD] 🚀 GESTARTET - derStandard.at Scraper');
    onLog?.(`[DERSTANDARD] ⏱️ Intervall: ${intervalMinutes} Min | 📄 MaxPages: ${maxPages}`);

    // Erste Ausführung sofort
    await this.runCycle({ maxPages, onLog, onListingFound, onPhoneFound });

    // Danach regelmäßig
    this.intervalHandle = setInterval(async () => {
      if (this.isRunning) {
        await this.runCycle({ maxPages, onLog, onListingFound, onPhoneFound });
      }
    }, intervalMinutes * 60 * 1000);
  }

  /**
   * Stoppt den derStandard-Scraper
   */
  stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
    this.isRunning = false;
  }

  /**
   * Status-Informationen
   */
  getStatus(): { isRunning: boolean; currentCycle: number } {
    return {
      isRunning: this.isRunning,
      currentCycle: this.currentCycle
    };
  }

  /**
   * Führt einen einzelnen Scraping-Zyklus durch
   */
  private async runCycle(options: {
    maxPages: number;
    onLog?: (msg: string) => void;
    onListingFound?: (listing: any) => Promise<void>;
    onPhoneFound?: (payload: { url: string; phone: string }) => void;
  }): Promise<void> {
    this.currentCycle++;
    const { maxPages, onLog, onListingFound, onPhoneFound } = options;

    onLog?.(`[DERSTANDARD] ━━━ CYCLE #${this.currentCycle} START ━━━`);

    try {
      await this.establishSession(onLog);

      for (const [key, baseUrl] of Object.entries(this.baseUrls)) {
        onLog?.(`[DERSTANDARD] 📂 Scraping: ${key}`);

        for (let page = 1; page <= maxPages; page++) {
          try {
            const pageUrl = page === 1 ? baseUrl : `${baseUrl}&page=${page}`;
            onLog?.(`[DERSTANDARD] [${key}] Page ${page}/${maxPages}: ${pageUrl}`);

            const html = await this.fetchPage(pageUrl, onLog);
            const detailUrls = this.extractDetailUrls(html, key);

            onLog?.(`[DERSTANDARD] [${key}] Page ${page}: Found ${detailUrls.length} listings`);

            for (const url of detailUrls) {
              try {
                const detailHtml = await this.fetchDetail(url);
                const { listing, reason } = this.parseDetailWithReason(detailHtml, url, key);

                if (listing) {
                  // Add source field for derStandard
                  listing.source = 'derstandard';

                  if (onListingFound) {
                    await onListingFound(listing);
                    onLog?.(`[DERSTANDARD] [${key}] ✅ ${listing.title.substring(0, 60)}`);
                  }

                  if (listing.phone_number && onPhoneFound) {
                    onPhoneFound({ url, phone: listing.phone_number });
                  }
                } else {
                  onLog?.(`[DERSTANDARD] [${key}] ⏭️ SKIP: ${reason} | ${url}`);
                }
              } catch (e: any) {
                onLog?.(`[DERSTANDARD] [${key}] ⚠️ detail error: ${url} - ${e?.message || e}`);
              }

              await sleep(withJitter(60, 120));
            }

          } catch (e: any) {
            onLog?.(`[DERSTANDARD] [${key}] ⚠️ error page ${page}: ${e?.message || e}`);
          }

          await sleep(withJitter(1000, 800));
        }
      }

      onLog?.(`[DERSTANDARD] ✅ CYCLE #${this.currentCycle} COMPLETE`);
    } catch (error) {
      onLog?.(`[DERSTANDARD] ❌ CYCLE #${this.currentCycle} ERROR: ${error}`);
    }
  }

  private getUA() {
    const pool = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
    ];
    return pool[Math.floor(Math.random() * pool.length)];
  }

  private async establishSession(onLog?: (m: string) => void) {
    try {
      const res = await this.axiosInstance.get('https://immobilien.derstandard.at', {
        headers: { 'User-Agent': this.getUA() }
      });
      const cookies = res.headers['set-cookie'];
      if (cookies) {
        this.sessionCookies = cookies.map(c => c.split(';')[0]).join('; ');
      }
      onLog?.('[DERSTANDARD] Session established');
      await sleep(withJitter(1200, 800));
    } catch {
      onLog?.('[DERSTANDARD] Session establish failed; continue');
    }
  }

  private async fetchPage(url: string, onLog?: (msg: string) => void): Promise<string> {
    // Use Playwright to render JavaScript (Next.js app)
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext({
        userAgent: this.getUA()
      });
      const page = await context.newPage();

      onLog?.(`[DERSTANDARD] Opening ${url} with Playwright...`);
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

      // Wait for listings to load (adjust selector based on actual derStandard structure)
      try {
        await page.waitForSelector('a[href*="/detail/"]', { timeout: 10000 });
      } catch {
        onLog?.(`[DERSTANDARD] No listings found or timeout waiting for listings`);
      }

      // Get rendered HTML
      const html = await page.content();
      await browser.close();

      return html;
    } catch (error) {
      await browser.close();
      throw error;
    }
  }

  private async fetchDetail(url: string, onLog?: (msg: string) => void): Promise<string> {
    // Use Playwright for detail pages too (Next.js needs JS rendering)
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext({
        userAgent: this.getUA()
      });
      const page = await context.newPage();

      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

      // Wait a bit for content to load
      await page.waitForTimeout(2000);

      // Get rendered HTML
      const html = await page.content();
      await browser.close();

      return html;
    } catch (error) {
      await browser.close();
      throw error;
    }
  }

  private extractDetailUrls(html: string, key: string): string[] {
    const urls = new Set<string>();
    const $ = load(html);

    // Extract all links that contain /detail/
    $('a[href]').each((_, el) => {
      const href = $(el).attr('href');
      if (!href) return;

      // Check if it's a detail URL
      if (href.includes('/detail/')) {
        const full = href.startsWith('http')
          ? href
          : href.startsWith('/')
            ? `https://immobilien.derstandard.at${href}`
            : `https://immobilien.derstandard.at/${href}`;

        urls.add(full);
      }
    });

    return Array.from(urls);
  }

  private parseDetailWithReason(html: string, url: string, key: string): { listing: any | null; reason: string } {
    const $ = load(html);
    const bodyText = $('body').text();

    // Extract basic info
    const title = this.extractTitle($);
    if (!title || title.length < 5) return { listing: null, reason: 'no title' };

    const price = this.extractPrice($, bodyText);
    const areaStr = this.extractArea($, bodyText);
    const area = areaStr ? parseFloat(areaStr) : 0;

    // Accept listing if it has either price or area
    if (price <= 0 && !areaStr) {
      return { listing: null, reason: 'no price and no area' };
    }

    const eurPerM2 = area > 0 && price > 0 ? Math.round(price / area) : 0;

    const images = this.extractImages($, html);
    const description = this.extractDescription($);
    const location = this.extractLocation($, bodyText, key);
    const phoneDirect = this.extractPhone($, html);

    const region = key.includes('wien') ? 'wien' : 'niederoesterreich';
    const category = key.includes('eigentumswohnung')
      ? 'eigentumswohnung'
      : key.includes('haus')
        ? 'haus'
        : 'grundstueck';

    return {
      listing: {
        title,
        price: price > 0 ? price : 1, // Set to 1 if "Preis auf Anfrage" (DB requires price)
        area: areaStr || null,
        location,
        url,
        images,
        description,
        phone_number: phoneDirect || null,
        category,
        region,
        eur_per_m2: eurPerM2 ? String(eurPerM2) : null,
        akquise_erledigt: false,
        last_changed_at: null,
        source: 'derstandard',
      },
      reason: 'ok',
    };
  }

  private extractTitle($: ReturnType<typeof load>): string {
    // Try multiple selectors for derStandard
    const selectors = [
      'h1[data-testid="object-title"]',
      'h1.object-title',
      'h1',
      '[class*="title"] h1',
      '[data-testid="ad-title"]'
    ];

    for (const sel of selectors) {
      const el = $(sel);
      if (el.length && el.text().trim()) {
        return el.text().trim();
      }
    }

    return '';
  }

  private extractPrice($: ReturnType<typeof load>, bodyText: string): number {
    // derStandard often has "Preis auf Anfrage" listings
    // Look for actual numbers in body text
    // Kaufpreis format: large numbers (100000+) with € or without

    // Try to find 6+ digit numbers (minimum 100000 EUR)
    const largeNumbers = bodyText.match(/\d{6,}/g) || [];
    for (const numStr of largeNumbers) {
      const num = parseInt(numStr);
      // Reasonable price range for Austrian real estate: 100k - 10M
      if (num >= 100000 && num <= 10000000) {
        // Check if it's likely a price (not a phone number or ID)
        const context = bodyText.substring(bodyText.indexOf(numStr) - 50, bodyText.indexOf(numStr) + 50);
        if (context.toLowerCase().includes('preis') || context.includes('€')) {
          return num;
        }
      }
    }

    return 0; // No price found (likely "Preis auf Anfrage")
  }

  private extractArea($: ReturnType<typeof load>, bodyText: string): string | null {
    // Look for m² pattern in body text
    // Common formats: "65 m²", "65,5 m²", "65.5 m²"
    const areaMatches = bodyText.match(/(\d+[,.]?\d*)\s*m²/g) || [];

    if (areaMatches.length > 0) {
      // Get the first reasonable area (between 10 and 1000 m²)
      for (const match of areaMatches) {
        const numMatch = match.match(/(\d+[,.]?\d*)/);
        if (numMatch) {
          const area = parseFloat(numMatch[1].replace(',', '.'));
          if (area >= 10 && area <= 1000) {
            return area.toString();
          }
        }
      }
    }

    return null;
  }

  private extractLocation($: ReturnType<typeof load>, bodyText: string, key: string): string {
    // Look for "Bezirk" patterns - object location, not agency address
    const bezirkMatch = bodyText.match(/(\d{4}\s+Wien[^,\n]{0,50})/i);
    if (bezirkMatch) {
      return bezirkMatch[1].trim();
    }

    // Look for Wien district patterns (1., 2., etc.)
    const districtMatch = bodyText.match(/(\d{1,2}\.,?\s*Bezirk[^,\n]{0,30})/i);
    if (districtMatch) {
      return districtMatch[1].trim();
    }

    // Look for any Wien address pattern
    const wienMatch = bodyText.match(/([A-ZÄÖÜ][a-zäöüß]+straße[^,\n]{0,20},?\s*\d{4}\s+Wien)/i) ||
                     bodyText.match(/([A-ZÄÖÜ][a-zäöüß]+gasse[^,\n]{0,20},?\s*\d{4}\s+Wien)/i);
    if (wienMatch) {
      return wienMatch[1].trim();
    }

    // Search in HTML JSON data (avoid agency address)
    const html = $.html();
    const jsonMatch = html.match(/"propertyLocation[^"]*":\s*"([^"]+)"/i) ||
                     html.match(/"objectAddress[^"]*":\s*"([^"]+)"/i);
    if (jsonMatch && !jsonMatch[1].toLowerCase().includes('makler')) {
      return jsonMatch[1];
    }

    // Fallback to region
    return key.includes('wien') ? 'Wien' : 'Niederösterreich';
  }

  private extractDescription($: ReturnType<typeof load>): string {
    const descSelectors = [
      '[data-testid="description"]',
      '[class*="description"]',
      '[class*="objektbeschreibung"]',
      'div.description',
      'p.description'
    ];

    for (const sel of descSelectors) {
      const text = $(sel).text().trim();
      if (text && text.length > 30) {
        return text.substring(0, 1000);
      }
    }

    return '';
  }

  private extractPhone($: ReturnType<typeof load>, html: string): string | null {
    // Try to find phone number in various formats
    const phonePatterns = [
      /\+43[\s\-]?\d{1,4}[\s\-]?\d{3,}[\s\-]?\d{3,}/g,
      /0\d{3,4}[\s\-]?\d{3,}[\s\-]?\d{3,}/g,
      /\(0\d{2,4}\)[\s\-]?\d{3,}/g
    ];

    const bodyText = $('body').text();

    for (const pattern of phonePatterns) {
      const match = bodyText.match(pattern);
      if (match) {
        return match[0].replace(/[\s\-]/g, '');
      }
    }

    // Check in HTML data attributes or JSON
    const jsonMatch = html.match(/"phone[^"]*":\s*"([^"]+)"/i) ||
                     html.match(/"telefon[^"]*":\s*"([^"]+)"/i);
    if (jsonMatch) {
      return jsonMatch[1];
    }

    return null;
  }

  private extractImages($: ReturnType<typeof load>, html: string): string[] {
    const images = new Set<string>();

    // Try common image selectors
    $('img[src*="derstandard"], img[src*="immobilien"]').each((_, el) => {
      const src = $(el).attr('src');
      if (src && !src.includes('placeholder') && !src.includes('logo')) {
        const fullSrc = src.startsWith('http') ? src : `https://immobilien.derstandard.at${src}`;
        images.add(fullSrc);
      }
    });

    // Check for image URLs in JSON data
    const imageMatches = html.matchAll(/"image[^"]*":\s*"([^"]+)"/g);
    for (const match of imageMatches) {
      const url = match[1].replace(/\\/g, '');
      if (url.startsWith('http')) {
        images.add(url);
      }
    }

    return Array.from(images);
  }
}
