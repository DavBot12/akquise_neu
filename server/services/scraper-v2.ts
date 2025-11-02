import axios from 'axios';
import { load } from 'cheerio';

export type ScraperV2Options = {
  categories: string[];
  regions: string[];
  maxPages: number;
  baseDelayMs?: number; // base delay between requests
  jitterMs?: number; // additional random jitter
  onLog?: (msg: string) => void;
  onDiscoveredLink?: (payload: { url: string; category?: string; region?: string }) => void;
  onPhoneFound?: (payload: { url: string; phone: string }) => void;
  onListingFound?: (listing: any) => Promise<void>;
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function withJitter(base: number, jitter: number) {
  const offset = Math.floor(Math.random() * jitter);
  return base + offset;
}

export class ScraperV2Service {
  private stopping = false;

  // Align with legacy mapping (worked reliably)
  private readonly WILLHABEN_URLS: Record<string, string> = {
    'eigentumswohnung-wien': 'https://www.willhaben.at/iad/immobilien/eigentumswohnung/eigentumswohnung-angebote/wien?sort=1',
    'grundstueck-wien': 'https://www.willhaben.at/iad/immobilien/grundstueck/grundstueck-angebote/wien?sort=1',
    'grundstuecke-wien': 'https://www.willhaben.at/iad/immobilien/grundstueck/grundstueck-angebote/wien?sort=1',
    'eigentumswohnung-niederoesterreich': 'https://www.willhaben.at/iad/immobilien/eigentumswohnung/eigentumswohnung-angebote/niederoesterreich?sort=1',
    'grundstueck-niederoesterreich': 'https://www.willhaben.at/iad/immobilien/grundstueck/grundstueck-angebote/niederoesterreich?sort=1',
    'grundstuecke-niederoesterreich': 'https://www.willhaben.at/iad/immobilien/grundstueck/grundstueck-angebote/niederoesterreich?sort=1',
  };

  stop() {
    this.stopping = true;
  }

  async start(options: ScraperV2Options) {
    const {
      categories,
      regions,
      maxPages,
      baseDelayMs = 800,
      jitterMs = 700,
      onLog,
      onDiscoveredLink,
      onPhoneFound,
      onListingFound,
    } = options;

    const log = (m: string) => onLog?.(`[V2] ${m}`);

    for (const category of categories) {
      for (const region of regions) {
        if (this.stopping) return;
        const key = `${category}-${region}`;
        const baseUrl = this.WILLHABEN_URLS[key];
        if (!baseUrl) {
          log?.(`Überspringe unbekannte Kombination: ${key}`);
          continue;
        }
        log?.(`Scan start: ${key}`);

        for (let page = 1; page <= maxPages; page++) {
          if (this.stopping) return;

          const url = page === 1 ? baseUrl : `${baseUrl}&page=${page}`;
          try {
            const res = await axios.get(url, {
              headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept-Language': 'de-AT,de;q=0.9,en;q=0.8',
              },
              timeout: 15000,
            });

            const html = res.data as string;
            const links = this.extractLinksWithCheerio(html);
            log?.(`Seite ${page}: ${links.length} Links gefunden`);

            // Listings wie im alten Scraper extrahieren (nur private, basic Felder)
            const listings = this.extractPrivateListings(html, `${category}-${region}`);
            if (listings.length > 0) {
              log?.(`Seite ${page}: ${listings.length} private Listings extrahiert`);
              for (const listing of listings) {
                try {
                  if (onListingFound) await onListingFound(listing);
                  await sleep(withJitter(50, 100));
                } catch (e) {
                  // ignore save errors to continue
                }
              }
            }

            for (const link of links) {
              if (this.stopping) return;
              onDiscoveredLink?.({ url: link, category, region });
              // kleine Wartezeit zwischen einzelnen saves, um WS/DB zu schonen
              await sleep(withJitter(80, 150));

              // Detailseite laden und Telefonnummer extrahieren
              try {
                const detail = await axios.get(link, {
                  headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept-Language': 'de-AT,de;q=0.9,en;q=0.8',
                  },
                  timeout: 15000,
                });
                const phone = this.extractPhone(detail.data);
                if (phone) {
                  onPhoneFound?.({ url: link, phone });
                  // kleine Pause nach Phone-Fund
                  await sleep(withJitter(60, 120));
                }
              } catch (e: any) {
                log?.(`Detail-Laden fehlgeschlagen: ${e?.message || e}`);
              }
            }
          } catch (e: any) {
            log?.(`Fehler bei Seite ${page}: ${e?.message || e}`);
          }

          // anti-ban Delay zwischen Seiten
          await sleep(withJitter(baseDelayMs, jitterMs));
        }

        log?.(`Scan fertig: ${category} / ${region}`);
        // kleine Pause zwischen Regionen
        await sleep(withJitter(500, 500));
      }
      // kleine Pause zwischen Kategorien
      await sleep(withJitter(800, 600));
    }
  }

  private extractLinksWithCheerio(html: string): string[] {
    const $ = load(html);
    const links = new Set<string>();
    
    // Primärer Selektor wie im alten Scraper (article cards)
    $('article[data-testid*="search-result-entry"] a[href]').each((_: any, el: any) => {
      const href = $(el).attr('href');
      if (!href) return;
      if (!/\/iad\//.test(href)) return; // nur Willhaben-Links
      const full = href.startsWith('http') ? href : `https://www.willhaben.at${href}`;
      links.add(full);
    });
    
    // Fallback: alle a[href*="/iad/immobilien/"]
    if (links.size === 0) {
      $('a[href*="/iad/immobilien/"]').each((_: any, el: any) => {
        const href = $(el).attr('href');
        if (!href) return;
        const full = href.startsWith('http') ? href : `https://www.willhaben.at${href}`;
        links.add(full);
      });
    }
    
    return Array.from(links);
  }

  private extractPrivateListings(html: string, key: string): any[] {
    const $ = load(html);
    const results: any[] = [];

    const isWohnung = key.includes('eigentumswohnung');
    const region = key.includes('wien') ? 'wien' : (key.includes('niederoesterreich') ? 'niederoesterreich' : 'wien');
    const category = isWohnung ? 'eigentumswohnung' : 'grundstueck';

    // Cards
    const cards = $('article[data-testid*="search-result-entry"], div[data-testid*="search-result-entry"]');
    cards.each((_, el) => {
      const card = $(el);
      const text = card.text().toLowerCase();

      // Commercial blacklist
      const isCommercial = /(remax|century\s*21|engel\s*&\s*vö|engel\s*&\s*vo|s\s*real|immo|makler|immobilien gmbh|kws immobilien)/i.test(text);
      if (isCommercial) return;

      // Private indicators
      const isPrivate = /(privat|privatverkauf|kein\s*makler|ohne\s*makler|direkt\s*vom\s*eigentümer|eigentümer|privatanbieter)/i.test(text);
      if (!isPrivate) return;

      // URL
      let url = card.find('a[href*="/iad/"]').attr('href') || '';
      if (url && !url.startsWith('http')) url = `https://www.willhaben.at${url}`;
      if (!url) return;

      // Title
      const title = (card.find('h3, h2, a[title]').first().text() || '').trim();

      // Price
      const priceMatch = (card.text().match(/€\s*([\d\.\,]+)/) || [])[1];
      const price = priceMatch ? parseInt(priceMatch.replace(/[\.,]/g, '')) : 0;
      if (!title || !price) return;

      // Area (m²)
      const areaMatch = (card.text().match(/([\d\.,]+)\s*m²/i) || [])[1];
      const area = areaMatch ? parseFloat(areaMatch.replace(',', '.')) : 0;
      const eur_per_m2 = area > 0 ? Math.round(price / area) : 0;

      // Images (first 3)
      const images: string[] = [];
      card.find('img').slice(0,3).each((__, img) => {
        const src = $(img).attr('src');
        if (src && /^https?:\/\//.test(src)) images.push(src);
      });

      results.push({
        title,
        price,
        location: '',
        area: area ? String(area) : null,
        eur_per_m2: eur_per_m2 ? String(eur_per_m2) : null,
        description: '',
        images,
        url,
        scraped_at: new Date().toISOString(),
        akquise_erledigt: false,
        price_evaluation: 'im_schnitt',
        category,
        region,
      });
    });

    return results;
  }

  private extractPhone(html: string): string | null {
    // 1) Willhaben kann Telefonnummern als reinen Text oder formatiert anzeigen.
    // 2) Österreichische Nummern: beginnen oft mit 0 oder +43, enthalten Leerzeichen/Trennzeichen.
    // 3) Wir normalisieren auf Ziffern, behalten führendes + bei.

    // Engere Regex für Kandidaten (inkl. +43 oder 0, mind. 8 Ziffern):
    const candidateRegex = /(?:\+43|0)[\s\-/()]*\d(?:[\s\-/()]*\d){7,12}/g;
    const candidates = html.match(candidateRegex) || [];
    if (candidates.length === 0) return null;

    const normalize = (s: string) => s.replace(/[^+\d]/g, '');
    // bevorzugt +43… oder mobil (06…)
    const scored = candidates.map(c => {
      const n = normalize(c);
      let score = 0;
      if (n.startsWith('+43')) score += 3;
      if (n.startsWith('06')) score += 2; // Mobilfunk
      if (n.length >= 10) score += 1; // plausibel
      return { raw: c, norm: n, score };
    }).sort((a,b)=>b.score - a.score);

    return scored[0]?.norm || null;
  }
}
