import axios, { AxiosInstance } from 'axios';
import { load } from 'cheerio';
import { chromium } from 'playwright-core';
import { promises as fs } from 'fs';
import path from 'path';

export type ScraperV3Options = {
  categories: string[]; // e.g. ['eigentumswohnung','grundstueck']
  regions: string[];    // e.g. ['wien','niederoesterreich']
  maxPages: number;
  delayMs?: number;
  jitterMs?: number;
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
  private statePath = path.join(process.cwd(), 'server', 'data', 'scraper_state.json');

  // Robust PRIVAT-gefilteter Katalog wie im Stealth-Scraper
  private baseUrls: Record<string, string> = {
    'eigentumswohnung-wien': 'https://www.willhaben.at/iad/immobilien/eigentumswohnung/eigentumswohnung-angebote?areaId=900&areaId=903&rows=25&SELLER_TYPE=PRIVAT&isNavigation=true&keyword=privatverkauf',
    'eigentumswohnung-niederoesterreich': 'https://www.willhaben.at/iad/immobilien/eigentumswohnung/eigentumswohnung-angebote?areaId=904&rows=25&SELLER_TYPE=PRIVAT&isNavigation=true&keyword=privatverkauf',
    'grundstueck-wien': 'https://www.willhaben.at/iad/immobilien/grundstuecke/grundstueck-angebote?areaId=900&areaId=903&rows=25&SELLER_TYPE=PRIVAT&isNavigation=true&keyword=privatverkauf',
    'grundstueck-niederoesterreich': 'https://www.willhaben.at/iad/immobilien/grundstuecke/grundstueck-angebote?areaId=904&rows=25&SELLER_TYPE=PRIVAT&isNavigation=true&keyword=privatverkauf',
    'grundstuecke-wien': 'https://www.willhaben.at/iad/immobilien/grundstuecke/grundstueck-angebote?areaId=900&areaId=903&rows=25&SELLER_TYPE=PRIVAT&isNavigation=true&keyword=privatverkauf',
    'grundstuecke-niederoesterreich': 'https://www.willhaben.at/iad/immobilien/grundstuecke/grundstueck-angebote?areaId=904&rows=25&SELLER_TYPE=PRIVAT&isNavigation=true&keyword=privatverkauf'
  };

  constructor() {
    this.axiosInstance = axios.create({ timeout: 30000, maxRedirects: 5 });
  }

  private async playwrightPhoneFallback(url: string): Promise<string | null> {
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      // Try clicking a button/link that reveals phone
      const candidates = [
        'text=Telefon anzeigen',
        'text=Telefonnummern anzeigen',
        'button:has-text("Telefon")',
        '[data-testid="show-phone"]',
        '[data-testid="top-contact-box-phone-number-button"]',
      ];
      for (const sel of candidates) {
        const el = await page.$(sel);
        if (el) { try { await el.click({ timeout: 2000 }); } catch {} }
      }
      // Wait for a revealed phone element
      const revealSelectors = [
        'a[href^="tel:"]',
        '[data-testid="top-contact-box-phone-number-virtual"]',
        '[data-testid="contact-box-phone-number-virtual"]',
      ];
      for (const rs of revealSelectors) {
        try {
          const loc = page.locator(rs).first();
          await loc.waitFor({ state: 'visible', timeout: 4000 });
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
      const res = await this.axiosInstance.get('https://www.willhaben.at', { headers: { 'User-Agent': this.getUA() } });
      const cookies = res.headers['set-cookie'];
      if (cookies) {
        this.sessionCookies = cookies.map(c => c.split(';')[0]).join('; ');
      }
      onLog?.('Session established');
      await sleep(withJitter(1200, 800));
    } catch {
      onLog?.('Session establish failed; continue');
    }
  }

  private async loadState(onLog?: (m:string)=>void): Promise<Record<string, number>> {
    try {
      const dir = path.dirname(this.statePath);
      await fs.mkdir(dir, { recursive: true });
      const raw = await fs.readFile(this.statePath, 'utf8').catch(() => '{}');
      const parsed = JSON.parse(raw || '{}');
      return typeof parsed === 'object' && parsed ? parsed : {};
    } catch {
      onLog?.('[V3] state load failed; starting fresh');
      return {};
    }
  }

  private async saveState(state: Record<string, number>) {
    await fs.writeFile(this.statePath, JSON.stringify(state, null, 2), 'utf8');
  }

  async start(options: ScraperV3Options) {
    const { categories, regions, maxPages, delayMs = 800, jitterMs = 700, onLog, onListingFound, onDiscoveredLink, onPhoneFound, usePlaywrightPhone = true, maxPhoneFallbackPerRun = 5 } = options;

    await this.establishSession(onLog);

    let phoneFallbackBudget = maxPhoneFallbackPerRun;

    const state = await this.loadState(onLog);

    for (const category of categories) {
      for (const region of regions) {
        const key = `${category}-${region}`;
        const baseUrl = this.baseUrls[key];
        if (!baseUrl) { onLog?.(`[V3] skip unknown combo: ${key}`); continue; }
        onLog?.(`[V3] start ${key}`);
        // State stores the NEXT page to start from. Default 1.
        let startPage = state[key] ?? 1;
        if (startPage < 1 || startPage > maxPages) startPage = 1;
        onLog?.(`[V3] resume from page ${startPage}`);

        for (let page = startPage; page < startPage + maxPages; page++) {
          const logicalPage = ((page - 1) % maxPages) + 1; // stay within range for willhaben
          const url = `${baseUrl}&page=${logicalPage}`;
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

            // Discover detail URLs (regex + cheerio fallback)
            const urls = this.extractDetailUrls(html);
            onLog?.(`[V3] page ${logicalPage}: ${urls.length} urls`);

            // Broadcast/save discovered links
            for (const u of urls) {
              onDiscoveredLink?.({ url: u, category, region });
            }

            // Fetch details and save private listings
            for (const u of urls) {
              const detail = await this.fetchDetail(u);
              const { listing, reason } = this.parseDetailWithReason(detail, u, key);
              if (!listing) {
                onLog?.(`[V3] skip ${u} :: ${reason}`);
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
                if (phone) onPhoneFound?.({ url: u, phone });
                onLog?.(`[V3] save ${listing.category}/${listing.region} :: €${listing.price} :: ${listing.title.substring(0,60)}`);
              }
              await sleep(withJitter(60, 120));
            }
          } catch (e: any) {
            onLog?.(`[V3] error page ${logicalPage}: ${e?.message || e}`);
          }
          await sleep(withJitter(delayMs, jitterMs));
          const nextPage = ((logicalPage) % maxPages) + 1;
          state[key] = nextPage;
          await this.saveState(state);
          onLog?.(`[V3] saved state ${key} -> next page ${nextPage}`);
        }
      }
    }
  }

  private extractDetailUrls(html: string): string[] {
    const urls = new Set<string>();
    const direct = html.match(/\"(\/iad\/immobilien\/d\/[^\"\s>]+)\"/g) || [];
    for (const m of direct) {
      const path = m.replace(/\"/g,'');
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

    // Makler-Blacklist (aus Stealth)
    const commercial = [
      'neubauprojekt','erstbezug','bauträger','anleger','wohnprojekt','immobilienmakler','provisionsaufschlag','fertigstellung','projektentwicklung','immobilienvertrieb','immobilienbüro'
    ];
    if (commercial.some(k => bodyText.includes(k))) return { listing: null, reason: 'commercial keyword' };

    // private-Indikatoren (aus Stealth)
    const priv = [
      'privatverkauf','privat verkauf','von privat','privater verkäufer','privater anbieter','ohne makler','verkaufe privat','privat zu verkaufen','eigenheim verkauf','private anzeige'
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
    const category = key.includes('eigentumswohnung') ? 'eigentumswohnung' : 'grundstueck';

    const locJson = this.extractLocationFromJson(html);
    const location = locJson || this.extractLocation($, url) || (key.includes('wien') ? 'Wien' : 'Niederösterreich');
    // Try to extract phone directly from the same HTML so listing includes it
    const phoneDirect = this.extractPhone(html);
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
      },
      reason: 'ok',
    };
  }

  private extractDescription($: ReturnType<typeof load>): string {
    const t = $('[data-testid="ad-detail-ad-description"], [data-testid="object-description-text"]').text().trim();
    if (t && t.length > 30 && !t.includes('{"props"')) return t.substring(0, 1000);
    const all = $('body').text();
    const m = all.match(/Objektbeschreibung[\s\S]{0,50}([\s\S]{30,1200})/i);
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
    const m1 = cand.match(/€\s*(\d{1,3})\.(\d{3})/);
    if (m1) { const v = parseInt(m1[1] + m1[2]); if (v>=50000 && v<=999999) return v; }
    const m2 = bodyText.match(/€\s*(\d{1,3})\.(\d{3})/);
    if (m2) { const v = parseInt(m2[1] + m2[2]); if (v>=50000 && v<=999999) return v; }
    const digits = (bodyText.match(/(\d{3}\.\d{3})/g)||[]).map(x=>parseInt(x.replace('.',''))).find(v=>v>=50000 && v<=999999);
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
