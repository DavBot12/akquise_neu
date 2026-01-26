# ImmoScout24 Scraping Strategy

## Executive Summary

**HUGE WIN:** ImmoScout24 allows filtering private listings BEFORE fetching detail pages via `?isPrivateInsertion=true` URL parameter!

**Performance Impact:**
- DerStandard: Must visit every detail page to check `isPrivateAd` (slow, many wasted requests)
- ImmoScout24: Filter on search page, only visit private listings (fast, efficient)

**Example:** If 90% of listings are commercial:
- DerStandard: 100 detail page visits → 10 private listings (90 wasted)
- ImmoScout24: 100 search results → filter to 10 → 10 detail page visits (0 wasted!)

---

## Data Structure Analysis

### Search Page: `window.__INITIAL_STATE__`

**Location:** `reduxAsyncConnect.pageData.results.hits[]`

**Each hit contains:**

```json
{
  "exposeId": "6928a89502be9d8833f52cc7",
  "links": {
    "targetURL": "/expose/6928a89502be9d8833f52cc7",
    "absoluteURL": "https://www.immobilienscout24.at/expose/6928a89502be9d8833f52cc7"
  },
  "addressString": "Ruthgasse 21, 1190 Wien",
  "headline": "Wunderschöne helle 1 oder 2 Zimmer Altbauwohnung - PRIVAT",
  "isPrivate": true,             // ✓ Already filtered!
  "primaryPrice": 310000,         // ✓ Price directly available
  "primaryArea": 47.5,            // ✓ Area directly available
  "numberOfRooms": 1,             // ✓ Rooms directly available
  "badges": [
    {
      "label": "Provisionsfrei",
      "value": "FREE_OF_COMMISSION"
    }
  ]
}
```

**Pagination:**
```json
{
  "pagination": {
    "totalPages": 4,
    "totalHits": 81,
    "currentURL": "/regional/wien/wien/wohnung-kaufen?isPrivateInsertion=true",
    "nextURL": "/regional/wien/wien/wohnung-kaufen/seite-2?isPrivateInsertion=true",
    "all": [
      "/regional/wien/wien/wohnung-kaufen?isPrivateInsertion=true",
      "/regional/wien/wien/wohnung-kaufen/seite-2?isPrivateInsertion=true",
      "/regional/wien/wien/wohnung-kaufen/seite-3?isPrivateInsertion=true",
      "/regional/wien/wien/wohnung-kaufen/seite-4?isPrivateInsertion=true"
    ]
  }
}
```

**Key Insights:**
- ✓ All listings in `hits[]` are already private (thanks to `isPrivateInsertion=true`)
- ✓ Basic data (price, area, rooms) available without detail page visit
- ✓ Pagination URLs include the filter parameter automatically
- ✓ Search shows 81 total private listings across 4 pages

---

### Detail Page: Structure TBD

**Need to analyze:**
1. Where is description located?
2. Where are images located?
3. Where is phone number (if available)?
4. Are there additional fields we need?

**Next step:** Fetch a detail page and analyze its structure.

---

## Scraper Architecture

### High-Level Flow

```
1. For each category:
   a. Fetch search page 1 (with ?isPrivateInsertion=true)
   b. Extract window.__INITIAL_STATE__
   c. Parse reduxAsyncConnect.pageData.results
   d. For each hit in hits[]:
      - Extract exposeId, targetURL
      - Save basic data (price, area, rooms from search page)
      - Optionally fetch detail page for description/images
   e. Get pagination.nextURL
   f. Repeat for next page until pagination.nextURL is null
```

### Categories to Scrape

```typescript
const categories = {
  'wien-wohnung-kaufen': 'https://www.immobilienscout24.at/regional/wien/wien/wohnung-kaufen?isPrivateInsertion=true',
  'noe-wohnung-kaufen': 'https://www.immobilienscout24.at/regional/niederoesterreich/wohnung-kaufen?isPrivateInsertion=true',
  'noe-haus-kaufen': 'https://www.immobilienscout24.at/regional/niederoesterreich/haus-kaufen?isPrivateInsertion=true',
};
```

### Extraction Strategy

**Option 1: Search Page Only (Fast)**
- Extract all data from search results
- Skip detail page entirely
- **Pros:** Extremely fast, minimal requests
- **Cons:** Missing description, images, phone

**Option 2: Search + Detail (Balanced)**
- Extract basic data from search results (price, area, rooms)
- Fetch detail page for description, images, phone
- **Pros:** Complete data
- **Cons:** More requests (but only for private listings!)

**Recommendation:** Start with Option 2 (search + detail) like Willhaben/DerStandard.

---

## Performance Comparison

### DerStandard Approach
```
Search Page (1 request)
  ↓
Extract 20 listing URLs
  ↓
Fetch 20 detail pages (20 requests)
  ↓
Filter: 18 commercial, 2 private
  ↓
Save 2 listings

Total: 21 requests → 2 results (10% efficiency)
```

### ImmoScout24 Approach
```
Search Page with ?isPrivateInsertion=true (1 request)
  ↓
Extract 20 private listing URLs (already filtered!)
  ↓
Fetch 20 detail pages (20 requests)
  ↓
Save 20 listings

Total: 21 requests → 20 results (95% efficiency)
```

**Speed Estimate:**
- DerStandard 50 pages: ~50 search + 1000 detail = 1050 requests
- ImmoScout24 50 pages: ~50 search + 100 detail = 150 requests (assuming 10% private)

**ImmoScout24 is 7x faster for same number of private listings!**

---

## Implementation Plan

### Phase 1: Fetch & Analyze Detail Page

**Script:** `scripts/fetch_immoscout_detail.ts`

```typescript
import axios from 'axios';
import fs from 'fs';
import { load } from 'cheerio';

const detailUrl = 'https://www.immobilienscout24.at/expose/6928a89502be9d8833f52cc7';
const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

const res = await axios.get(detailUrl, {
  headers: { 'User-Agent': ua }
});

fs.writeFileSync('immoscout_detail_live.html', res.data);

const $ = load(res.data);

// Find window.__INITIAL_STATE__
const scripts = $('script').map((_, el) => $(el).html()).get();
const stateScript = scripts.find(s => s && s.includes('window.__INITIAL_STATE__'));

if (stateScript) {
  const match = stateScript.match(/window\.__INITIAL_STATE__\s*=\s*({.+?});?\s*(?:window\.|<\/script>)/s);
  if (match) {
    const json = match[1].replace(/:\s*undefined/g, ': null');
    const state = JSON.parse(json);
    fs.writeFileSync('immoscout_detail_live_state.json', JSON.stringify(state, null, 2));
  }
}
```

**Analyze:**
1. Where is description?
2. Where are images?
3. Where is phone number?
4. What is the exposeId field structure?

---

### Phase 2: Implement Scraper Service

**File:** `server/services/scraper-immoscout.ts`

**Key Methods:**

```typescript
export class ImmoScout24ScraperService {
  private baseUrls = {
    'wien-wohnung-kaufen': 'https://www.immobilienscout24.at/regional/wien/wien/wohnung-kaufen?isPrivateInsertion=true',
    'noe-wohnung-kaufen': 'https://www.immobilienscout24.at/regional/niederoesterreich/wohnung-kaufen?isPrivateInsertion=true',
    'noe-haus-kaufen': 'https://www.immobilienscout24.at/regional/niederoesterreich/haus-kaufen?isPrivateInsertion=true',
  };

  private async fetchSearchPage(url: string): Promise<string> {
    // Use proxyRequest from scraper-utils
  }

  private extractSearchResults(html: string): {
    hits: Array<{ exposeId: string; targetURL: string; price: number; area: number; rooms: number }>;
    nextPageURL: string | null;
  } {
    // Parse window.__INITIAL_STATE__
    // Extract reduxAsyncConnect.pageData.results.hits
    // Extract reduxAsyncConnect.pageData.results.pagination.nextURL
  }

  private async fetchDetailPage(url: string): Promise<string> {
    // Use proxyRequest from scraper-utils
  }

  private parseDetailPage(html: string, url: string, searchData: any): Listing | null {
    // Parse window.__INITIAL_STATE__
    // Extract description, images, phone
    // Merge with search data (price, area, rooms)
    // Return complete listing
  }

  private async runCycle(options: ScraperOptions): Promise<void> {
    for (const [key, baseUrl] of Object.entries(this.baseUrls)) {
      let nextPageURL: string | null = baseUrl;
      let page = 1;

      while (nextPageURL && page <= options.maxPages) {
        // Fetch search page
        const html = await this.fetchSearchPage(nextPageURL);

        // Extract results
        const { hits, nextPageURL: next } = this.extractSearchResults(html);

        // Process each hit
        for (const hit of hits) {
          const detailUrl = `https://www.immobilienscout24.at${hit.targetURL}`;

          // Fetch detail page
          const detailHtml = await this.fetchDetailPage(detailUrl);

          // Parse and save
          const listing = this.parseDetailPage(detailHtml, detailUrl, hit);
          if (listing) {
            await options.onListingFound?.(listing);
          }

          await sleep(withJitter(60, 60)); // 60ms ± 60ms
        }

        nextPageURL = next;
        page++;

        await sleep(withJitter(200, 100)); // 200ms ± 100ms
      }
    }
  }
}
```

---

### Phase 3: Integration

**Routes:** `server/routes.ts`

```typescript
import { ImmoScout24ScraperService } from './services/scraper-immoscout';

const immoScoutScraper = new ImmoScout24ScraperService();

app.post('/api/scraper/immoscout/start', async (req, res) => {
  const { maxPages = 3, intervalMinutes = 30 } = req.body;

  await immoScoutScraper.start({
    maxPages,
    intervalMinutes,
    onLog: (msg) => io?.emit('scraper-log', msg),
    onListingFound: async (listing) => {
      await storage.createListing(listing);
      io?.emit('new-listing', listing);
    },
  });

  res.json({ status: 'started' });
});

app.post('/api/scraper/immoscout/stop', (req, res) => {
  immoScoutScraper.stop();
  res.json({ status: 'stopped' });
});
```

**UI:** `client/src/components/scraper-dual-console.tsx`

Add ImmoScout24 to scraper source dropdown and categories.

---

## Expected Results

**Vienna Apartments (wien-wohnung-kaufen):**
- Search page shows: 81 total private listings across 4 pages
- Expected: ~81 listings saved after scraping 4 pages

**Lower Austria Apartments (noe-wohnung-kaufen):**
- TBD (need to check search page)

**Lower Austria Houses (noe-haus-kaufen):**
- TBD (need to check search page)

---

## Next Steps

1. ✅ Analyzed search page structure
2. ⏳ Fetch and analyze detail page structure
3. ⏳ Document detail page field mapping
4. ⏳ Implement scraper service
5. ⏳ Add routes and UI integration
6. ⏳ Test with live data

---

## Key Advantages vs DerStandard

| Feature | DerStandard | ImmoScout24 |
|---------|-------------|-------------|
| **Private filter on search** | ❌ No | ✅ Yes (`?isPrivateInsertion=true`) |
| **Efficiency** | ~10% (many commercial) | ~95% (pre-filtered) |
| **Requests for 100 private** | ~1000 detail pages | ~100 detail pages |
| **Speed** | Baseline | **7-10x faster** |
| **Basic data in search** | ❌ No | ✅ Yes (price, area, rooms) |
| **Clean JSON structure** | ❌ No (unicode-escaped chunks) | ✅ Yes (window.__INITIAL_STATE__) |

**Verdict:** ImmoScout24 is the DREAM platform for private listing scraping! 🎉
