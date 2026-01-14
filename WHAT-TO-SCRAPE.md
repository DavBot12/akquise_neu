# 🔍 Was kann man noch aus Willhaben scrapen?

## ✅ Was du BEREITS scrapst:

1. **Telefonnummer** ✓
   - `{"name":"CONTACT/PHONE","values":["..."]}`
   - `{"id":"phoneNo","value":"..."}`

2. **ISPRIVATE Flag** ✓
   - `{"name":"ISPRIVATE","values":["0"|"1"]}`

3. **Basics** ✓
   - Preis, Titel, Beschreibung, Region, Kategorie

---

## 🆕 Was du ZUSÄTZLICH scrapen könntest:

### 1. **Email-Adresse** 📧
```json
{"name":"CONTACT/EMAIL","values":["example@gmail.com"]}
```
- Oft vorhanden bei Privaten
- Für direktes Anschreiben

### 2. **Firmenname** (bei Maklern) 🏢
```json
{"name":"ORGNAME","values":["EDEX Immobilien GmbH"]}
```
- Um Makler-Firmen zu identifizieren
- Für Blacklist oder Filter

### 3. **Kontaktperson Name** 👤
```json
{"name":"CONTACT_PERSON","values":["Max Mustermann"]}
{"name":"SELLER_NAME","values":["..."]}`}
```
- Personalisiertes Anschreiben

### 4. **Detaillierte Immobilien-Daten** 🏠

```json
{"name":"ESTATE_SIZE/LIVING_AREA","values":["245"]}  // m²
{"name":"ESTATE_SIZE/LOT_SIZE","values":["500"]}     // Grundstücksgröße
{"name":"NUMBER_OF_ROOMS","values":["4"]}
{"name":"ESTATE_PREFERENCE/BALCONY","values":["1"]}
{"name":"ESTATE_PREFERENCE/TERRACE","values":["1"]}
{"name":"ESTATE_PREFERENCE/GARDEN","values":["1"]}
{"name":"ESTATE_PREFERENCE/ELEVATOR","values":["1"]}
{"name":"CONSTRUCTION_YEAR","values":["2020"]}
{"name":"FLOOR","values":["3"]}
{"name":"HEATING_TYPE","values":["Zentralheizung"]}
{"name":"ENERGY_CERTIFICATE","values":["A"]}
```

### 5. **Geografische Details** 📍
```json
{"name":"LOCATION","values":["Wien, 19. Bezirk, Döbling"]}
{"name":"POSTCODE","values":["1190"]}
{"name":"STATE","values":["Wien"]}
{"name":"DISTRICT","values":["Wien"]}
{"name":"COORDINATES","values":["48.2485,16.3407"]}  // Lat/Long
```

### 6. **Inserat-Metadaten** 📅
```json
{"name":"PUBLISHED","values":["2025-01-10"]}
{"name":"UPDATED","values":["2025-01-13"]}
{"name":"AD_ID","values":["1234567890"]}
{"name":"AD_STATUS","values":["ACTIVE"]}
```

### 7. **Bilder** 🖼️
```json
{"name":"IMAGE_URLS","values":["https://cache.willhaben.at/..."]}
```
- Anzahl der Bilder
- Qualität der Bilder
- Erste Bild-URL für Preview

### 8. **Beschreibungs-Text** 📝
```json
{"name":"BODY_DYN","values":["Exklusives Wohnerlebnis mit..."]}
```
- Volltext für KI-Analyse
- Keyword-Erkennung (Schnäppchen, Notverkauf, etc.)

### 9. **Ausstattungs-Features** ⭐
```json
{"name":"PROPERTY_TYPE","values":["FLAT"]}
{"name":"ESTATE_TYPE","values":["apartment"]}
{"name":"PARKING","values":["garage"]}
{"name":"FURNISHED","values":["1"]}
{"name":"PET_FRIENDLY","values":["1"]}
```

### 10. **Finanzierungs-Info** 💰
```json
{"name":"MONTHLY_RENT","values":["800"]}      // Bei Mietobjekten
{"name":"OPERATING_COSTS","values":["150"]}
{"name":"COMMISSION","values":["2%"]}          // Makler-Provision
```

---

## 🎯 **Was ist am WERTVOLLSTEN für dich?**

### Top 5 für Akquise:

1. ✅ **Email** - Direktes Anschreiben ohne Anruf
2. ✅ **Kontaktperson Name** - Personalisierung
3. ✅ **ISPRIVATE** - Filter (hast du schon!)
4. ✅ **Telefon** - Direktkontakt (hast du schon!)
5. ✅ **Inserat-Datum** - Frische Leads priorisieren

### Top 3 für Qualität-Scoring:

1. ✅ **Preis** - Zu teuer/günstig?
2. ✅ **m²** - Realistische Größe?
3. ✅ **Bilder-Anzahl** - Seriöses Inserat?

---

## 🤖 **Automatisches Anschreiben - Was du brauchst:**

### Variante 1: Email-Anschreiben (besser!)
- ✅ Email-Adresse extrahieren
- ✅ Kontaktperson Name
- ✅ Template mit Platzhaltern
- ✅ SMTP Server (z.B. Gmail API, SendGrid)

### Variante 2: Willhaben Nachricht (riskant!)
- ❌ Willhaben Login erforderlich
- ❌ CAPTCHA möglich
- ❌ Rate Limiting
- ❌ Account kann gebannt werden

### Variante 3: SMS (teuer aber effektiv!)
- ✅ Telefonnummer hast du
- ✅ SMS-Gateway (Twilio, etc.)
- ⚠️ Kosten pro SMS (~0.05€)
- ⚠️ Spam-Risiko

---

## 💡 **Meine Empfehlung:**

1. **Jetzt extrahieren:**
   - Email
   - Kontaktperson Name
   - m², Zimmer
   - Inserat-Datum

2. **Automatisches Anschreiben:**
   - Email-Template erstellen
   - Personalisiert mit Name, Adresse, etc.
   - Batch-Versand (nicht alle auf einmal!)

3. **Fallback:**
   - Wenn keine Email → Telefon anzeigen
   - Manuelle Anrufe für die besten Leads

---

Soll ich dir:
1. Email-Extraktor implementieren?
2. Automatisches Email-System aufsetzen?
3. Noch mehr Datenfelder scrapen?
