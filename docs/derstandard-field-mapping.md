# DerStandard Field Mapping - Analysis Results

**Generated:** 2026-01-20
**Source:** Live fetching from immobilien.derstandard.at

---

## Search Page Structure

### URL Patterns
- **Base Search:** `https://immobilien.derstandard.at/suche/{region}/{action}-{category}`
- **Examples:**
  - Wien Kaufen Wohnung: `/suche/wien/kaufen-wohnung`
  - Wien Mieten Wohnung: `/suche/wien/mieten-wohnung`
  - NÖ Kaufen Wohnung: `/suche/niederoesterreich/kaufen-wohnung`
  - NÖ Kaufen Haus: `/suche/niederoesterreich/kaufen-haus`

### Pagination
- **Pattern:** Append `?p={pageNumber}` to base URL
- **Examples:**
  - Page 1: `...kaufen-wohnung` (no param)
  - Page 2: `...kaufen-wohnung?p=2`
  - Page 3: `...kaufen-wohnung?p=3`

### Listing Links Extraction
- **Selector:** `a[href*="/detail/"]`
- **Found:** 36 unique listing URLs on page 1
- **URL Patterns:**
  1. Standard: `/detail/{id}` (e.g., `/detail/14692813`)
  2. Neubau: `/immobiliensuche/neubau/detail/{id}`

**Note:** Both patterns point to same listing, use `/detail/{id}` for consistency

### Embedded Data
- **28 JavaScript blocks** found in search page
- Most contain tracking/analytics code
- **No embedded listing data in search page** (unlike Justimmo)
- Must fetch each detail page individually

---

## Detail Page Structure

### DataLayer Fields (JavaScript Extraction)

**Extraction Pattern:**
```javascript
putPropertyToObjectIfNotEmpty(dataLayerObject, "{fieldName}", "{value}")
```

**Available Fields:**

| Field | Example Value | Type | Purpose |
|-------|---------------|------|---------|
| `objectRentBuy` | "Buy" | string | Rent vs Buy classification |
| `objectLocationName` | "Wien" | string | City name |
| `objectPLZ` | "AT-1220" | string | Postal code (with "AT-" prefix) |
| `objectRegion` | "Wien" | string | Region (redundant with location) |
| `objectPrice` | "394900,00 - 5903000,00" | string | Price (range for projects) |
| `objectSize` | "33 - 373" | string | Area in m² (range for projects) |
| `objectRooms` | "1 - 6" | string | Room count (range for projects) |
| `objectType` | "Private_Project" | string | **CRITICAL for filtering** |
| `objectCompany` | "IMMOcontract GmbH" | string | **CRITICAL for filtering** |
| `objectTitle` | "DANUBEFLATS in 1220 Wien" | string | Listing title |

### Data Extraction Strategy

**Price Handling:**
- Single listing: `"450000,00"` → 450000
- Project range: `"394900,00 - 5903000,00"` → 394900 (take first/min)
- Use existing `extractPrice()` from scraper-utils.ts

**Area Handling:**
- Single listing: `"65"` → 65
- Project range: `"33 - 373"` → 33 (take first/min)
- Parse: Split on `-`, take first number

**Location Handling:**
- PLZ: Remove "AT-" prefix → `"1220"`
- Combine: `{PLZ} {City}` → `"1220 Wien"`

**Rooms:**
- Optional field
- Split on `-`, take first number
- Default: 0 if missing

---

## Private vs Commercial Detection

### Filter Pipeline (6 Stages)

#### Stage 1: objectType - Hard Blocks

| Value | Decision | Reason | Confidence |
|-------|----------|--------|------------|
| `"Private_Project"` | **BLOCK** | New construction project (always commercial) | HIGH |
| `"Agency"` | **BLOCK** | Real estate agency | HIGH |

#### Stage 2: objectType - Allow

| Value | Decision | Conditions | Confidence |
|-------|----------|------------|------------|
| `"Private"` | **ALLOW** | Body text must NOT contain provision keywords | HIGH |

**Provision Keywords (block if found):**
- "provision: 3"
- "provision 3%"
- "nettoprovision"
- "provisionsaufschlag"

#### Stage 3: objectCompany - Commercial

**Block if company name contains:**
- `gmbh`
- `immobilien`
- `makler`
- `agentur`
- `real estate`
- `partners`
- `group`
- `sivag`
- `bauträger`
- `immo`

#### Stage 4: objectCompany - Private

**Allow if company name equals:**
- `"privat"` (case-insensitive)
- `"private"` (case-insensitive)

#### Stage 5: Body Text - Commercial Keywords

**Block if body contains:**
- "provision: 3"
- "provision 3%"
- "nettoprovision"
- "provisionsaufschlag"

#### Stage 6: Body Text - Private Keywords

**Allow if body contains:**
- "von privat"
- "privatverkauf"
- "ohne makler"
- "privater verkäufer"
- "verkaufe privat"

#### Default: BLOCK (Conservative Approach)

If none of the above conditions match → **BLOCK**

**Rationale:**
DerStandard has far fewer private listings than Willhaben. Better to miss a few private listings than include commercial ones.

---

## Phone Number Extraction

### Patterns Found

**Test Result:** 2 phone numbers found in detail page

**Austrian Phone Formats:**
- Mobile: `+43 6XX XXX XXXX` or `06XX XXX XXXX`
- Landline: `+43 X XXX XXXX` or `0X XXX XXXX`

**Extraction Strategy:**
1. Use `extractPhoneFromHtml()` from scraper-utils.ts (supports multiple patterns)
2. Validates against blocked number list
3. Normalizes format

---

## Additional Fields (DOM-Based)

### Description
- **Selector:** `meta[name="description"]` or main content area
- **Fallback:** Body text extraction
- **Max Length:** 1000 chars

### Images
- **Location:** `<img>` tags in gallery
- **Pattern:** URLs containing `derstandard.at` or `staticfiles.at`
- **Note:** Fewer images in commercial listings

---

## Sample Data (From Fetched Page)

```json
{
  "objectRentBuy": "Buy",
  "objectLocationName": "Wien",
  "objectPLZ": "AT-1220",
  "objectRegion": "Wien",
  "objectPrice": "394900,00 - 5903000,00",
  "objectSize": "33 - 373",
  "objectRooms": "1 - 6",
  "objectType": "Private_Project",
  "objectCompany": "IMMOcontract Immobilien Vermittlung GmbH",
  "objectTitle": "DANUBEFLATS in 1220 Wien"
}
```

**Filter Result:** BLOCK (Neubau - objectType = "Private_Project")

---

## Implementation Notes

### Scraper Flow

```
1. Fetch Search Page
   ├── Extract all /detail/{id} URLs
   └── No embedded data → must fetch details

2. For each Detail URL:
   ├── Fetch HTML
   ├── Extract dataLayer props (regex)
   ├── Run Filter Pipeline (6 stages)
   ├── If ALLOW:
   │   ├── Parse price (handle ranges)
   │   ├── Parse area (handle ranges)
   │   ├── Parse location (remove AT- prefix)
   │   ├── Extract phone (scraper-utils)
   │   └── Save to DB
   └── If BLOCK: Log reason + continue

3. Performance:
   ├── Session management (refresh every 50 requests)
   ├── Delays: 60-120ms between details
   └── Pagination state (DB persistence)
```

### Key Differences from Willhaben

| Aspect | Willhaben | DerStandard |
|--------|-----------|-------------|
| **Search Page Data** | JSON embedded | None - must fetch details |
| **Private Indicator** | `ISPRIVATE=1` field | `objectType` + `objectCompany` |
| **Filter Reliability** | Very high (dedicated field) | Medium (multi-stage heuristic) |
| **Private Listings** | ~40% of all listings | ~5-10% (estimate) |
| **Data Source** | HTML attributes | JavaScript dataLayer |

### Expected Performance

- **Search Page:** ~30ms fetch time
- **Detail Page:** ~40ms fetch time
- **Full Cycle (4 categories × 3 pages × ~30 details):** ~45-60 seconds
- **Private Listings Found:** ~5-15 per cycle (estimate)

---

## Testing Checklist

- [x] Search page fetch works
- [x] Detail URLs extracted correctly
- [x] DataLayer props extracted
- [x] Filter logic designed
- [ ] Test extraction script
- [ ] Full scraper implementation
- [ ] Live integration test
- [ ] Filter accuracy validation

---

## References

- Live Search: https://immobilien.derstandard.at/suche/wien/kaufen-wohnung
- Sample Detail: https://immobilien.derstandard.at/detail/14692813
- Fetch Scripts: `scripts/fetch_derstandard_*.ts`
- Data Files: `derstandard_*.html`, `derstandard_*.json`
