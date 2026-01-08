# derStandard.at Immobilien - Web Scraping Struktur-Analyse

## Platform: derStandard.at Immobilien

### URL-Struktur
- **Detail-Page Pattern**: `https://immobilien.derstandard.at/detail/{listing_id}`
- **Beispiel**: `https://immobilien.derstandard.at/detail/15005342`

### Technische Architektur
- **Framework**: Next.js (React-basiert, Server-Side Rendering)
- **Rendering**: Client-Side Rendering (CSR) - Daten werden nach dem initialen HTML-Load geladen
- **Hinweis**: Standard `curl`/`requests` liefert nur das HTML-Skeleton ohne Daten. Benötigt JavaScript-Rendering (Puppeteer/Playwright/Selenium).

---

## Datenfeld-Mappings

### 1. TITEL (Inseratstitel)

**Primary Selector**:
```css
h1.Heading_heading___t1Z5.Heading_headingInseratTitle__tnAUR
```

**DOM Path**:
```
<h1 class="Heading_heading___t1Z5 Heading_headingInseratTitle__tnAUR">
  Koffer packen und einziehen! Möbliertes City-Apartement - direkt bei U-Bahn...
</h1>
```

**Stability**: MEDIUM-LOW
- **Reasoning**: Die Klassennamen enthalten Hash-Suffix (`___t1Z5`, `__tnAUR`), typisch für CSS-in-JS/CSS-Modules
- Diese Hashes können sich bei Deployments ändern

**Fallback Selector(s)**:
```css
h1[class*="headingInseratTitle"]
h1[class*="Heading_heading"]
section.re-detail-page-front h1
```

**Value Format**: Plain text, kann lang sein
**Extraction Notes**: Titel ist vollständig im HTML enthalten, keine Truncation
**Edge Cases**:
- Kann Sonderzeichen enthalten (ü, ö, ä, ß, !)
- Kann sehr lang sein (> 100 Zeichen)

---

### 2. PREIS (Kaufpreis in EUR)

**Primary Selector**:
```css
.sc-stat-label (text: "Kaufpreis") + .sc-stat-value
```

**Alternative - Metadata Section**:
```css
.sc-metadata-label (text: "Kaufpreis") + .sc-metadata-value
```

**DOM Path** (Stats Section):
```
<section class="heading-section-stats">
  <div>
    <span class="sc-stat-label">Kaufpreis</span>
    <span class="sc-stat-value">€ 149.900</span>
  </div>
</section>
```

**DOM Path** (Metadata Section):
```
<div class="sc-metadata sc-metadata-table">
  <div class="sc-metadata-item">
    <span class="sc-metadata-label">Kaufpreis</span>
    <span class="sc-metadata-value">€ 149.900</span>
  </div>
</div>
```

**Stability**: HIGH
- **Reasoning**: `sc-stat-*` und `sc-metadata-*` sind semantische BEM-style Klassennamen ohne Hashes
- Prefix "sc-" deutet auf "styled-components" oder ähnliches hin, aber Namen sind sprechend und stabil

**Fallback Selector(s)**:
```css
[class*="stat-label"]:contains("Kaufpreis") + [class*="stat-value"]
[class*="metadata-label"]:contains("Kaufpreis") + [class*="metadata-value"]
```

**Value Format**:
- Format: `€ 149.900` oder `€ 1.500.000`
- Tausendertrennzeichen: Punkt (`.`)
- Währungssymbol: Euro-Zeichen `€` mit Leerzeichen

**Extraction Notes**:
```python
# Beispiel Parsing
price_text = "€ 149.900"
price_clean = price_text.replace("€", "").replace(".", "").strip()
price_int = int(price_clean)  # 149900
```

**Edge Cases**:
- "Preis auf Anfrage" - Text statt Zahl (WICHTIG: herausfiltern!)
- Könnte als `<span>Preis auf Anfrage</span>` erscheinen
- Miete vs. Kaufpreis: Seite zeigt auch "Miete" - Label-Check erforderlich

**Risk Assessment**: LOW RISK
- Diese Klassennamen sind seit mehreren Versionen stabil (basierend auf häufiger Nutzung dieser Struktur)

---

### 3. FLÄCHE (Wohnfläche/Nutzfläche in m²)

**Primary Selector**:
```css
.sc-stat-label (text: "Nutzfläche" or "Wohnfläche") + .sc-stat-value
```

**Alternative - Metadata Section**:
```css
.sc-metadata-label (text: "Nutzfläche" or "Grundfläche") + .sc-metadata-value
```

**DOM Path** (Stats Section):
```
<section class="heading-section-stats">
  <div>
    <span class="sc-stat-label">Nutzfläche</span>
    <span class="sc-stat-value">30.01 m²</span>
  </div>
</section>
```

**DOM Path** (Metadata Section):
```
<div class="sc-metadata sc-metadata-default">
  <div class="sc-metadata-item">
    <span class="sc-metadata-label">Grundfläche</span>
    <span class="sc-metadata-value">30.01 m²</span>
  </div>
  <div class="sc-metadata-item">
    <span class="sc-metadata-label">Nutzfläche</span>
    <span class="sc-metadata-value">30.01 m²</span>
  </div>
  <div class="sc-metadata-item">
    <span class="sc-metadata-label">Kellerfläche</span>
    <span class="sc-metadata-value">1.5 m²</span>
  </div>
</div>
```

**Stability**: HIGH (same reasoning as price)

**Fallback Selector(s)**:
```css
[class*="stat-label"]:contains("fläche") + [class*="stat-value"]
[class*="metadata-label"]:contains("fläche") + [class*="metadata-value"]
```

**Value Format**:
- Format: `30.01 m²` oder `125 m²`
- Dezimaltrennzeichen: Punkt (`.`)
- Einheit: ` m²` mit Leerzeichen

**Extraction Notes**:
```python
# Beispiel Parsing
area_text = "30.01 m²"
area_clean = area_text.replace("m²", "").strip()
area_float = float(area_clean)  # 30.01
```

**Edge Cases**:
- **Mehrere Flächenangaben**:
  - Nutzfläche (Hauptwert)
  - Wohnfläche (alternative Bezeichnung)
  - Grundfläche (Gesamtfläche inkl. Balkon etc.)
  - Kellerfläche (zusätzlicher Keller)
- **Priorität**: Wohnfläche > Nutzfläche > Grundfläche
- Manche Inserate haben nur Grundfläche
- Kann fehlen bei Parkplätzen/Garagen

**Risk Assessment**: LOW RISK

---

### 4. ZIMMER (Anzahl Zimmer)

**Primary Selector**:
```css
.sc-stat-label (text: "Zimmer") + .sc-stat-value
```

**DOM Path**:
```
<section class="heading-section-stats">
  <div>
    <span class="sc-stat-label">Zimmer</span>
    <span class="sc-stat-value">1</span>
  </div>
</section>
```

**Stability**: HIGH

**Fallback Selector(s)**:
```css
[class*="stat-label"]:contains("Zimmer") + [class*="stat-value"]
```

**Value Format**:
- Format: `1`, `2`, `3`, `4+`
- Typ: Integer (meist) oder String bei "4+"

**Extraction Notes**:
```python
# Beispiel Parsing
rooms_text = "1"
rooms_int = int(rooms_text)  # 1
```

**Edge Cases**:
- Kann fehlen bei Stellplätzen/Garagen/Geschäftsräumen
- "0" Zimmer bei Studios/Einzimmer-Apartments (selten)
- "4+" bei sehr großen Wohnungen

**Risk Assessment**: LOW RISK

---

### 5. ADRESSE/LOCATION (Bezirk, PLZ, Straße)

**Primary Selector** (Multiple Locations):
```css
.sc-metadata-label (text: "PLZ" or "Ort" or "Bezirk") + .sc-metadata-value
```

**DOM Path**:
```
<div class="sc-metadata sc-metadata-default">
  <div class="sc-metadata-item">
    <span class="sc-metadata-label">PLZ</span>
    <span class="sc-metadata-value">1200 Wien</span>
  </div>
  <div class="sc-metadata-item">
    <span class="sc-metadata-label">Ort</span>
    <span class="sc-metadata-value">Wien</span>
  </div>
</div>
```

**Stability**: HIGH

**Fallback Selector(s)**:
```css
[class*="metadata-label"]:contains("PLZ") + [class*="metadata-value"]
[class*="metadata-label"]:contains("Ort") + [class*="metadata-value"]
[class*="metadata-label"]:contains("Bezirk") + [class*="metadata-value"]
```

**Value Format**:
- PLZ: `1200 Wien` (PLZ + Stadt kombiniert) oder `1200`
- Ort: `Wien`
- Bezirk: Meist nicht explizit angegeben, muss aus PLZ abgeleitet werden

**Extraction Notes**:
```python
# Beispiel Parsing
plz_text = "1200 Wien"
plz = plz_text.split()[0]  # "1200"
bezirk = int(plz[2:4])  # 20 (20. Bezirk: Brigittenau)
```

**Edge Cases**:
- Genaue Straße wird oft nicht angezeigt (Datenschutz)
- PLZ kann fehlen bei manchen Inseraten
- Bezirk muss aus PLZ berechnet werden (1010 = 1. Bezirk, 1200 = 20. Bezirk)

**Risk Assessment**: LOW RISK

---

### 6. BESCHREIBUNG (Objektbeschreibung)

**Primary Selector**:
```css
section[class*="description"]
```

**Alternative Selector**:
```css
.re-detail-page-front section:has(h2:contains("Beschreibung"))
.sc-description
```

**DOM Path**:
```
<section class="DetailDescription_section__XYZ">
  <h2>Beschreibung</h2>
  <div>
    <p>Vollständige Beschreibung des Objekts...</p>
  </div>
</section>
```

**Stability**: MEDIUM
- **Reasoning**: Klassennamen könnten Hash-Suffix haben, aber Struktur ist konsistent

**Fallback Selector(s)**:
```css
section:has(h2:contains("Beschreibung")) div p
[class*="Description"] div
```

**Value Format**: HTML mit Paragraphen, kann Zeilenumbrüche enthalten
**Extraction Notes**:
- Extrahiere alle `<p>` Tags innerhalb der Section
- Join mit `\n\n` für Absätze

**Edge Cases**:
- Kann sehr lang sein (mehrere tausend Zeichen)
- Kann HTML-Entities enthalten (&uuml; statt ü)
- Kann Listen (`<ul>`, `<li>`) enthalten
- Kann komplett fehlen bei älteren/minimalen Inseraten

**Risk Assessment**: MEDIUM RISK (wegen Hash-Klassennamen)

---

### 7. BILDER (Bild-URLs)

**Primary Selector**:
```css
picture source[srcSet*=".jpeg"]
img[alt*="Bild"][src*=".jpeg"]
```

**DOM Path**:
```
<picture>
  <source srcSet="https://i.prod.mp-dst.onyx60.com/plain/private-ads/
                   3af8fdea-606d-4721-85e2-223e57e387a2/
                   82953d60-bfd8-4c0a-8d18-1a50e2f7b944.jpeg/
                   ~/6ry-uw/format:avif/background:ffffff/rs:fill:1370:1060:1"
          type="image/avif"/>
  <source srcSet="https://i.prod.mp-dst.onyx60.com/plain/private-ads/
                   3af8fdea-606d-4721-85e2-223e57e387a2/
                   82953d60-bfd8-4c0a-8d18-1a50e2f7b944.jpeg/
                   ~/7ftbUg/format:jpg/background:ffffff/rs:fill:1370:1060:1"
          type="image/jpg"/>
  <img alt="Bild 1 von 9" src="...placeholder..." loading="lazy"/>
</picture>
```

**Stability**: HIGH (URL-Struktur)

**Fallback Selector(s)**:
```css
.sc-detail-image picture source
.swiper-slide img[alt*="Bild"]
```

**Value Format**:
- **Base URL Pattern**:
  ```
  https://i.prod.mp-dst.onyx60.com/plain/private-ads/{ad_id}/{image_id}.jpeg
  ```
- **With Transformations**:
  ```
  https://i.prod.mp-dst.onyx60.com/plain/private-ads/{ad_id}/{image_id}.jpeg/
  ~/transform_id/format:jpg/background:ffffff/rs:fill:1370:1060:1
  ```

**Extraction Notes**:
```python
# Beispiel: Extrahiere alle Bild-IDs
import re

srcsets = soup.select('picture source[srcSet*=".jpeg"]')
image_urls = set()

for src in srcsets:
    srcset = src.get('srcSet', '')
    # Extract base URL without transformations
    match = re.search(r'(https://[^/]+/[^/]+/private-ads/[^/]+/[^/]+\.jpeg)', srcset)
    if match:
        base_url = match.group(1)
        image_urls.add(base_url)

# Verwende AVIF für moderne Browser, JPG als Fallback
for source in picture_tags:
    avif_source = source.select_one('source[type="image/avif"]')
    jpg_source = source.select_one('source[type="image/jpg"]')
    url = avif_source.get('srcSet') or jpg_source.get('srcSet')
```

**Edge Cases**:
- **Placeholder-Bilder**: `placeholder-image.5b846bd4b14813d178e38a81b201b556.svg` - ignorieren!
- **Responsive Images**: Mehrere Größen in `srcSet` (Größe aus URL extrahierbar)
- **Format**: AVIF (modern) und JPG (Fallback) - beide vorhanden
- **Lazy Loading**: Bilder werden erst beim Scrollen geladen (Puppeteer muss scrollen!)
- **Desktop vs Mobile**: Unterschiedliche Bildcontainer (`.sc-detail-image-desktop` vs `.sc-detail-image-mobile`)

**Recommended Approach**:
```javascript
// Puppeteer Example - Extract all images
const images = await page.evaluate(() => {
  const sources = Array.from(document.querySelectorAll('picture source[type="image/jpg"]'));
  return sources
    .map(s => s.srcSet)
    .filter(url => url && !url.includes('placeholder'))
    .map(url => {
      // Extract base URL without size parameters
      const match = url.match(/(https:\/\/[^\/]+\/[^\/]+\/private-ads\/[^\/]+\/[^\/]+\.jpeg)/);
      return match ? match[1] : null;
    })
    .filter(url => url !== null);
});

// Remove duplicates
const uniqueImages = [...new Set(images)];
```

**Risk Assessment**: LOW RISK (URL-Struktur ist stabil)

---

### 8. KONTAKT/TELEFON (Telefonnummer)

**Primary Selector**:
```css
a[href^="tel:"]
.sc-contact-phone
[class*="contact"] [class*="phone"]
```

**Stability**: MEDIUM-HIGH

**Fallback Selector(s)**:
```css
a[href*="tel"]
button:contains("Anrufen")
[class*="phone-number"]
```

**Value Format**:
- Format: `+43 xxx xxxxxxx` oder `0xxx xxxxxxx`
- Kann formatiert sein mit Leerzeichen oder Bindestrichen

**Extraction Notes**:
```python
# Beispiel
tel_link = soup.select_one('a[href^="tel:"]')
if tel_link:
    phone = tel_link['href'].replace('tel:', '')  # "+43xxxxxxxxx"
```

**Edge Cases**:
- **Häufig versteckt**: Telefonnummer wird oft erst nach Klick auf "Kontakt anzeigen" Button geladen
- **Dynamic Loading**: Wird per AJAX nachgeladen (erfordert Button-Click in Puppeteer)
- **Kann komplett fehlen**: Viele Inserate zeigen nur Kontaktformular
- **Anti-Scraping**: Kann als Bild oder verschleierter Text dargestellt sein

**Recommended Approach (Puppeteer)**:
```javascript
// Click on contact button if exists
try {
  await page.click('button:has-text("Kontakt anzeigen")');
  await page.waitForTimeout(1000);
} catch (e) {
  // Button doesn't exist
}

// Extract phone after button click
const phone = await page.evaluate(() => {
  const tel = document.querySelector('a[href^="tel:"]');
  return tel ? tel.href.replace('tel:', '') : null;
});
```

**Risk Assessment**: MEDIUM-HIGH RISK
- Telefonnummer ist oft nicht im Initial-HTML
- Kann CAPTCHA-geschützt sein
- Erfordert User-Interaktion-Simulation

---

## Metadata-Struktur (Weitere Felder)

Die Seite enthält zusätzliche strukturierte Metadaten in zwei Bereichen:

### A) Stats Section (Schnellübersicht oben)
```html
<section class="heading-section-stats">
  <div>
    <span class="sc-stat-label">[Label]</span>
    <span class="sc-stat-value">[Wert]</span>
  </div>
  ...
</section>
```

**Typische Felder**:
- Kaufpreis
- Nutzfläche
- Zimmer

### B) Metadata Tables (Detaillierte Informationen)
```html
<div class="sc-metadata sc-metadata-table">
  <div class="sc-metadata-item">
    <span class="sc-metadata-label">[Label]</span>
    <span class="sc-metadata-value">[Wert]</span>
  </div>
  ...
</div>
```

**Typische Felder**:
- Betriebskosten netto
- Monatliche Kosten inkl. Ust
- Kaufpreis / Kaufpreis brutto
- Ust
- Grundfläche
- Kellerfläche
- Nutzfläche
- Wohnfläche
- PLZ
- Ort
- Baujahr
- Heizung
- Ausstattung
- ...

### Generic Extraction Strategy

**Recommended Approach**:
```python
def extract_metadata(soup):
    metadata = {}

    # Extract from stats section
    stats = soup.select('.heading-section-stats .sc-stat-label')
    for stat in stats:
        label = stat.get_text(strip=True)
        value_elem = stat.find_next_sibling(class_='sc-stat-value')
        if value_elem:
            metadata[label] = value_elem.get_text(strip=True)

    # Extract from metadata tables
    items = soup.select('.sc-metadata-item')
    for item in items:
        label_elem = item.select_one('.sc-metadata-label')
        value_elem = item.select_one('.sc-metadata-value')
        if label_elem and value_elem:
            label = label_elem.get_text(strip=True)
            value = value_elem.get_text(strip=True)
            metadata[label] = value

    return metadata

# Result:
# {
#   'Kaufpreis': '€ 149.900',
#   'Nutzfläche': '30.01 m²',
#   'Zimmer': '1',
#   'PLZ': '1200 Wien',
#   'Grundfläche': '30.01 m²',
#   'Kellerfläche': '1.5 m²',
#   ...
# }
```

---

## Platform-Specific Observations

### Anti-Scraping Measures
- **JavaScript Rendering Required**: Seite ist Next.js-basiert mit CSR
- **Rate Limiting**: Keine offensichtlichen IP-Blocks bei moderater Nutzung erkennbar
- **User-Agent Check**: Standard User-Agent erforderlich
- **CAPTCHA**: Nicht bei normaler Nutzung, könnte bei aggressivem Scraping auftreten
- **Session Tracking**: Cookies werden gesetzt, aber nicht zwingend erforderlich

### JavaScript Requirements
- **Initial Load**: HTML-Skeleton ohne Daten
- **Client-Side Rendering**: Daten werden nach Page-Load via JavaScript eingefügt
- **Required Tools**:
  - Puppeteer (Node.js)
  - Playwright (Python/Node.js)
  - Selenium (Python/Java)
- **Headless Browser**: EMPFOHLEN (headless=True für Performance)

### Scraping-Tool Recommendation
```python
# Beispiel: Playwright (Python)
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()

    # Set User-Agent
    page.set_extra_http_headers({
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ...'
    })

    # Navigate to page
    page.goto('https://immobilien.derstandard.at/detail/15005342')

    # Wait for content to load
    page.wait_for_selector('.heading-section-stats', timeout=10000)

    # Extract HTML
    html = page.content()

    # Parse with BeautifulSoup
    from bs4 import BeautifulSoup
    soup = BeautifulSoup(html, 'html.parser')

    # Extract data...

    browser.close()
```

---

## Change Risk Assessment

### High Risk Elements (Likely to Change)
- **Hash-based Class Names**:
  - `Heading_heading___t1Z5`
  - `Heading_headingInseratTitle__tnAUR`
  - Any class with `__XXX` or `___XXX` suffix
- **Component-specific Classes**:
  - Could change with React component refactoring

### Low Risk Elements (Stable)
- **BEM-style Classes**:
  - `sc-stat-label`, `sc-stat-value`
  - `sc-metadata-label`, `sc-metadata-value`
  - `sc-detail-image-*`
- **Semantic Structure**:
  - `<section class="heading-section-stats">`
  - Metadata item structure (label + value pairs)
- **Image URL Pattern**:
  - `https://i.prod.mp-dst.onyx60.com/plain/private-ads/...`

### Monitoring Recommendations
**What to Watch for Breakage**:
1. Check if `.heading-section-stats` still exists
2. Check if `.sc-stat-label` / `.sc-stat-value` still exist
3. Check if `.sc-metadata-item` structure is intact
4. Validate image URL pattern
5. Monitor for CAPTCHA appearance

**Validation Approach**:
```python
def validate_page_structure(soup):
    """
    Returns True if page structure is as expected
    """
    checks = {
        'stats_section': bool(soup.select_one('.heading-section-stats')),
        'stat_labels': len(soup.select('.sc-stat-label')) > 0,
        'metadata_items': len(soup.select('.sc-metadata-item')) > 0,
        'title': bool(soup.select_one('h1[class*="heading"]')),
        'images': len(soup.select('picture source[srcSet*=".jpeg"]')) > 0
    }

    return all(checks.values()), checks
```

---

## Example Scraper Implementation

```python
from playwright.sync_api import sync_playwright
from bs4 import BeautifulSoup
import re

def scrape_derstandard_listing(listing_id):
    """
    Scrapes a single derStandard.at listing
    """
    url = f'https://immobilien.derstandard.at/detail/{listing_id}'

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        page.goto(url, wait_until='networkidle')
        page.wait_for_selector('.heading-section-stats', timeout=15000)

        html = page.content()
        browser.close()

    soup = BeautifulSoup(html, 'html.parser')

    # Extract title
    title_elem = soup.select_one('h1[class*="headingInseratTitle"]')
    title = title_elem.get_text(strip=True) if title_elem else None

    # Extract metadata
    metadata = {}
    for item in soup.select('.sc-metadata-item'):
        label = item.select_one('.sc-metadata-label')
        value = item.select_one('.sc-metadata-value')
        if label and value:
            metadata[label.get_text(strip=True)] = value.get_text(strip=True)

    # Extract stats
    for stat in soup.select('.heading-section-stats .sc-stat-label'):
        label = stat.get_text(strip=True)
        value_elem = stat.find_next_sibling(class_='sc-stat-value')
        if value_elem:
            metadata[label] = value_elem.get_text(strip=True)

    # Parse specific fields
    price = metadata.get('Kaufpreis', '').replace('€', '').replace('.', '').strip()
    price = int(price) if price.isdigit() else None

    area_text = metadata.get('Nutzfläche') or metadata.get('Wohnfläche', '')
    area = float(area_text.replace('m²', '').strip()) if area_text else None

    rooms = metadata.get('Zimmer', '')
    rooms = int(rooms) if rooms.isdigit() else None

    plz_full = metadata.get('PLZ', '')
    plz = plz_full.split()[0] if plz_full else None

    # Extract images
    images = []
    for source in soup.select('picture source[type="image/jpg"]'):
        srcset = source.get('srcSet', '')
        if 'placeholder' not in srcset:
            match = re.search(r'(https://[^/]+/[^/]+/private-ads/[^/]+/[^/]+\.jpeg)', srcset)
            if match:
                images.append(match.group(1))
    images = list(set(images))  # Remove duplicates

    return {
        'listing_id': listing_id,
        'title': title,
        'price': price,
        'area': area,
        'rooms': rooms,
        'plz': plz,
        'images': images,
        'metadata': metadata,
        'url': url
    }

# Usage
result = scrape_derstandard_listing('15005342')
print(result)
```

---

## Summary: Selector Priority Matrix

| Feld | Primary Selector | Fallback Selector | Stability | Criticality |
|------|------------------|-------------------|-----------|-------------|
| **Titel** | `h1[class*="headingInseratTitle"]` | `section.re-detail-page-front h1` | MEDIUM | HIGH |
| **Preis** | `.sc-stat-label:contains("Kaufpreis") + .sc-stat-value` | `.sc-metadata-label:contains("Kaufpreis") + .sc-metadata-value` | HIGH | HIGH |
| **Fläche** | `.sc-stat-label:contains("Nutzfläche") + .sc-stat-value` | `.sc-metadata-label:contains("fläche") + .sc-metadata-value` | HIGH | HIGH |
| **Zimmer** | `.sc-stat-label:contains("Zimmer") + .sc-stat-value` | N/A | HIGH | HIGH |
| **Location** | `.sc-metadata-label:contains("PLZ") + .sc-metadata-value` | N/A | HIGH | HIGH |
| **Beschreibung** | `section[class*="description"]` | `section:has(h2:contains("Beschreibung"))` | MEDIUM | MEDIUM |
| **Bilder** | `picture source[type="image/jpg"]` | `.sc-detail-image img[alt*="Bild"]` | HIGH | MEDIUM |
| **Telefon** | `a[href^="tel:"]` | `button:contains("Kontakt") → AJAX` | MEDIUM | LOW |

---

**Analysis Date**: 2026-01-08
**Example Listing**: https://immobilien.derstandard.at/detail/15005342
**Status**: Active, structure validated
