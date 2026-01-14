import axios, { AxiosInstance } from 'axios';
import { load } from 'cheerio';
import { chromium } from 'playwright-core';
import { storage } from '../storage';
import { ProxyAgent, fetch as undiciFetch } from 'undici';
import { proxyManager } from './proxy-manager';

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

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }
function withJitter(base = 800, jitter = 700) { return base + Math.floor(Math.random() * jitter); }

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
      const phone = this.extractPhone(content);
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

                // extract phone naïvely
                let phone = this.extractPhone(detail);
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
    const title = this.extractTitle($);
    if (title && (title.includes('Die Seite wurde nicht gefunden') || title.includes('nicht gefunden'))) {
      return { listing: null, reason: 'listing deleted/not found' };
    }

    // Check if it's a 404 page
    if (bodyText.includes('die seite wurde nicht gefunden') || bodyText.includes('seite existiert nicht')) {
      return { listing: null, reason: 'page not found (404)' };
    }

    const description = this.extractDescription($);

    const price = this.extractPrice($, bodyText);
    if (price <= 0) return { listing: null, reason: 'no price' };
    const areaStr = this.extractArea($, bodyText);
    const area = areaStr ? parseInt(areaStr) : 0;
    const eurPerM2 = area > 0 ? Math.round(price / area) : 0;
    const images = this.extractImages($);

    const region = key.includes('wien') ? 'wien' : 'niederoesterreich';
    const category = key.includes('eigentumswohnung')
      ? 'eigentumswohnung'
      : key.includes('haus')
        ? 'haus'
        : 'grundstueck';

    const locJson = this.extractLocationFromJson(html);
    const location = locJson || this.extractLocation($, url) || (key.includes('wien') ? 'Wien' : 'Niederösterreich');
    // Try to extract phone directly from the same HTML so listing includes it
    const phoneDirect = this.extractPhone(html);
    // Extract "Zuletzt geändert" date
    const lastChangedAt = this.extractLastChanged($, html);
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

  private extractDescription($: ReturnType<typeof load>): string {
    const t = $('[data-testid="ad-detail-ad-description"], [data-testid="object-description-text"]').text().trim();
    if (t && t.length > 30 && !t.includes('{"props"')) return t.substring(0, 1000);
    const all = $('body').text();
    // FIX: Don't skip first characters! Look for text after "Objektbeschreibung:" or newline
    const m = all.match(/Objektbeschreibung[\s:]*\n?\s*([\s\S]{30,1200})/i);
    const desc = m?.[1]?.trim() || '';
    if (desc.includes('{"props"')) return '';
    return desc;
  }

  private extractTitle($: ReturnType<typeof load>): string {
    const sel = ['[data-testid="ad-detail-ad-title"] h1','h1'];
    for (const s of sel) { const el = $(s); if (el.length) return el.text().trim(); }
    return '';
  }

  private extractLocationFromJson(html: string): string | '' {
    try {
      // Look for address_location object fields commonly present in Willhaben pageProps
      const streetMatch = html.match(/"street"\s*:\s*"([^"]{3,80})"/i);
      const postalMatch = html.match(/"postalCode"\s*:\s*"(\d{4})"/i);
      const cityMatch = html.match(/"postalName"\s*:\s*"([^"]{3,80})"/i);
      if (postalMatch && (streetMatch || cityMatch)) {
        const street = streetMatch ? streetMatch[1] : '';
        const city = cityMatch ? cityMatch[1] : '';
        const formatted = `${postalMatch[1]} ${city}${street ? ", " + street : ''}`.trim();
        if (formatted.length > 6) return formatted;
      }
      return '';
    } catch {
      return '';
    }
  }

  private extractPrice($: ReturnType<typeof load>, bodyText: string): number {
    const cand = $('span:contains("€"), div:contains("Kaufpreis"), [data-testid*="price"]').text();

    // ✅ PRIORITY 1: JSON PRICE attribute (most reliable!)
    const jsonPrice = bodyText.match(/"PRICE","values":\["(\d+)"\]/);
    if (jsonPrice) {
      const v = parseInt(jsonPrice[1]);
      if (v >= 50000 && v <= 99999999) return v;
    }

    // ✅ PRIORITY 2: Support prices up to 99M (XX.XXX.XXX format like € 2.600.000)
    const m1Million = cand.match(/€\s*(\d{1,2})\.(\d{3})\.(\d{3})/);
    if (m1Million) {
      const v = parseInt(m1Million[1] + m1Million[2] + m1Million[3]);
      if (v >= 50000 && v <= 99999999) return v;
    }
    const m2Million = bodyText.match(/€\s*(\d{1,2})\.(\d{3})\.(\d{3})/);
    if (m2Million) {
      const v = parseInt(m2Million[1] + m2Million[2] + m2Million[3]);
      if (v >= 50000 && v <= 99999999) return v;
    }

    // Fallback: Prices under 1M (€ XXX.XXX format)
    const m1 = cand.match(/€\s*(\d{1,3})\.(\d{3})/);
    if (m1) { const v = parseInt(m1[1] + m1[2]); if (v>=50000 && v<=9999999) return v; }
    const m2 = bodyText.match(/€\s*(\d{1,3})\.(\d{3})/);
    if (m2) { const v = parseInt(m2[1] + m2[2]); if (v>=50000 && v<=9999999) return v; }
    const digits = (bodyText.match(/(\d{3}\.\d{3})/g)||[]).map(x=>parseInt(x.replace('.',''))).find(v=>v>=50000 && v<=9999999);
    return digits || 0;
  }

  private extractArea($: ReturnType<typeof load>, bodyText: string): string | '' {
    const m1 = $('span:contains("m²"), div:contains("Wohnfläche")').text().match(/(\d{1,4})\s*m²/i);
    if (m1) return m1[1];
    const m2 = bodyText.match(/(\d{1,3})\s*m²/i);
    return m2?.[1] || '';
  }

  private extractImages($: ReturnType<typeof load>): string[] {
    const images: string[] = [];
    $('img[src*="cache.willhaben.at"]').each((_, el)=>{ const src = $(el).attr('src'); if (src && !src.includes('_thumb')) images.push(src); });
    const html = $.html();
    (html.match(/https:\/\/cache\.willhaben\.at\/mmo\/[^"'\s]+\.jpg/gi)||[]).forEach(u=>{ if (!u.includes('_thumb')) images.push(u); });
    return Array.from(new Set(images)).slice(0,10);
  }

  private extractLocation($: ReturnType<typeof load>, url: string): string {
    // Primary selector
    const el = $('[data-testid="ad-detail-ad-location"]').text().trim();
    if (el && el.length>5) return el;

    // Willhaben header/label fallback like "Objektstandort"
    const header = $('h2:contains("Objektstandort"), div:contains("Objektstandort")').first();
    if (header.length) {
      const next = header.next();
      const txt = (next.text() || header.parent().text() || '').trim();
      if (txt && txt.length > 5) return txt.replace(/\s+/g,' ');
    }

    // URL-based fallback for Vienna district slugs
    const m = url.match(/wien-(\d{4})-([^\/]+)/i);
    if (m) return `${m[1]} Wien, ${m[2].replace(/-/g,' ')}`;

    // Body text heuristic for addresses/streets
    const body = $('body').text();
    const street = body.match(/\b([A-ZÄÖÜ][a-zäöüß]+(?:gasse|straße|strasse|platz|allee|ring))\b[^\n,]*/);
    if (street) return street[0].trim().substring(0, 100);

    return '';
  }

  private extractLastChanged($: ReturnType<typeof load>, html: string): Date | null {
    try {
      // Methode 1: Suche im DOM via Cheerio mit data-testid
      const editDateEl = $('[data-testid="ad-detail-ad-edit-date-top"]').text();
      if (editDateEl) {
        // Format: "Zuletzt geändert: 07.01.2026, 16:11 Uhr"
        const match = editDateEl.match(/(\d{2})\.(\d{2})\.(\d{4}),\s*(\d{2}):(\d{2})/);
        if (match) {
          const [, day, month, year, hour, minute] = match;
          // Create date in local timezone (Vienna)
          const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day), parseInt(hour), parseInt(minute));
          return date;
        }
      }

      // Methode 2: Regex fallback im gesamten HTML
      const regexMatch = html.match(/Zuletzt geändert:\s*<!--\s*-->(\d{2})\.(\d{2})\.(\d{4}),\s*(\d{2}):(\d{2})\s*Uhr/);
      if (regexMatch) {
        const [, day, month, year, hour, minute] = regexMatch;
        const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day), parseInt(hour), parseInt(minute));
        return date;
      }

      return null;
    } catch (e) {
      return null;
    }
  }

  private extractPhone(html: string): string | null {
    const $ = load(html);

    // 0) Direct tel: links and known testids
    const normalize = (s: string) => s.replace(/[^+\d]/g, '');
    const score = (n: string) => (n.startsWith('+43') ? 3 : 0) + (n.startsWith('06') ? 2 : 0) + (n.length >= 10 ? 1 : 0);
    const blocked = new Set([
      '0606891308',
      '0667891221',
      '0674400169',
      '078354969801',
      '4378354969801',
      '+4378354969801',
      '43667891221',
      '+43667891221'
    ]);
    const isBlocked = (n: string) => {
      const d = n.replace(/[^+\d]/g, '');
      const alt = d.replace(/^\+43/, '0').replace(/^43/, '0');
      const bare = d.replace(/^\+/, '');
      return blocked.has(d) || blocked.has(alt) || blocked.has(bare);
    };

    const directNums: string[] = [];

    // ✅ PRIORITY 1: JSON patterns (most reliable!)
    // Pattern 1: {"name":"CONTACT/PHONE","values":["06509903513"]}
    const contactPhonePattern = /\{"name":"CONTACT\/PHONE","values":\["([^"]+)"\]\}/g;
    const contactPhoneMatches = Array.from(html.matchAll(contactPhonePattern));
    for (const match of contactPhoneMatches) {
      const phone = match[1];
      if (phone && phone.length > 0) {
        directNums.push(phone);
      }
    }

    // Pattern 2: {"id":"phoneNo","description":"Telefon","value":"06509903513"}
    const phoneNoPattern = /\{"id":"phoneNo"[^}]*"value":"([^"]+)"\}/g;
    const phoneNoMatches = Array.from(html.matchAll(phoneNoPattern));
    for (const match of phoneNoMatches) {
      const phone = match[1];
      if (phone && phone.length > 0) {
        directNums.push(phone);
      }
    }

    // If we found phones via JSON, use them immediately
    const jsonPhones = directNums.map(normalize).filter(n => n.length >= 8 && !isBlocked(n));
    if (jsonPhones.length > 0) {
      const best = jsonPhones.map(n => ({ n: n.startsWith('43') ? `+${n}` : n, s: score(n) })).sort((a,b)=>b.s-a.s)[0];
      if (best?.n) return best.n;
    }

    // Fallback: DOM extraction
    $('a[href^="tel:"]').each((_, a) => {
      const href = $(a).attr('href') || '';
      const txt = $(a).text() || '';
      if (href) directNums.push(href.replace(/^tel:/i, ''));
      if (txt) directNums.push(txt);
    });
    $('[data-testid="top-contact-box-phone-number-virtual"], [data-testid="contact-box-phone-number-virtual"]').each((_, el) => {
      const t = $(el).text();
      if (t) directNums.push(t);
    });
    const normalizedDirect = directNums.map(normalize).filter(n => n.length >= 8 && !isBlocked(n));
    if (normalizedDirect.length > 0) {
      const best = normalizedDirect.map(n => ({ n: n.startsWith('43') ? `+${n}` : n, s: score(n) })).sort((a,b)=>b.s-a.s)[0];
      if (best?.n) return best.n;
    }

    // 1) DOM-near extraction: look for elements containing 'Telefon' and read adjacent text
    let domNumber: string | null = null;
    $('*:contains("Telefon")').each((_, el) => {
      const text = $(el).text().trim();
      if (!/^Telefon/i.test(text)) return;
      // try same element
      const matchSame = text.match(/Telefon\s*([+\d\s\-()\/]{8,20})/i);
      if (matchSame && matchSame[1]) {
        domNumber = matchSame[1];
        return false as any;
      }
      // try next siblings
      const nextText = ($(el).next().text() || '') + ' ' + ($(el).parent().text() || '');
      const matchNext = nextText.match(/([+\d\s\-()\/]{8,20})/);
      if (matchNext && matchNext[1]) {
        domNumber = matchNext[1];
        return false as any;
      }
    });

    if (domNumber) {
      const n = normalize(domNumber);
      if (n.length >= 8) return n.startsWith('43') ? `+${n}` : n;
    }

    // 2) Fallback regex across HTML (strip script/style to avoid __NEXT_DATA__ JSON phones)
    const htmlNoScripts = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ');
    // Austrian mobile only: 0650-0699 (accept +43/0043/43/0 prefixes)
    const candidateRegex = /(?:(?:\+43|0043|43|0)\s*)6[5-9]\s*[\d\s\-/()]{7,12}/g;
    const candidates = (htmlNoScripts.match(candidateRegex) || []).map(normalize).filter(n => n.length >= 8 && !isBlocked(n));
    if (candidates.length === 0) return null;
    const best = candidates.map(n => ({ n: n.startsWith('43') ? `+${n}` : n, s: score(n) })).sort((a,b)=>b.s-a.s)[0];
    return best?.n || null;
  }
}
