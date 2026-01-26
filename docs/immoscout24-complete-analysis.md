# ImmoScout24 - Complete Scraping Analysis

## 🎉 SUMMARY: ImmoScout24 is PERFECT for Private Listing Scraping!

### Why ImmoScout24 is Superior

| Feature | DerStandard | ImmoScout24 |
|---------|-------------|-------------|
| **Pre-filter private on search** | ❌ No | ✅ YES (`?isPrivateInsertion=true`) |
| **Data extraction method** | Unicode-escaped chunks | Clean JSON-LD |
| **Images in detail page** | ✅ JSON array | ✅ JSON-LD array (17 images!) |
| **Description quality** | ✅ Unicode-escaped | ✅ Full HTML in JSON-LD |
| **Efficiency** | ~10% (many commercial) | ~95% (pre-filtered) |
| **Performance** | Must check every listing | Only fetch private listings |

**Speed Comparison:**
- To get 100 private listings:
  - DerStandard: ~1000 detail page requests (90% wasted)
  - ImmoScout24: ~100 detail page requests (0% wasted)
- **ImmoScout24 is 10x faster!**

---

## Data Structure

### Search Page: `window.__INITIAL_STATE__`

**URL Example:**
```
https://www.immobilienscout24.at/regional/wien/wien/wohnung-kaufen?isPrivateInsertion=true
```

**Data Location:** `reduxAsyncConnect.pageData.results`

**Structure:**
```json
{
  "totalHits": 81,
  "pagination": {
    "totalPages": 4,
    "pageIndex": 0,
    "currentURL": "/regional/wien/wien/wohnung-kaufen?isPrivateInsertion=true",
    "nextURL": "/regional/wien/wien/wohnung-kaufen/seite-2?isPrivateInsertion=true",
    "all": [
      "/regional/wien/wien/wohnung-kaufen?isPrivateInsertion=true",
      "/regional/wien/wien/wohnung-kaufen/seite-2?isPrivateInsertion=true",
      "/regional/wien/wien/wohnung-kaufen/seite-3?isPrivateInsertion=true",
      "/regional/wien/wien/wohnung-kaufen/seite-4?isPrivateInsertion=true"
    ]
  },
  "hits": [
    {
      "exposeId": "6928a89502be9d8833f52cc7",
      "links": {
        "targetURL": "/expose/6928a89502be9d8833f52cc7",
        "absoluteURL": "https://www.immobilienscout24.at/expose/6928a89502be9d8833f52cc7"
      },
      "headline": "Wunderschöne helle 1 oder 2 Zimmer Altbauwohnung - PRIVAT",
      "addressString": "Ruthgasse  21, 1190 Wien",
      "isPrivate": true,
      "primaryPrice": 310000,
      "primaryArea": 47.5,
      "numberOfRooms": 1,
      "badges": [
        {
          "label": "Provisionsfrei",
          "value": "FREE_OF_COMMISSION"
        }
      ]
    }
  ]
}
```

**Key Points:**
- ✅ `isPrivate: true` already filtered (all hits are private!)
- ✅ Basic data (price, area, rooms) available WITHOUT detail page visit
- ✅ Clean pagination with `nextURL`
- ✅ `totalHits` tells us exactly how many private listings exist

---

### Detail Page: JSON-LD Structured Data

**URL Example:**
```
https://www.immobilienscout24.at/expose/6928a89502be9d8833f52cc7
```

**Data Location:** `<script type="application/ld+json">` with `@type: "Product"`

**Full Structure:**
```json
{
  "@context": "https://schema.org",
  "@type": "Product",
  "name": "Wunderschöne helle 1 oder 2 Zimmer Altbauwohnung - PRIVAT",
  "image": [
    "https://pictures.immobilienscout24.de/prod.www.immobilienscout24.at/pictureserver/loadPicture?q=70&id=012.0010J00002BV6WY-df0fdd31124647ab8075fcd315168dd4",
    "https://pictures.immobilienscout24.de/prod.www.immobilienscout24.at/pictureserver/loadPicture?q=70&id=012.0010J00002BV6WY-d0cdbde1161d41f596bd6e47e6b83fc8",
    ... (17 total images)
  ],
  "description": "Wohnen und Arbeiten in bester Lage des 19. Bezirks<br /><br />Zum Privatverkauf gelangt eine lichtdurchflutete 1-Zimmer-Wohnung...",
  "offers": {
    "@type": "Offer",
    "url": "https://www.immobilienscout24.at/expose/6928a89502be9d8833f52cc7",
    "priceCurrency": "EUR",
    "price": 310000,
    "availability": "https://schema.org/InStock"
  }
}
```

**Extraction Method:**
```typescript
import { load } from 'cheerio';

const $ = load(html);

// Find the Product JSON-LD
$('script[type="application/ld+json"]').each((_, el) => {
  const json = JSON.parse($(el).html() || '{}');

  if (json['@type'] === 'Product') {
    const title = json.name;
    const description = json.description; // Full HTML description!
    const images = json.image; // Array of all image URLs
    const price = json.offers?.price;
    // ...
  }
});
```

**Key Points:**
- ✅ Clean, standard JSON-LD format (no Unicode escaping needed!)
- ✅ Description includes HTML (`<br />`) - easy to strip or keep
- ✅ ALL images in one array (17 images in example)
- ✅ Price confirms search page data

---

## Field Mapping to Our Schema

| Our Field | ImmoScout24 Source | Example |
|-----------|-------------------|---------|
| **source** | Static | `'immoscout'` |
| **title** | Product JSON-LD: `name` | "Wunderschöne helle..." |
| **description** | Product JSON-LD: `description` | Full HTML text |
| **price** | Search: `primaryPrice` OR Product: `offers.price` | `310000` |
| **area** | Search: `primaryArea` | `47.5` |
| **rooms** | Search: `numberOfRooms` | `1` |
| **location** | Search: `addressString` | "Ruthgasse 21, 1190 Wien" |
| **url** | Search: `links.absoluteURL` | Full URL |
| **photos** | Product JSON-LD: `image` (array) | `["https://...", ...]` |
| **phone** | ❓ TBD (might not be available) | - |
| **isPrivate** | Search: `isPrivate` | `true` |
| **datePosted** | RealEstateListing JSON-LD: `datePosted` | "2025-11-27T19:37:57.000Z" |

**Notes:**
- Phone number might not be available in public HTML (anti-scraping)
- Could extract from contact form or phone reveal button if needed
- All other fields are easily available!

---

## Scraper Implementation Strategy

### Architecture

```typescript
export class ImmoScout24ScraperService {
  private baseUrls = {
    'wien-wohnung-kaufen': 'https://www.immobilienscout24.at/regional/wien/wien/wohnung-kaufen?isPrivateInsertion=true',
    'noe-wohnung-kaufen': 'https://www.immobilienscout24.at/regional/niederoesterreich/wohnung-kaufen?isPrivateInsertion=true',
    'noe-haus-kaufen': 'https://www.immobilienscout24.at/regional/niederoesterreich/haus-kaufen?isPrivateInsertion=true',
  };

  async runCycle(options: ScraperOptions): Promise<void> {
    for (const [key, baseUrl] of Object.entries(this.baseUrls)) {
      let currentUrl: string | null = baseUrl;

      while (currentUrl) {
        // 1. Fetch search page
        const searchHtml = await this.fetchPage(currentUrl);

        // 2. Extract window.__INITIAL_STATE__
        const searchData = this.extractSearchState(searchHtml);

        // 3. Process each hit
        for (const hit of searchData.hits) {
          const detailUrl = hit.links.absoluteURL;

          // 4. Fetch detail page
          const detailHtml = await this.fetchPage(detailUrl);

          // 5. Extract JSON-LD Product data
          const productData = this.extractProductJsonLd(detailHtml);

          // 6. Merge search + detail data
          const listing = this.buildListing(hit, productData, detailUrl);

          // 7. Save listing
          await options.onListingFound?.(listing);

          // 8. Delay between detail pages
          await sleep(withJitter(60, 60)); // 60ms ± 60ms
        }

        // 9. Get next page URL
        currentUrl = searchData.pagination.nextURL;

        // 10. Delay between search pages
        await sleep(withJitter(200, 100)); // 200ms ± 100ms
      }
    }
  }

  private extractSearchState(html: string): SearchData {
    // Find window.__INITIAL_STATE__
    const match = html.match(/window\.__INITIAL_STATE__\s*=\s*({.+?});/s);
    if (!match) return { hits: [], pagination: { nextURL: null } };

    // Replace undefined with null
    const json = match[1].replace(/:\s*undefined/g, ': null');
    const state = JSON.parse(json);

    return state.reduxAsyncConnect?.pageData?.results || { hits: [], pagination: { nextURL: null } };
  }

  private extractProductJsonLd(html: string): ProductData | null {
    const $ = load(html);

    // Find Product JSON-LD
    const scripts = $('script[type="application/ld+json"]').map((_, el) => $(el).html()).get();

    for (const script of scripts) {
      try {
        const json = JSON.parse(script || '{}');
        if (json['@type'] === 'Product') {
          return {
            title: json.name,
            description: json.description?.replace(/<br\s*\/?>/g, '\n'), // Convert <br /> to newlines
            images: Array.isArray(json.image) ? json.image : [json.image],
            price: json.offers?.price,
          };
        }
      } catch (e) {}
    }

    return null;
  }

  private buildListing(hit: SearchHit, product: ProductData | null, url: string): Listing {
    return {
      source: 'immoscout',
      title: product?.title || hit.headline,
      description: product?.description || null,
      price: hit.primaryPrice,
      area: hit.primaryArea,
      rooms: hit.numberOfRooms,
      location: hit.addressString,
      url,
      photos: product?.images || [],
      isPrivate: true, // Always true because of URL filter!
      // phone: null, // Not available in public HTML
    };
  }
}
```

---

## Performance Estimates

### Vienna Apartments Example

**Search shows:** 81 private listings across 4 pages

**Scraping 4 pages:**
- 4 search page requests
- 81 detail page requests
- **Total: 85 requests → 81 listings saved (95% efficiency)**

**Time estimate:**
- Search pages: 4 × 200ms = 800ms
- Detail pages: 81 × 60ms = 4,860ms
- **Total: ~6 seconds for all 81 private listings!**

Compare to DerStandard:
- To get 81 private listings from DerStandard (assuming 10% hit rate)
- Would need ~810 detail page requests
- Time: ~810 × 160ms = ~130 seconds
- **ImmoScout24 is 20x faster!**

---

## Implementation Checklist

- [ ] Create `server/services/scraper-immoscout.ts`
- [ ] Implement `extractSearchState()` method
- [ ] Implement `extractProductJsonLd()` method
- [ ] Implement `buildListing()` method
- [ ] Add routes in `server/routes.ts`
- [ ] Add UI integration in `client/src/components/scraper-dual-console.tsx`
- [ ] Update schema to include `'immoscout'` source
- [ ] Test with live data
- [ ] Compare results with DerStandard

---

## Expected Hit Rates

**Based on Vienna search:**
- Wien Wohnungen: 81 private listings (4 pages)
- Assuming similar density: ~20 private listings per page

**Categories:**
1. Wien Wohnungen kaufen: ~80-100 listings
2. NÖ Wohnungen kaufen: TBD
3. NÖ Häuser kaufen: TBD

**Total expected:** 100-300 private listings across all categories

---

## Next Steps

1. ✅ Search page analysis complete
2. ✅ Detail page analysis complete
3. ⏳ Implement scraper service
4. ⏳ Add routes and UI
5. ⏳ Test and compare with DerStandard

---

## Conclusion

**ImmoScout24 is the DREAM platform for private listing scraping:**
- ✅ Pre-filtered search with `?isPrivateInsertion=true`
- ✅ Clean JSON-LD structured data
- ✅ All images in one array
- ✅ Full description without Unicode escaping
- ✅ 10-20x faster than DerStandard
- ✅ Near-perfect efficiency (95% vs 10%)

**Recommended priority:** Implement ImmoScout24 scraper NEXT - it will provide the best ROI!
