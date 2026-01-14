# ⚡ SCRAPER SPEED OPTIMIERUNGEN

## 🎯 Aktuelle Performance:
- **90-95% schneller** durch ISPRIVATE-Filter
- ~15-30 Sekunden pro Cycle (statt 8-10 Minuten)
- ~10-20 Detail-Requests (statt 720)

---

## 🚀 WEITERE OPTIMIERUNGEN MÖGLICH:

### 1. ⚡ **PARALLEL REQUESTS** (Größte Optimierung!)

**Aktuell (SEQUENTIELL):**
```typescript
for (const detailUrl of urls) {
  const detail = await this.fetchDetail(detailUrl);  // Warte auf jedes Detail
  // Process...
}
```
- Request 1 → warten (500ms)
- Request 2 → warten (500ms)
- Request 3 → warten (500ms)
- **Total: 10 × 500ms = 5 Sekunden**

**OPTIMIERT (PARALLEL):**
```typescript
// Batch processing mit Promise.all()
const BATCH_SIZE = 5;  // 5 parallel requests
for (let i = 0; i < urls.length; i += BATCH_SIZE) {
  const batch = urls.slice(i, i + BATCH_SIZE);
  const details = await Promise.all(
    batch.map(url => this.fetchDetail(url))
  );
  // Process all in batch...
}
```
- Request 1,2,3,4,5 → parallel (500ms)
- Request 6,7,8,9,10 → parallel (500ms)
- **Total: 2 × 500ms = 1 Sekunde!**

**💡 Speedup: 5x schneller!**

---

### 2. 🗜️ **HTTP/2 & KEEP-ALIVE** (Connection Pooling)

**Problem:** Jeder Request öffnet neue TCP-Connection
```typescript
// Aktuell:
const response = await undiciFetch(url, { dispatcher });
// → Neue Connection für jeden Request!
```

**Lösung: Connection Reuse**
```typescript
// Undici Agent mit Connection Pooling
const agent = new Agent({
  connections: 10,        // Max 10 gleichzeitige Connections
  pipelining: 5,          // 5 Requests per Connection
  keepAliveTimeout: 60000 // Keep alive 60s
});
```

**💡 Speedup: 20-30% schneller (weniger TCP Handshakes)**

---

### 3. 🎯 **STREAMING PARSE** (Cheerio lazy loading)

**Problem:** Ganzes HTML wird sofort geparsed
```typescript
const $ = load(html);  // Parsed komplettes 500KB HTML
```

**Lösung: Streaming + Selective Parsing**
```typescript
// Parse nur was du brauchst
const $ = load(html, {
  decodeEntities: false,  // Nicht alle Entities decodieren
  _useHtmlParser2: true   // Schnellerer Parser
});

// Nur specific selectors
const title = $('h1').first().text();  // Stop nach erstem Match
```

**💡 Speedup: 10-15% schneller (weniger CPU)**

---

### 4. 💾 **CACHING** (Schon gesehene Listings)

**Problem:** Listings werden mehrfach verarbeitet
```typescript
// Wenn Listing auf Seite 1 UND Seite 2 erscheint
```

**Lösung: In-Memory Cache**
```typescript
private seenListings = new Set<string>();

if (this.seenListings.has(listingId)) {
  continue;  // Skip bereits verarbeitet
}
this.seenListings.add(listingId);
```

**💡 Speedup: 5-10% schneller (weniger duplicate processing)**

---

### 5. 🔥 **EARLY ABORT** (Stop bei bekannten Listings)

**Aktuell:** Scrape bis previousFirstId
```typescript
if (listingId === categoryLastFirstId) {
  break;  // Stop pagination
}
```

**BESSER:** Stop auch bei bereits in DB
```typescript
// Check DB bevor Detail-Fetch
const exists = await this.checkListingExists(listingId);
if (exists) {
  continue;  // Skip Detail-Fetch!
}
```

**💡 Speedup: 30-50% bei Follow-up Scrapes**

---

### 6. ⚙️ **REDUCE DELAYS** (Jitter optimization)

**Aktuell:**
```typescript
await sleep(withJitter(60, 120));  // 60-180ms zwischen Listings
await sleep(withJitter(120, 80));  // 120-200ms zwischen Pages
```

**Problem:** Bei nur 10-20 Requests ist Delay unnötig lang

**OPTIMIERT:**
```typescript
// Dynamische Delays basierend auf Request-Count
const delay = urls.length > 50
  ? withJitter(60, 120)   // Viele Requests → langsamer
  : withJitter(20, 30);   // Wenige Requests → schneller

await sleep(delay);
```

**💡 Speedup: 20-30% schneller**

---

### 7. 🎨 **LAZY PHONE EXTRACTION** (On-Demand)

**Problem:** Phone wird immer extrahiert, auch wenn nicht gebraucht
```typescript
const phone = this.extractPhone(detail);  // Aufwändig!
if (phone) {
  onPhoneFound?.({ url, phone });
}
```

**OPTIMIERT:**
```typescript
// Nur extrahieren wenn Callback existiert
if (onPhoneFound) {
  const phone = this.extractPhone(detail);
  if (phone) onPhoneFound({ url, phone });
}
```

**💡 Speedup: 5-10% wenn Phone nicht gebraucht wird**

---

### 8. 🗄️ **DATABASE BATCH INSERT** (Bulk operations)

**Problem:** Jedes Listing einzeln in DB
```typescript
for (const listing of listings) {
  await db.insert(listings).values(listing);  // Single insert
}
```

**OPTIMIERT:**
```typescript
// Batch insert alle auf einmal
await db.insert(listings).values(allListings);  // Bulk insert
```

**💡 Speedup: 50-70% schneller bei DB-Writes**

---

### 9. 🧠 **INTELLIGENT PAGINATION** (Adaptive limits)

**Aktuell:** MAX_SAFETY_PAGES = 20
```typescript
while (!foundPreviousFirstId && pageNumber <= 20)
```

**Problem:** Bei ruhigen Zeiten scrapen wir vielleicht nur 1-2 Seiten

**OPTIMIERT:**
```typescript
// Lerne von Historie
const avgPagesNeeded = this.calculateAveragePages(category);
const maxPages = Math.min(avgPagesNeeded * 1.5, 20);
```

**💡 Speedup: 10-20% weniger unnötige Seiten**

---

### 10. 🎯 **ISPRIVATE EARLY CHECK** (Vor Detail-Fetch)

**Aktuell:** ISPRIVATE-Filter in extractDetailUrls()
✅ **Schon optimal!**

Aber könnte noch besser:
```typescript
// ISPRIVATE direkt aus Listing-Card HTML extrahieren
// OHNE komplette Seite zu laden
```

---

## 📊 **COMBINED OPTIMIZATION POTENTIAL:**

| Optimierung | Speedup | Aufwand | Risiko |
|-------------|---------|---------|--------|
| **1. Parallel Requests** | **5-10x** | Mittel | Niedrig |
| **2. Connection Pooling** | 1.3x | Niedrig | Niedrig |
| **3. Streaming Parse** | 1.15x | Niedrig | Niedrig |
| **4. Caching** | 1.1x | Niedrig | Niedrig |
| **5. Early Abort** | 1.5x | Mittel | Niedrig |
| **6. Reduce Delays** | 1.3x | Niedrig | **Mittel** (Willhaben könnte blocken) |
| **7. Lazy Phone** | 1.1x | Niedrig | Niedrig |
| **8. Batch DB Insert** | 1.7x | Niedrig | Niedrig |
| **9. Adaptive Pagination** | 1.2x | Mittel | Niedrig |

**TOTAL SPEEDUP: 10-30x zusätzlich!**

Aktuell: 15-30 Sekunden
Nach Optimierung: **1-3 Sekunden!** 🚀

---

## 🎯 **MEINE EMPFEHLUNG - TOP 3:**

### 🥇 **1. Parallel Requests (5-10x faster)**
- Batch size: 3-5 gleichzeitig
- Mit Rate Limiting
- **SOFORT implementierbar, größter Gewinn**

### 🥈 **2. Database Batch Insert (1.7x faster)**
- Sammle alle Listings
- Ein Bulk-Insert am Ende
- **Einfach, sicher, effektiv**

### 🥉 **3. Early Abort + Caching (1.5x faster)**
- Check DB vor Detail-Fetch
- Cache in-memory
- **Spart viele unnötige Requests**

---

## 🔧 **IMPLEMENTATION PRIORITY:**

**PHASE 1 (Quick Wins):**
1. ✅ Batch DB Insert (10 Min)
2. ✅ Lazy Phone Extraction (5 Min)
3. ✅ In-Memory Cache (10 Min)

**PHASE 2 (Medium Impact):**
4. ✅ Parallel Requests (30 Min)
5. ✅ Connection Pooling (20 Min)

**PHASE 3 (Fine-tuning):**
6. ✅ Reduce Delays (5 Min)
7. ✅ Streaming Parse (15 Min)
8. ✅ Adaptive Pagination (20 Min)

---

## ⚠️ **WARNINGS:**

1. **Parallel Requests:** Nicht zu viele gleichzeitig (max 5)
2. **Reduce Delays:** Vorsichtig, könnte Willhaben triggern
3. **Connection Pooling:** Proxies müssen mitspielen

---

Soll ich:
1. **Parallel Requests** implementieren? (5-10x Speedup!)
2. **Batch DB Insert** implementieren? (1.7x Speedup!)
3. **Alle TOP 3** auf einmal? (Combined 10-15x Speedup!)
