import axios, { AxiosInstance } from 'axios';
import { load } from 'cheerio';

/**
 * NEWEST SCRAPER SERVICE
 *
 * Zweck:
 * - Regelmäßiges Scraping der ersten 1-5 Seiten mit sort=1 (neueste zuerst)
 * - Speichert NUR neue Inserate
 * - Keine Updates bei existierenden Listings
 *
 * Abgrenzung:
 * - ScraperV3: Manuell/geplant, tiefer Backfill (viele Seiten), KEIN sort=1
 * - Scraper24/7: Kontinuierlich, alle Seiten bis Ende, standard sort
 * - NewestScraper: Regelmäßig (alle 30 Min), nur erste 1-5 Seiten, sort=1, nur NEUE Inserate
 */

interface NewestScraperOptions {
  intervalMinutes?: number;  // Intervall in Minuten (default: 30)
  maxPages?: number;         // Maximale Seiten pro Kategorie (default: 5)
  onLog?: (msg: string) => void;
  onListingFound?: (listing: any) => Promise<void>;
  onPhoneFound?: (payload: { url: string; phone: string }) => void;
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }
function withJitter(base = 800, jitter = 700) { return base + Math.floor(Math.random() * jitter); }

export class NewestScraperService {
  private isRunning = false;
  private intervalHandle: NodeJS.Timeout | null = null;
  private currentCycle = 0;
  private axiosInstance: AxiosInstance;
  private sessionCookies = '';
  private requestCount = 0;

  // Base URLs mit sort=1 (neueste zuerst) - MIT keyword=privat (NUR Wohnungen + Häuser)
  private readonly baseUrlsWithKeyword: Record<string, string> = {
    'eigentumswohnung-wien': 'https://www.willhaben.at/iad/immobilien/eigentumswohnung/eigentumswohnung-angebote?areaId=900&areaId=903&rows=90&sort=1&keyword=privat',
    'eigentumswohnung-niederoesterreich': 'https://www.willhaben.at/iad/immobilien/eigentumswohnung/niederoesterreich?rows=90&sort=1&keyword=privat',
    'haus-wien': 'https://www.willhaben.at/iad/immobilien/haus-kaufen/wien?rows=90&sort=1&keyword=privat',
    'haus-niederoesterreich': 'https://www.willhaben.at/iad/immobilien/haus-kaufen/niederoesterreich?rows=90&sort=1&keyword=privat'
  };

  // Base URLs mit sort=1 (neueste zuerst) - OHNE keyword (NUR Wohnungen + Häuser)
  private readonly baseUrlsWithoutKeyword: Record<string, string> = {
    'eigentumswohnung-wien': 'https://www.willhaben.at/iad/immobilien/eigentumswohnung/eigentumswohnung-angebote?areaId=900&areaId=903&rows=90&sort=1',
    'eigentumswohnung-niederoesterreich': 'https://www.willhaben.at/iad/immobilien/eigentumswohnung/niederoesterreich?rows=90&sort=1',
    'haus-wien': 'https://www.willhaben.at/iad/immobilien/haus-kaufen/wien?rows=90&sort=1',
    'haus-niederoesterreich': 'https://www.willhaben.at/iad/immobilien/haus-kaufen/niederoesterreich?rows=90&sort=1'
  };

  constructor() {
    this.axiosInstance = axios.create({ timeout: 30000, maxRedirects: 5 });
  }

  /**
   * Startet den Newest-Scraper mit regelmäßigem Intervall
   */
  async start(options: NewestScraperOptions = {}): Promise<void> {
    if (this.isRunning) {
      options.onLog?.('[NEWEST] Scraper läuft bereits!');
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
    onLog?.('[NEWEST] 🚀 GESTARTET - Neueste Inserate (sort=1)');
    onLog?.(`[NEWEST] ⏱️ Intervall: ${intervalMinutes} Min | 📄 MaxPages: ${maxPages} (mit + ohne keyword)`);

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
   * Stoppt den Newest-Scraper
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

    onLog?.(`[NEWEST] ━━━ CYCLE #${this.currentCycle} START ━━━`);

    try {
      await this.establishSession(onLog);

      // Scrape BEIDE Varianten für maximale Abdeckung
      // 1. MIT keyword=privat (erste 3 Seiten)
      onLog?.(`[NEWEST] 📍 Phase 1: MIT keyword=privat`);
      await this.scrapeUrlSet(this.baseUrlsWithKeyword, maxPages, 'mit-keyword', onLog, onListingFound, onPhoneFound);

      // 2. OHNE keyword (erste 3 Seiten) - Code filtert dann selbst
      onLog?.(`[NEWEST] 📍 Phase 2: OHNE keyword (breitere Abdeckung)`);
      await this.scrapeUrlSet(this.baseUrlsWithoutKeyword, maxPages, 'ohne-keyword', onLog, onListingFound, onPhoneFound);

      onLog?.(`[NEWEST] ✅ CYCLE #${this.currentCycle} COMPLETE`);
    } catch (error) {
      onLog?.(`[NEWEST] ❌ CYCLE #${this.currentCycle} ERROR: ${error}`);
    }
  }

  /**
   * Scrapt ein Set von URLs (mit oder ohne keyword)
   */
  private async scrapeUrlSet(
    urlSet: Record<string, string>,
    maxPages: number,
    label: string,
    onLog?: (msg: string) => void,
    onListingFound?: (listing: any) => Promise<void>,
    onPhoneFound?: (payload: { url: string; phone: string }) => void
  ): Promise<void> {
    for (const [key, baseUrl] of Object.entries(urlSet)) {
      onLog?.(`[NEWEST] [${label}] 🔍 ${key}`);

      // Scrape nur die ersten maxPages Seiten
      for (let page = 1; page <= maxPages; page++) {
        const url = `${baseUrl}&page=${page}`;

        try {
          const headers = {
            'User-Agent': this.getUA(),
            'Referer': page > 1 ? `${baseUrl}&page=${page-1}` : 'https://www.willhaben.at/',
            'Cookie': this.sessionCookies,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8',
          };

          const res = await this.axiosInstance.get(url, { headers });
          const html = res.data as string;

          // Extrahiere Detail-URLs
          const urls = this.extractDetailUrls(html);
          onLog?.(`[NEWEST] [${label}] page ${page}: ${urls.length} urls gefunden`);

          // Fetch Details und speichere nur private Listings
          for (const detailUrl of urls) {
            const detail = await this.fetchDetail(detailUrl);
            const { listing } = this.parseDetailWithReason(detail, detailUrl, key);

            if (!listing) {
              // Skip non-private listings silently
            } else {
              // Speichere Listing (Backend prüft ob bereits vorhanden)
              try {
                if (onListingFound) {
                  await onListingFound(listing);
                }
              } catch (e) {
                // Listing existiert bereits - normal bei Newest Scraper
              }

              // Extrahiere Telefonnummer
              const phone = this.extractPhone(detail);
              if (phone) {
                onPhoneFound?.({ url: detailUrl, phone });
              }

              onLog?.(`[NEWEST] [${label}] ✅ ${listing.category}/${listing.region} :: €${listing.price} :: ${listing.title.substring(0,50)}`);
            }

            await sleep(withJitter(60, 120));
          }

        } catch (e: any) {
          onLog?.(`[NEWEST] [${label}] ⚠️ error page ${page}: ${e?.message || e}`);
        }

        await sleep(withJitter(1000, 800));
      }
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
      const res = await this.axiosInstance.get('https://www.willhaben.at', { headers: { 'User-Agent': this.getUA() } });
      const cookies = res.headers['set-cookie'];
      if (cookies) {
        this.sessionCookies = cookies.map(c => c.split(';')[0]).join('; ');
      }
      onLog?.('[NEWEST] Session established');
      await sleep(withJitter(1200, 800));
    } catch {
      onLog?.('[NEWEST] Session establish failed; continue');
    }
  }

  private extractDetailUrls(html: string): string[] {
    const urls = new Set<string>();
    const direct = html.match(/\"(\/iad\/immobilien\/d\/[^\"\s>]+)\"/g) || [];
    for (const m of direct) {
      const path = m.replace(/\"/g, '');
      urls.add(`https://www.willhaben.at${path}`);
    }
    const $ = load(html);
    $('a[href*="/iad/immobilien/d/"]').each((_, el) => {
      const href = $(el).attr('href');
      if (!href) return;
      const full = href.startsWith('http') ? href : `https://www.willhaben.at${href}`;
      urls.add(full);
    });
    return Array.from(urls);
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
      'Cookie': this.sessionCookies,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8',
    };
    const res = await this.axiosInstance.get(url, { headers });
    const newCookies = res.headers['set-cookie'];
    if (newCookies) this.sessionCookies = newCookies.map(c => c.split(';')[0]).join('; ');
    return res.data as string;
  }

  private parseDetailWithReason(html: string, url: string, key: string): { listing: any | null; reason: string } {
    const $ = load(html);
    const bodyText = $('body').text().toLowerCase();

    // Makler-Blacklist
    const commercial = [
      'neubauprojekt', 'erstbezug', 'bauträger', 'anleger', 'wohnprojekt', 'immobilienmakler', 'provisionsaufschlag', 'fertigstellung', 'projektentwicklung', 'immobilienvertrieb', 'immobilienbüro'
    ];
    if (commercial.some(k => bodyText.includes(k))) return { listing: null, reason: 'commercial keyword' };

    // Private-Indikatoren
    const priv = [
      'privatverkauf', 'privat verkauf', 'von privat', 'privater verkäufer', 'privater anbieter', 'ohne makler', 'verkaufe privat', 'privat zu verkaufen', 'eigenheim verkauf', 'private anzeige'
    ];
    const description = this.extractDescription($);
    const title = this.extractTitle($);
    const isPrivate = priv.some(k => bodyText.includes(k) || description.toLowerCase().includes(k));
    if (!isPrivate) return { listing: null, reason: 'no private indicators' };

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
    const phoneDirect = this.extractPhone(html);
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
    const m = all.match(/Objektbeschreibung[\s:]*\n?\s*([\s\S]{30,1200})/i);
    const desc = m?.[1]?.trim() || '';
    if (desc.includes('{"props"')) return '';
    return desc;
  }

  private extractTitle($: ReturnType<typeof load>): string {
    const sel = ['[data-testid="ad-detail-ad-title"] h1', 'h1'];
    for (const s of sel) { const el = $(s); if (el.length) return el.text().trim(); }
    return '';
  }

  private extractLocationFromJson(html: string): string | '' {
    try {
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
    const m1 = cand.match(/€\s*(\d{1,3})\.(\d{3})/);
    if (m1) { const v = parseInt(m1[1] + m1[2]); if (v >= 50000 && v <= 9999999) return v; }
    const m2 = bodyText.match(/€\s*(\d{1,3})\.(\d{3})/);
    if (m2) { const v = parseInt(m2[1] + m2[2]); if (v >= 50000 && v <= 9999999) return v; }
    const digits = (bodyText.match(/(\d{3}\.\d{3})/g) || []).map(x => parseInt(x.replace('.', ''))).find(v => v >= 50000 && v <= 9999999);
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
    $('img[src*="cache.willhaben.at"]').each((_, el) => { const src = $(el).attr('src'); if (src && !src.includes('_thumb')) images.push(src); });
    const html = $.html();
    (html.match(/https:\/\/cache\.willhaben\.at\/mmo\/[^"'\s]+\.jpg/gi) || []).forEach(u => { if (!u.includes('_thumb')) images.push(u); });
    return Array.from(new Set(images)).slice(0, 10);
  }

  private extractLocation($: ReturnType<typeof load>, url: string): string {
    const el = $('[data-testid="ad-detail-ad-location"]').text().trim();
    if (el && el.length > 5) return el;

    const header = $('h2:contains("Objektstandort"), div:contains("Objektstandort")').first();
    if (header.length) {
      const next = header.next();
      const txt = (next.text() || header.parent().text() || '').trim();
      if (txt && txt.length > 5) return txt.replace(/\s+/g, ' ');
    }

    const m = url.match(/wien-(\d{4})-([^\/]+)/i);
    if (m) return `${m[1]} Wien, ${m[2].replace(/-/g, ' ')}`;

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
      const best = normalizedDirect.map(n => ({ n: n.startsWith('43') ? `+${n}` : n, s: score(n) })).sort((a, b) => b.s - a.s)[0];
      if (best?.n) return best.n;
    }

    // DOM-near extraction
    let domNumber: string | null = null;
    $('*:contains("Telefon")').each((_, el) => {
      const text = $(el).text().trim();
      if (!/^Telefon/i.test(text)) return;
      const matchSame = text.match(/Telefon\s*([+\d\s\-()\/]{8,20})/i);
      if (matchSame && matchSame[1]) {
        domNumber = matchSame[1];
        return false as any;
      }
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

    // Fallback regex
    const htmlNoScripts = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ');
    const candidateRegex = /(?:(?:\+43|0043|43|0)\s*)6[5-9]\s*[\d\s\-/()]{7,12}/g;
    const candidates = (htmlNoScripts.match(candidateRegex) || []).map(normalize).filter(n => n.length >= 8 && !isBlocked(n));
    if (candidates.length === 0) return null;
    const best = candidates.map(n => ({ n: n.startsWith('43') ? `+${n}` : n, s: score(n) })).sort((a, b) => b.s - a.s)[0];
    return best?.n || null;
  }
}
