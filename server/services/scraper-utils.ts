/**
 * Shared Scraper Utilities
 * Common functions used across all Willhaben scrapers
 */

import { ProxyAgent, fetch as undiciFetch } from 'undici';
import { proxyManager } from './proxy-manager';

// ============================================
// DELAY & JITTER UTILITIES
// ============================================

export function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

export function withJitter(base = 800, jitter = 700): number {
  return base + Math.floor(Math.random() * jitter);
}

// ============================================
// USER-AGENT ROTATION
// ============================================

export const DEFAULT_USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
];

export function rotateUserAgent(userAgents: string[] = DEFAULT_USER_AGENTS): string {
  return userAgents[Math.floor(Math.random() * userAgents.length)];
}

// ============================================
// PROXY REQUEST
// ============================================

export interface ProxyRequestOptions {
  headers?: Record<string, string>;
  timeout?: number;
}

export interface ProxyRequestResponse {
  data: string;
  headers: { 'set-cookie': string[] };
  status: number;
}

export async function proxyRequest(
  url: string,
  sessionCookies: string = '',
  options: ProxyRequestOptions = {}
): Promise<ProxyRequestResponse> {
  const proxyUrl = proxyManager.getProxyUrl();
  const dispatcher = proxyUrl ? new ProxyAgent(proxyUrl) : undefined;

  const headers: Record<string, string> = {
    'User-Agent': options.headers?.['User-Agent'] || rotateUserAgent(),
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'de-AT,de;q=0.9,en;q=0.8',
    'DNT': '1',
    'Connection': 'keep-alive',
    'Upgrade-Insecure-Requests': '1',
    ...options.headers
  };

  if (sessionCookies) {
    headers['Cookie'] = sessionCookies;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), options.timeout || 30000);

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
      headers: { 'set-cookie': setCookies },
      status: response.status
    };
  } catch (e: any) {
    clearTimeout(timeoutId);
    throw e;
  }
}

// ============================================
// PHONE EXTRACTION & VALIDATION
// ============================================

export const BLOCKED_PHONE_NUMBERS = new Set([
  '0606891308', '0667891221', '0674400169', '078354969801',
  '4378354969801', '+4378354969801', '43667891221', '+43667891221'
]);

export function normalizePhone(s: string): string {
  return s.replace(/[^+\d]/g, '');
}

export function scorePhone(n: string): number {
  return (n.startsWith('+43') ? 3 : 0) +
         (n.startsWith('06') ? 2 : 0) +
         (n.length >= 10 ? 1 : 0);
}

export function isBlockedPhone(n: string): boolean {
  const d = n.replace(/[^+\d]/g, '');
  const alt = d.replace(/^\+43/, '0').replace(/^43/, '0');
  const bare = d.replace(/^\+/, '');
  return BLOCKED_PHONE_NUMBERS.has(d) ||
         BLOCKED_PHONE_NUMBERS.has(alt) ||
         BLOCKED_PHONE_NUMBERS.has(bare);
}

export function extractPhoneFromHtml(html: string, $: any): string | null {
  const directNums: string[] = [];

  // PRIORITY 1: JSON patterns (most reliable)
  const contactPhonePattern = /\{"name":"CONTACT\/PHONE2?","values":\["([^"]+)"\]\}/g;
  const phoneNoPattern = /\{"id":"phoneNo"[^}]*"value":"([^"]+)"\}/g;
  const phoneNumberPattern = /\{"name":"PHONE_NUMBER","values":\["([^"]+)"\]\}/g;

  Array.from(html.matchAll(contactPhonePattern)).forEach(match => {
    if (match[1]) directNums.push(match[1]);
  });
  Array.from(html.matchAll(phoneNoPattern)).forEach(match => {
    if (match[1]) directNums.push(match[1]);
  });
  Array.from(html.matchAll(phoneNumberPattern)).forEach(match => {
    if (match[1]) directNums.push(match[1]);
  });

  // PRIORITY 2: HTML tel: links
  $('a[href^="tel:"]').each((_: number, a: any) => {
    const href = $(a).attr('href') || '';
    const txt = $(a).text() || '';
    if (href) directNums.push(href.replace(/^tel:/i, ''));
    if (txt) directNums.push(txt);
  });

  const normalizedDirect = directNums
    .map(normalizePhone)
    .filter(n => n.length >= 8 && !isBlockedPhone(n));

  if (normalizedDirect.length > 0) {
    const best = normalizedDirect
      .map(n => ({ n: n.startsWith('43') ? `+${n}` : n, s: scorePhone(n) }))
      .sort((a, b) => b.s - a.s)[0];
    if (best?.n) return best.n;
  }

  // FALLBACK: Regex across HTML
  const htmlNoScripts = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ');
  const candidateRegex = /(?:(?:\+43|0043|43|0)\s*)6[5-9]\s*[\d\s\-/()]{7,12}/g;
  const candidates = (htmlNoScripts.match(candidateRegex) || [])
    .map(normalizePhone)
    .filter(n => n.length >= 8 && !isBlockedPhone(n));

  if (candidates.length === 0) return null;
  const best = candidates
    .map(n => ({ n: n.startsWith('43') ? `+${n}` : n, s: scorePhone(n) }))
    .sort((a, b) => b.s - a.s)[0];
  return best?.n || null;
}

// ============================================
// PRICE EXTRACTION
// ============================================

export function extractPrice($: any, bodyText: string): number {
  const cand = $('span:contains("€"), div:contains("Kaufpreis"), [data-testid*="price"]').text();

  // PRIORITY 1: JSON PRICE attribute (most reliable)
  const jsonPrice = bodyText.match(/"PRICE","values":\["(\d+)"\]/);
  if (jsonPrice) {
    const v = parseInt(jsonPrice[1]);
    if (v >= 50000 && v <= 99999999) return v;
  }

  // PRIORITY 2: Million format (€ X.XXX.XXX)
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

  // Fallback: Standard format (€ XXX.XXX)
  const m1 = cand.match(/€\s*(\d{1,3})\.(\d{3})/);
  if (m1) {
    const v = parseInt(m1[1] + m1[2]);
    if (v >= 50000 && v <= 9999999) return v;
  }
  const m2 = bodyText.match(/€\s*(\d{1,3})\.(\d{3})/);
  if (m2) {
    const v = parseInt(m2[1] + m2[2]);
    if (v >= 50000 && v <= 9999999) return v;
  }

  // Last resort: Any 6-digit number
  const digits = (bodyText.match(/(\d{3}\.\d{3})/g) || [])
    .map(x => parseInt(x.replace('.', '')))
    .find(v => v >= 50000 && v <= 9999999);
  return digits || 0;
}

// ============================================
// AREA EXTRACTION
// ============================================

export function extractArea($: any, bodyText: string): string {
  const m1 = $('span:contains("m²"), div:contains("Wohnfläche")').text().match(/(\d{1,4})\s*m²/i);
  if (m1) return m1[1];
  const m2 = bodyText.match(/(\d{1,3})\s*m²/i);
  return m2?.[1] || '';
}

// ============================================
// TITLE EXTRACTION
// ============================================

export function extractTitle($: any): string {
  const selectors = ['[data-testid="ad-detail-ad-title"] h1', 'h1'];
  for (const s of selectors) {
    const el = $(s);
    if (el.length) return el.text().trim();
  }
  return '';
}

// ============================================
// DESCRIPTION EXTRACTION
// ============================================

export function extractDescription($: any): string {
  // Strategy 1: data-testid attributes (most reliable)
  const t = $('[data-testid="ad-detail-ad-description"], [data-testid="object-description-text"]').text().trim();
  if (t && t.length > 10 && !t.includes('{"props"')) return cleanDescription(t);

  // Strategy 2: Common description selectors
  const commonSelectors = [
    '.description-text',
    '.ad-description',
    '[itemprop="description"]',
    '.object-description',
    '#description',
    'section:has(h2:contains("Beschreibung"))',
    'div:has(h3:contains("Objektbeschreibung"))'
  ];

  for (const sel of commonSelectors) {
    const txt = $(sel).text().trim();
    if (txt && txt.length > 10 && !txt.includes('{"props"')) {
      return cleanDescription(txt);
    }
  }

  // Strategy 3: Find description headers and extract following content
  const headers = $('h2, h3, h4').filter((_: number, el: any) => {
    const text = $(el).text().toLowerCase();
    return text.includes('beschreibung') || text.includes('objektbeschreibung');
  });

  if (headers.length > 0) {
    const header = headers.first();
    let fullText = '';

    // Get all siblings after the header until next header or section
    let current = header.next();
    while (current.length > 0 && !current.is('h2, h3, h4, section')) {
      fullText += ' ' + current.text();
      current = current.next();
    }

    const cleaned = fullText.trim();
    if (cleaned.length > 10) {
      return cleanDescription(cleaned);
    }
  }

  // Strategy 4: Regex fallback (lower minimum to catch short descriptions)
  const all = $('body').text();
  const patterns = [
    /Objektbeschreibung[\s:]*\n?\s*([\s\S]{10,5000}?)(?=\n\s*(?:Kontakt|Ausstattung|Lage|€|Weitere|Services|Rechtlicher|Anbieter))/i,
    /Beschreibung[\s:]*\n?\s*([\s\S]{10,5000}?)(?=\n\s*(?:Kontakt|Ausstattung|Lage|€|Weitere|Services|Rechtlicher|Anbieter))/i,
    /Objektbeschreibung[\s:]*\n?\s*([\s\S]{10,5000})/i,
  ];

  for (const pattern of patterns) {
    const m = all.match(pattern);
    if (m && m[1]) {
      const desc = m[1].trim();
      if (desc.length > 10 && !desc.includes('{"props"')) {
        return cleanDescription(desc);
      }
    }
  }

  return '';
}

function cleanDescription(text: string): string {
  // Clean up common artifacts and cut-off points
  let cleaned = text
    .replace(/Kontakt aufnehmen[\s\S]*/i, '')
    .replace(/Weitere Informationen[\s\S]*/i, '')
    .replace(/Jetzt kontaktieren[\s\S]*/i, '')
    .replace(/Services zu dieser Immobilie[\s\S]*/i, '')
    .replace(/Rechtlicher Hinweis[\s\S]*/i, '')
    .replace(/Kreditrechner[\s\S]*/i, '')
    .replace(/Anbieterdetails[\s\S]*/i, '')
    .replace(/willhaben-Code:[\s\S]*/i, '')
    .replace(/Finanzierungsbeispiel[\s\S]*/i, '')
    .trim();

  // Remove multiple newlines and excessive whitespace
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n').replace(/[ \t]+/g, ' ');

  return cleaned.substring(0, 5000);
}

// ============================================
// LOCATION EXTRACTION
// ============================================

export function extractLocationFromJson(html: string): string {
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

export function extractLocationFromDom($: any, url: string): string {
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

// ============================================
// IMAGE EXTRACTION
// ============================================

export function extractImages($: any, html: string): string[] {
  const images: string[] = [];
  $('img[src*="cache.willhaben.at"]').each((_: number, el: any) => {
    const src = $(el).attr('src');
    if (src && !src.includes('_thumb')) images.push(src);
  });
  (html.match(/https:\/\/cache\.willhaben\.at\/mmo\/[^"'\s]+\.jpg/gi) || []).forEach(u => {
    if (!u.includes('_thumb')) images.push(u);
  });
  return Array.from(new Set(images)).slice(0, 10);
}

// ============================================
// LAST CHANGED EXTRACTION
// ============================================

export function extractLastChanged($: any, html: string): Date | null {
  try {
    const editDateEl = $('[data-testid="ad-detail-ad-edit-date-top"]').text();
    if (editDateEl) {
      const match = editDateEl.match(/(\d{2})\.(\d{2})\.(\d{4}),\s*(\d{2}):(\d{2})/);
      if (match) {
        const [, day, month, year, hour, minute] = match;
        return new Date(parseInt(year), parseInt(month) - 1, parseInt(day), parseInt(hour), parseInt(minute));
      }
    }

    const regexMatch = html.match(/Zuletzt geändert:\s*<!--\s*-->(\d{2})\.(\d{2})\.(\d{4}),\s*(\d{2}):(\d{2})\s*Uhr/);
    if (regexMatch) {
      const [, day, month, year, hour, minute] = regexMatch;
      return new Date(parseInt(year), parseInt(month) - 1, parseInt(day), parseInt(hour), parseInt(minute));
    }

    return null;
  } catch {
    return null;
  }
}

// ============================================
// PUBLISHED DATE EXTRACTION (Willhaben only)
// ============================================

export function extractPublishedDate(html: string): Date | null {
  try {
    // Extract from JSON-LD or embedded data: "publishedDate":"2026-01-20T19:10:00+0100"
    const match = html.match(/"publishedDate"\s*:\s*"([^"]+)"/i);
    if (match) {
      const dateStr = match[1];
      const date = new Date(dateStr);
      if (!isNaN(date.getTime())) {
        return date;
      }
    }

    return null;
  } catch {
    return null;
  }
}

// ============================================
// ISPRIVATE FILTERING
// ============================================

export interface ExtractedListingAttrs {
  filteredUrls: string[];
  totalOnPage: number;
  privateCount: number;
  commercialCount: number;
}

export function extractDetailUrlsWithISPRIVATE(html: string): ExtractedListingAttrs {
  const attributePattern = /\{"name":"([^"]+)","values":\["([^"]*)"\]\}/g;
  const allAttributes = Array.from(html.matchAll(attributePattern));

  const listingData = new Map<number, Map<string, string>>();
  let currentListingIndex = -1;

  for (const attr of allAttributes) {
    const fieldName = attr[1];
    const fieldValue = attr[2];

    if (fieldName === 'ADID') {
      currentListingIndex++;
      listingData.set(currentListingIndex, new Map());
    }

    if (currentListingIndex >= 0) {
      const currentListing = listingData.get(currentListingIndex)!;
      // Only set if not already present (prevents SEO_URL overwriting from child units)
      if (!currentListing.has(fieldName)) {
        currentListing.set(fieldName, fieldValue);
      }
    }
  }

  const totalOnPage = listingData.size;
  let privateCount = 0;
  let commercialCount = 0;
  const filteredUrls: string[] = [];

  for (const [_, attrs] of Array.from(listingData.entries())) {
    const isPrivate = attrs.get('ISPRIVATE');
    const adId = attrs.get('ADID');

    if (isPrivate === '0') {
      commercialCount++;
    } else if (isPrivate === '1') {
      privateCount++;

      const seoUrl = attrs.get('SEO_URL');
      let url: string;

      if (seoUrl) {
        if (seoUrl.startsWith('http')) {
          url = seoUrl;
        } else {
          let cleanUrl = seoUrl.startsWith('/') ? seoUrl : `/${seoUrl}`;
          if (!cleanUrl.startsWith('/iad/')) {
            cleanUrl = cleanUrl.replace(/^\//, '/iad/');
          }
          url = `https://www.willhaben.at${cleanUrl}`;
        }
      } else {
        url = `https://www.willhaben.at/iad/immobilien/d/immobilie/${adId}`;
      }

      filteredUrls.push(url);
    }
  }

  return {
    filteredUrls,
    totalOnPage,
    privateCount,
    commercialCount
  };
}

// ============================================
// LISTING ID EXTRACTION & URL NORMALIZATION
// ============================================

export function extractListingIdFromUrl(url: string): string | null {
  // Match patterns like: /eigentumswohnung/...-1234567/ or /immobilie/1234567
  const match = url.match(/[-\/](\d{7,12})\/?(?:\?|$)/);
  return match ? match[1] : null;
}

/**
 * Detect what changed between old and new listing data
 * Returns a human-readable string like "Preis gesenkt", "Titel", "Beschreibung", etc.
 */
export function detectChangeType(
  existing: { price?: number; title?: string; description?: string | null; area?: string | null; images?: string[] | null },
  newData: { price?: number; title?: string; description?: string | null; area?: string | null; images?: string[] | null }
): string | null {
  const changes: string[] = [];

  // Price change (most important)
  if (existing.price !== newData.price) {
    const oldPrice = existing.price || 0;
    const newPrice = newData.price || 0;
    if (newPrice < oldPrice) {
      changes.push('Preis gesenkt');
    } else {
      changes.push('Preis geändert');
    }
  }

  // Title change
  if (existing.title && newData.title && existing.title !== newData.title) {
    changes.push('Titel');
  }

  // Description change (compare trimmed to avoid whitespace-only changes)
  const oldDesc = (existing.description || '').trim();
  const newDesc = (newData.description || '').trim();
  if (oldDesc !== newDesc && newDesc.length > 0) {
    changes.push('Beschreibung');
  }

  // Area change
  if (existing.area !== newData.area) {
    changes.push('Fläche');
  }

  // Images change
  const oldImages = existing.images?.length || 0;
  const newImages = newData.images?.length || 0;
  if (oldImages !== newImages) {
    changes.push('Bilder');
  }

  if (changes.length === 0) {
    return null;
  }

  return changes.join(', ');
}

/**
 * Normalize Willhaben URL to prevent duplicates
 * - Removes query parameters
 * - Removes trailing slashes
 * - Ensures consistent format: https://www.willhaben.at/iad/.../<ID>
 */
export function normalizeWillhabenUrl(url: string): string {
  // Remove query parameters
  let normalized = url.split('?')[0];

  // Remove trailing slash
  normalized = normalized.replace(/\/+$/, '');

  // Ensure https://www.willhaben.at prefix
  if (normalized.startsWith('//')) {
    normalized = 'https:' + normalized;
  }
  if (!normalized.startsWith('http')) {
    normalized = 'https://www.willhaben.at' + normalized;
  }

  return normalized;
}
