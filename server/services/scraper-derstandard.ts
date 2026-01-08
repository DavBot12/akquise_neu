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
    const bodyTextLower = bodyText.toLowerCase();

    // Extract basic info
    const title = this.extractTitle($);
    if (!title || title.length < 5) return { listing: null, reason: 'no title' };

    // PRIVAT-FILTER: Suche nach "provisionsfrei" oder ähnlichen Keywords
    const privatKeywords = ['provisionsfrei', 'keine provision', 'ohne provision', 'privatverkauf', 'privat'];
    const hasPrivateKeyword = privatKeywords.some(kw => bodyTextLower.includes(kw));

    if (!hasPrivateKeyword) {
      return { listing: null, reason: 'kein Privat/Provisionsfrei-Keyword (Makler)' };
    }

    const price = this.extractPrice($, bodyText);
    const areaStr = this.extractArea($, bodyText);
    const area = areaStr ? parseFloat(areaStr) : 0;

    // WICHTIG: Nur Listings MIT echtem Preis akzeptieren (kein "Preis auf Anfrage")
    if (price <= 0) {
      return { listing: null, reason: 'kein Preis (Preis auf Anfrage)' };
    }

    // Auch Fläche ist Pflicht für sinnvolle Daten
    if (!areaStr || area <= 0) {
      return { listing: null, reason: 'keine Fläche' };
    }

    const eurPerM2 = Math.round(price / area);

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
        price,
        area: areaStr,
        location,
        url,
        images,
        description,
        phone_number: phoneDirect || null,
        category,
        region,
        eur_per_m2: String(eurPerM2),
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
    // PRIMARY: Stats Section - .sc-stat-label + .sc-stat-value
    const statItems = $('section.heading-section-stats .sc-stat-label, .sc-stat-label');
    for (let i = 0; i < statItems.length; i++) {
      const label = $(statItems[i]).text().trim();
      if (label === 'Kaufpreis') {
        const value = $(statItems[i]).next('.sc-stat-value').text().trim();
        if (value && value !== 'Preis auf Anfrage') {
          // Format: "€ 149.900" or "€ 1.500.000"
          const numStr = value.replace(/[€\s.]/g, '').trim();
          const price = parseInt(numStr);
          if (price >= 50000 && price <= 10000000) {
            return price;
          }
        }
      }
    }

    // FALLBACK: Metadata Section
    const metaItems = $('.sc-metadata-label');
    for (let i = 0; i < metaItems.length; i++) {
      const label = $(metaItems[i]).text().trim();
      if (label === 'Kaufpreis') {
        const value = $(metaItems[i]).next('.sc-metadata-value').text().trim();
        if (value && value !== 'Preis auf Anfrage') {
          const numStr = value.replace(/[€\s.]/g, '').trim();
          const price = parseInt(numStr);
          if (price >= 50000 && price <= 10000000) {
            return price;
          }
        }
      }
    }

    return 0; // No price found
  }

  private extractArea($: ReturnType<typeof load>, bodyText: string): string | null {
    // PRIMARY: Stats Section - Nutzfläche or Wohnfläche
    const statItems = $('.sc-stat-label');
    for (let i = 0; i < statItems.length; i++) {
      const label = $(statItems[i]).text().trim();
      if (label === 'Nutzfläche' || label === 'Wohnfläche') {
        const value = $(statItems[i]).next('.sc-stat-value').text().trim();
        if (value) {
          // Format: "30.01 m²"
          const numStr = value.replace(/[^\d.,]/g, '').replace(',', '.');
          const area = parseFloat(numStr);
          if (area >= 10 && area <= 1000) {
            return area.toString();
          }
        }
      }
    }

    // FALLBACK: Metadata Section
    const metaItems = $('.sc-metadata-label');
    for (let i = 0; i < metaItems.length; i++) {
      const label = $(metaItems[i]).text().trim();
      if (label === 'Nutzfläche' || label === 'Wohnfläche') {
        const value = $(metaItems[i]).next('.sc-metadata-value').text().trim();
        if (value) {
          const numStr = value.replace(/[^\d.,]/g, '').replace(',', '.');
          const area = parseFloat(numStr);
          if (area >= 10 && area <= 1000) {
            return area.toString();
          }
        }
      }
    }

    return null;
  }

  private extractLocation($: ReturnType<typeof load>, bodyText: string, key: string): string {
    // PRIMARY: Metadata Section - PLZ field
    const metaItems = $('.sc-metadata-label');
    for (let i = 0; i < metaItems.length; i++) {
      const label = $(metaItems[i]).text().trim();
      if (label === 'PLZ') {
        const value = $(metaItems[i]).next('.sc-metadata-value').text().trim();
        if (value) {
          // Format: "1200 Wien" or just "1200"
          return value.includes('Wien') ? value : `${value} Wien`;
        }
      }
    }

    // FALLBACK: Look for Wien district patterns in body text
    const bezirkMatch = bodyText.match(/(\d{4}\s+Wien)/i);
    if (bezirkMatch) {
      return bezirkMatch[1].trim();
    }

    // Fallback to region from key
    return key.includes('wien') ? 'Wien' : 'Niederösterreich';
  }

  private extractDescription($: ReturnType<typeof load>): string {
    // PRIMARY: Section mit h2 "Beschreibung"
    const descSection = $('section:has(h2)').filter((_, el) => {
      const h2Text = $(el).find('h2').text().trim();
      return h2Text === 'Beschreibung';
    });

    if (descSection.length > 0) {
      // Sammle alle <p> Tags innerhalb der Section
      const paragraphs: string[] = [];
      descSection.find('p').each((_, p) => {
        const text = $(p).text().trim();
        if (text) paragraphs.push(text);
      });

      if (paragraphs.length > 0) {
        return paragraphs.join('\n\n').substring(0, 2000);
      }
    }

    // FALLBACK: Suche nach Description-Klassen
    const fallbackSelectors = [
      '[class*="Description"]',
      '[class*="description"]',
      '.sc-description'
    ];

    for (const sel of fallbackSelectors) {
      const text = $(sel).text().trim();
      if (text && text.length > 50) {
        return text.substring(0, 2000);
      }
    }

    return '';
  }

  private extractPhone($: ReturnType<typeof load>, html: string): string | null {
    // PRIMARY: tel: Link
    const telLink = $('a[href^="tel:"]');
    if (telLink.length > 0) {
      const href = telLink.attr('href');
      if (href) {
        return href.replace('tel:', '').replace(/[\s\-]/g, '');
      }
    }

    // FALLBACK: Suche nach Kontakt-Telefonnummern in .sc-contact oder .sc-metadata
    const contactSelectors = [
      '.sc-contact-phone',
      '.sc-contact a[href^="tel:"]',
      '[class*="contact"] a[href^="tel:"]'
    ];

    for (const sel of contactSelectors) {
      const link = $(sel);
      if (link.length > 0) {
        const href = link.attr('href');
        if (href && href.startsWith('tel:')) {
          return href.replace('tel:', '').replace(/[\s\-]/g, '');
        }
      }
    }

    return null;
  }

  private extractImages($: ReturnType<typeof load>, html: string): string[] {
    const images = new Set<string>();

    // PRIMARY: picture source - WICHTIG: Attribut heißt "srcset" (lowercase!)
    $('picture source').each((_, el) => {
      const srcset = $(el).attr('srcset'); // lowercase!
      if (srcset) {
        // Extract URL (kann .jpg oder .jpeg sein)
        const match = srcset.match(/(https:\/\/[^\s]+\.(?:jpg|jpeg))/i);
        if (match) {
          // Base URL ohne transformations (split by /~)
          const baseUrl = match[1].split('/~')[0];
          images.add(baseUrl);
        }
      }
    });

    // FALLBACK: img tags
    $('img[alt*="Bild"]').each((_, el) => {
      const src = $(el).attr('src');
      if (src && src.startsWith('http') && !src.includes('placeholder') && !src.includes('logo')) {
        images.add(src);
      }
    });

    return Array.from(images);
  }
}
