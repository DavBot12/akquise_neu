import axios, { AxiosInstance } from 'axios';
import { load } from 'cheerio';
import { chromium } from 'playwright-core';
import { storage } from '../storage';
import { ProxyAgent, fetch as undiciFetch } from 'undici';
import { proxyManager } from './proxy-manager';
import {
  sleep,
  withJitter,
  extractPrice,
  extractArea,
  extractTitle,
  extractDescription,
  extractImages,
  extractLastChanged,
  extractLocationFromJson,
  extractLocationFromDom,
  extractPhoneFromHtml,
} from './scraper-utils';

export type ScraperV3Options = {
  categories: string[]; // e.g. ['eigentumswohnung','grundstueck']
  regions: string[];    // e.g. ['wien','niederoesterreich']
  maxPages: number;
  delayMs?: number;
  jitterMs?: number;
  keyword?: string;     // default: 'privat' - wird zur URL hinzugefügt
  onLog?: (msg: string) => void;
  onListingFound?: (listing: any) => Promise<void>;
  onDiscoveredLink?: (payload: { url: string; category: string; region: string }) => void;
  onPhoneFound?: (payload: { url: string; phone: string }) => void;
  usePlaywrightPhone?: boolean;
  maxPhoneFallbackPerRun?: number;
};

export class ScraperV3Service {
  private axiosInstance: AxiosInstance;
  private sessionCookies = '';
  private requestCount = 0;

  // Allgemeine URLs OHNE Vorfilter - wir filtern selbst nach Keywords!
  private baseUrls: Record<string, string> = {
    'eigentumswohnung-wien': 'https://www.willhaben.at/iad/immobilien/eigentumswohnung/eigentumswohnung-angebote?areaId=900&areaId=903&rows=90&sort=1',
    'eigentumswohnung-niederoesterreich': 'https://www.willhaben.at/iad/immobilien/eigentumswohnung/niederoesterreich?rows=90&sort=1',
    'grundstueck-wien': 'https://www.willhaben.at/iad/immobilien/grundstuecke/grundstueck-angebote?areaId=900&areaId=903&rows=90&sort=1',
    'grundstueck-niederoesterreich': 'https://www.willhaben.at/iad/immobilien/grundstuecke/niederoesterreich?rows=90&sort=1',
    'grundstuecke-wien': 'https://www.willhaben.at/iad/immobilien/grundstuecke/grundstueck-angebote?areaId=900&areaId=903&rows=90&sort=1',
    'grundstuecke-niederoesterreich': 'https://www.willhaben.at/iad/immobilien/grundstuecke/niederoesterreich?rows=90&sort=1',
    'haus-wien': 'https://www.willhaben.at/iad/immobilien/haus-kaufen/wien?rows=90&sort=1',
    'haus-niederoesterreich': 'https://www.willhaben.at/iad/immobilien/haus-kaufen/niederoesterreichrows=90?rows=90&sort=1'
  };

  constructor() {
    // Basis axios instance - Proxy wird pro Request gesetzt
    this.axiosInstance = axios.create({
      timeout: 30000,
      maxRedirects: 5,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'de-AT,de;q=0.9,en;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'DNT': '1',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Cache-Control': 'max-age=0'
      }
    });
  }

  /**
   * Macht einen Request mit Proxy-Rotation via undici
   * In dev mode: direct connection without proxy
   */
  private async proxyRequest(url: string, options: any = {}): Promise<any> {
    const proxyUrl = proxyManager.getProxyUrl();
    // In dev mode proxyUrl is undefined - use direct connection
    const dispatcher = proxyUrl ? new ProxyAgent(proxyUrl) : undefined;

    const headers: Record<string, string> = {
      'User-Agent': options.headers?.['User-Agent'] || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'de-AT,de;q=0.9,en;q=0.8',
      'DNT': '1',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
      ...options.headers
    };

    if (this.sessionCookies) {
      headers['Cookie'] = this.sessionCookies;
    }

    // Timeout mit AbortController
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    try {
      const fetchOptions: any = {
        headers,
        signal: controller.signal
      };
      if (dispatcher) {
        fetchOptions.dispatcher = dispatcher;
      }

      const response = await undiciFetch(url, fetchOptions);

      clearTimeout(timeoutId);
      const setCookies = response.headers.getSetCookie?.() || [];
      const data = await response.text();

      return {
        data,
        headers: {
          'set-cookie': setCookies
        },
        status: response.status
      };
    } catch (e: any) {
      clearTimeout(timeoutId);
      throw e;
    }
  }

  /**
   * Playwright fallback for phone extraction (clicks "Telefon anzeigen" button)
   * PERFORMANCE NOTE: This is SLOW (10-20s per call) because it launches Chrome
   * Use sparingly - JSON CONTACT/PHONE pattern should catch most phones now
   */
  private async playwrightPhoneFallback(url: string): Promise<string | null> {
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext();
      const page = await context.newPage();
      // Reduced timeout from 30s to 15s for faster failure
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
      // Try clicking a button/link that reveals phone
      const candidates = [
        '[data-testid="top-contact-box-phone-number-button"]',
        '[data-testid="show-phone"]',
        'text=Telefon anzeigen',
        'text=Telefonnummern anzeigen',
        'button:has-text("Telefon")',
      ];
      for (const sel of candidates) {
        const el = await page.$(sel);
        if (el) { try { await el.click({ timeout: 1500 }); break; } catch {} }
      }
      // Wait for a revealed phone element - reduced timeout from 4s to 2s
      const revealSelectors = [
        'a[href^="tel:"]',
        '[data-testid="top-contact-box-phone-number-virtual"]',
        '[data-testid="contact-box-phone-number-virtual"]',
      ];
      for (const rs of revealSelectors) {
        try {
          const loc = page.locator(rs).first();
          await loc.waitFor({ state: 'visible', timeout: 2000 });
          const href = await loc.getAttribute('href');
          const txt = (await loc.textContent()) || '';
          const raw = (href?.replace(/^tel:/i,'') || '') || txt;
          if (raw) {
            const cleaned = raw.replace(/[^+\d]/g,'');
            if (cleaned.length >= 8) {
              await context.close();
              return cleaned.startsWith('43') ? `+${cleaned}` : cleaned;
            }
          }
        } catch {}
      }
      // Fallback to reading the whole HTML
      const content = await page.content();
      const $content = load(content);
      const phone = extractPhoneFromHtml(content, $content);
      await context.close();
      return phone || null;
    } catch {
      try { await browser.close(); } catch {}
      return null;
    } finally {
      try { await browser.close(); } catch {}
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

  private async establishSession(onLog?: (m: string)=>void) {
    try {
      const res = await this.proxyRequest('https://www.willhaben.at', { headers: { 'User-Agent': this.getUA() } });
      const cookies = res.headers['set-cookie'];
      if (cookies) {
        this.sessionCookies = cookies.map((c: string) => c.split(';')[0]).join('; ');
      }
      onLog?.('Session established via proxy');
      await sleep(withJitter(1200, 800));
    } catch {
      onLog?.('Session establish failed; continue');
    }
  }

  async start(options: ScraperV3Options) {
    const { categories, regions, maxPages, delayMs = 800, jitterMs = 700, keyword = '', onLog, onListingFound, onDiscoveredLink, onPhoneFound, usePlaywrightPhone = true, maxPhoneFallbackPerRun = 5 } = options;

    const isDebug = process.env.DEBUG_SCRAPER === 'true';
    await this.establishSession(onLog);

    let phoneFallbackBudget = maxPhoneFallbackPerRun;

    for (const category of categories) {
      for (const region of regions) {
        const key = `${category}-${region}`;
        const baseUrl = this.baseUrls[key];
        if (!baseUrl) { onLog?.(`[V3] skip unknown combo: ${key}`); continue; }

        // Füge keyword zur URL hinzu wenn gesetzt
        const urlWithKeyword = keyword ? `${baseUrl}&keyword=${encodeURIComponent(keyword)}` : baseUrl;

        // State-Key inkludiert das Keyword für separate Tracking
        const stateKey = keyword ? `${key}-${keyword}` : key;

        onLog?.(`[V3] start ${key}${keyword ? ` (keyword: ${keyword})` : ''}`);
        // State stores the NEXT page to start from. Default 1.
        let startPage = await storage.getScraperNextPage(stateKey, 1);
        if (startPage < 1) startPage = 1;
        onLog?.(`[V3] resume from page ${startPage}`);

        for (let page = startPage; page < startPage + maxPages; page++) {
          const url = `${urlWithKeyword}&page=${page}`;
          try {
            const headers = {
              'User-Agent': this.getUA(),
              'Referer': page > 1 ? `${baseUrl}&page=${page-1}` : 'https://www.willhaben.at/',
              'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
              'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8',
            };
            const res = await this.proxyRequest(url, { headers });
            const html = res.data as string;

            // ULTRA-FAST: Filter URLs by ISPRIVATE=1 from search page
            const { filteredUrls, totalOnPage, privateCount, commercialCount } = this.extractDetailUrlsWithISPRIVATE(html);
            onLog?.(`[V3] page ${page}: ${totalOnPage} total → ${privateCount} privat (ISPRIVATE=1), ${commercialCount} kommerziell (ISPRIVATE=0)`);

            // Broadcast/save discovered links (only filtered private URLs)
            for (const u of filteredUrls) {
              onDiscoveredLink?.({ url: u, category, region });
            }

            // Fetch details ONLY for ISPRIVATE=1 listings
            for (const u of filteredUrls) {
              // Extract listing ID from URL for better logging
              const listingIdMatch = u.match(/-(\d+)\/?$/);
              const listingId = listingIdMatch ? listingIdMatch[1] : 'unknown';

              if (isDebug) {
                onLog?.(`[V3] 📄 Fetching detail: ${listingId} - ${u.substring(0, 100)}...`);
              }

              const detail = await this.fetchDetail(u);
              const { listing, reason } = this.parseDetailWithReason(detail, u, key);

              if (!listing) {
                if (isDebug) {
                  onLog?.(`[V3] ❌ Skip: ${listingId} - ${reason}`);
                } else {
                  onLog?.(`[V3] skip ${listingId} :: ${reason}`);
                }
              }

              if (listing) {
                try {
                  if (onListingFound) await onListingFound(listing);
                } catch {}

                // extract phone from HTML (already done in parseDetailWithReason, but try again for Playwright fallback check)
                const $detail = load(detail);
                let phone = extractPhoneFromHtml(detail, $detail);
                if (!phone && usePlaywrightPhone && phoneFallbackBudget > 0) {
                  try {
                    const pf = await this.playwrightPhoneFallback(u);
                    if (pf) phone = pf;
                    phoneFallbackBudget--;
                  } catch {}
                }

                if (phone) {
                  onPhoneFound?.({ url: u, phone });
                  if (isDebug) {
                    onLog?.(`[V3] 📞 Phone found: ${phone}`);
                  }
                }

                if (isDebug) {
                  onLog?.(`[V3] ✅ Save: ${listingId} - ${listing.title.substring(0, 60)}... - €${listing.price}`);
                  onLog?.(`[V3]    URL: ${u}`);
                } else {
                  onLog?.(`[V3] save ${listing.category}/${listing.region} :: €${listing.price} :: ${listing.title.substring(0,60)}`);
                }
              }
              await sleep(withJitter(60, 120)); // 2.5-4 Sekunden für Proxy-Stabilität
            }
          } catch (e: any) {
            onLog?.(`[V3] error page ${page}: ${e?.message || e}`);
          }
          await sleep(withJitter(delayMs, jitterMs));
          const nextPage = page + 1;
          await storage.setScraperNextPage(stateKey, nextPage);
          onLog?.(`[V3] saved state ${stateKey} -> next page ${nextPage}`);
        }
      }
    }
  }

  /**
   * ULTRA-FAST: Extract detail URLs WITH ISPRIVATE=1 FILTER and stats
   * FIXED: Sequential attribute grouping (100% accurate, no neighbor interference)
   * Returns filtered URLs + statistics for logging
   */
  private extractDetailUrlsWithISPRIVATE(html: string): {
    filteredUrls: string[];
    totalOnPage: number;
    privateCount: number;
    commercialCount: number;
  } {
    const isDebug = process.env.DEBUG_SCRAPER === 'true';

    // ✅ NEW: Parse ALL attributes sequentially (same as Newest scraper)
    // This ensures ADID and ISPRIVATE from the SAME listing are matched together
    const attributePattern = /\{"name":"([^"]+)","values":\["([^"]*)"\]\}/g;
    const allAttributes = Array.from(html.matchAll(attributePattern));

    // ✅ Group attributes by listing using ADID as delimiter
    const listingData = new Map<number, Map<string, string>>();
    let currentListingIndex = -1;

    for (const attr of allAttributes) {
      const fieldName = attr[1];
      const fieldValue = attr[2];

      // ADID marks the start of a new listing block
      if (fieldName === 'ADID') {
        currentListingIndex++;
        listingData.set(currentListingIndex, new Map());
      }

      // Add attribute to the current listing
      // ✅ FIX: Only set if not already present (prevents child-unit data from overwriting parent)
      // This fixes the bug where project listings have multiple SEO_URLs and the wrong one gets used
      if (currentListingIndex >= 0) {
        const currentListing = listingData.get(currentListingIndex)!;
        if (!currentListing.has(fieldName)) {
          currentListing.set(fieldName, fieldValue);
        }
      }
    }

    const totalOnPage = listingData.size;
    let privateCount = 0;
    let commercialCount = 0;
    const filteredUrls: string[] = [];

    // ✅ Filter and build URLs for ISPRIVATE=1 only
    for (const [_, attrs] of Array.from(listingData.entries())) {
      const isPrivate = attrs.get('ISPRIVATE');
      const adId = attrs.get('ADID');

      if (isPrivate === '0') {
        commercialCount++;
      } else if (isPrivate === '1') {
        privateCount++;

        // Build URL
        const seoUrl = attrs.get('SEO_URL');
        let url: string;

        if (seoUrl) {
          if (seoUrl.startsWith('http')) {
            url = seoUrl;
          } else {
            let cleanUrl = seoUrl.startsWith('/') ? seoUrl : `/${seoUrl}`;
            // Add /iad/ if missing
            if (!cleanUrl.startsWith('/iad/')) {
              cleanUrl = cleanUrl.replace(/^\//, '/iad/');
            }
            url = `https://www.willhaben.at${cleanUrl}`;
          }
        } else {
          // Fallback: build from ADID
          url = `https://www.willhaben.at/iad/immobilien/d/immobilie/${adId}`;
        }

        filteredUrls.push(url);
      }
    }

    if (isDebug) {
      console.log(`[V3-DEBUG] Parsed ${totalOnPage} listings: ${privateCount} private, ${commercialCount} commercial`);
    }

    return {
      filteredUrls,
      totalOnPage,
      privateCount,
      commercialCount
    };
  }

  private extractListingIdFromUrl(url: string): string | null {
    // Willhaben format: ID comes at the end after hyphen (e.g., titel-1234567890)
    let match = url.match(/-(\d{8,})(?:[\\/\?#]|$)/);
    if (match) return match[1];

    // Try format 2: ID as last segment after slash
    match = url.match(/\/(\d{8,})(?:[\\/\?#]|$)/);
    if (match) return match[1];

    // Fallback: extract last segment and check if it's all digits
    const segments = url.split(/[\\/\?#]/).filter(s => s.length > 0);
    const lastSegment = segments[segments.length - 1];
    if (/^\d{8,}$/.test(lastSegment)) {
      return lastSegment;
    }

    return null;
  }

  private async fetchDetail(url: string): Promise<string> {
    // Refresh session every 50 requests to avoid stale cookies
    this.requestCount++;
    if (this.requestCount % 50 === 0) {
      await this.establishSession();
    }

    const headers = {
      'User-Agent': this.getUA(),
      'Referer': 'https://www.willhaben.at/iad/immobilien/',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8',
    };
    const res = await this.proxyRequest(url, { headers });
    const newCookies = res.headers['set-cookie'];
    if (newCookies) this.sessionCookies = newCookies.map((c: string) => c.split(';')[0]).join('; ');
    return res.data as string;
  }

  private parseDetailWithReason(html: string, url: string, key: string): { listing: any | null; reason: string } {
    const $ = load(html);
    const bodyText = $('body').text().toLowerCase();

    // ✅ CRITICAL: Verify ISPRIVATE on detail page (Willhaben has inconsistent data!)
    // Search page sometimes shows ISPRIVATE=1 but detail page shows ISPRIVATE=0
    // Detail page is the SOURCE OF TRUTH - ALWAYS check here!
    const isPrivateMatch = html.match(/\{"name":"ISPRIVATE","values":\["(\d)"\]\}/);
    const detailISPRIVATE = isPrivateMatch ? isPrivateMatch[1] : null;

    if (detailISPRIVATE === '0') {
      return { listing: null, reason: 'ISPRIVATE=0 on detail page (commercial)' };
    }

    if (!detailISPRIVATE) {
      return { listing: null, reason: 'no ISPRIVATE flag on detail page' };
    }

    // Check if listing was deleted/not found
    const title = extractTitle($);
    if (title && (title.includes('Die Seite wurde nicht gefunden') || title.includes('nicht gefunden'))) {
      return { listing: null, reason: 'listing deleted/not found' };
    }

    // Check if it's a 404 page
    if (bodyText.includes('die seite wurde nicht gefunden') || bodyText.includes('seite existiert nicht')) {
      return { listing: null, reason: 'page not found (404)' };
    }

    const description = extractDescription($);

    const price = extractPrice($, bodyText);
    if (price <= 0) return { listing: null, reason: 'no price' };
    const areaStr = extractArea($, bodyText);
    const area = areaStr ? parseInt(areaStr) : 0;
    const eurPerM2 = area > 0 ? Math.round(price / area) : 0;
    const images = extractImages($, html);

    const region = key.includes('wien') ? 'wien' : 'niederoesterreich';
    const category = key.includes('eigentumswohnung')
      ? 'eigentumswohnung'
      : key.includes('haus')
        ? 'haus'
        : 'grundstueck';

    const locJson = extractLocationFromJson(html);
    const location = locJson || extractLocationFromDom($, url) || (key.includes('wien') ? 'Wien' : 'Niederösterreich');
    // Try to extract phone directly from the same HTML so listing includes it
    const phoneDirect = extractPhoneFromHtml(html, $);
    // Extract "Zuletzt geändert" date
    const lastChangedAt = extractLastChanged($, html);
    return {
      listing: {
      title,
      price,
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
      last_changed_at: lastChangedAt,
      },
      reason: 'ok',
    };
  }

}
