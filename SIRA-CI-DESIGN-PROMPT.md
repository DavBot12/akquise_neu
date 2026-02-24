# SIRA Corporate Identity & Design System - Prompt

Verwende diesen Prompt als Kontext in neuen Projekten, damit das gleiche Design konsistent umgesetzt wird.

---

## Prompt (kopieren und einfügen):

```
Du arbeitest mit der SIRA Group Corporate Identity. Halte dich an folgendes Design System:

## Farben

### Primärfarben
- **SIRA Navy** (Hauptfarbe): `#000324` – Für Header, aktive Navigation, CTAs, Überschriften
- **SIRA Navy Hover**: `#001a4d` – Hover-State für Buttons und Links
- **Weiß**: `#ffffff` – Hintergründe, Karten
- **Alt-Background**: `#f5f5f5` – Sekundäre Hintergründe, Muted-Bereiche

### Grautöne
- **Light Gray** `#e0e0e0` – Borders, Trennlinien, Karten-Ränder
- **Input Gray** `#e6e6e6` – Formular-Input-Hintergründe
- **Medium Gray** `#6c757d` – Sekundärtext, Beschreibungen, Captions
- **Divider Gray** `#dee2e6` – Listentrennlinien

### Status-Farben
- **Success**: `#065F46` (dunkles Grün) – Erfolgreich, bestätigt
- **Danger**: `#991B1B` (dunkles Rot) – Fehler, Löschen, Warnung
- **Warning Text**: `#856404` – Warnhinweise
- **Warning Background**: `#fff3cd` mit Border `#ffc107`
- **Info**: `#003b8a` (dunkles Blau)

### Email-Template Farben (für HTML-Emails)
- **Header**: `#0f172a` (dunkleres Navy als UI)
- **Accent Blue**: `#3b82f6`
- **Accent Green**: `#22c55e`
- **Accent Gold**: `#f59e0b`
- **Text Primary**: `#1e293b`
- **Text Secondary**: `#64748b`
- **Border**: `#e2e8f0`
- **Body Background**: `#f8fafc`

## Typografie

- **Font**: `Inter` (Google Fonts) – Weights: 400, 500, 600, 700
- **Fallback**: `system-ui, -apple-system, sans-serif`
- **Body**: leichtes negatives Letter-Spacing (`-0.01em`)
- **Überschriften**: `tracking-tight`

### Größen-Hierarchie
- **Page Heading**: `28px`, `font-semibold` (h1 auf jeder Seite)
- **Section Heading**: `text-xl`, `font-semibold` (Card-Header, Bereiche)
- **Card Title**: `text-base`, `font-semibold` (z.B. Listing-Titel)
- **Meta/Label**: `text-xs`, `uppercase`, `letter-spacing: 0.05em`, Farbe `#6c757d`
- **Body**: `text-sm` oder `text-base`

## Layout-Struktur

### App Shell
- Sidebar: 256px breit (`w-64`), fixiert, weiß, Border rechts
  - Logo oben mit Subtitle
  - Navigation: `px-4 py-3 rounded-md text-sm font-medium`
    - **Aktiv**: `bg-sira-navy text-white`
    - **Inaktiv**: `text-gray hover:bg-background hover:text-sira-navy`
  - User-Footer unten mit Avatar + Logout
- Main Content: `flex-1 overflow-auto`
  - Max-Width: `1600px`, zentriert
  - Padding: `p-6 md:p-8`
  - Spacing: `space-y-6`

### Seitenaufbau (jede Seite)
1. Page Header: `h1` + optionale Beschreibung `p.text-gray`
2. Stats Grid: `grid-cols-1 md:grid-cols-3 gap-4`
3. Filter Bar (optional): Card mit Select-Dropdowns
4. Content Grid: `grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4`

## Komponenten-Patterns

### Buttons
- **Primary (CTA)**: `bg-[#000324] hover:bg-[#000324]/90 text-white` rounded
- **Outline**: `border border-[#e0e0e0] bg-white hover:bg-[#f5f5f5]`
- **Danger**: `hover:bg-red-50 hover:text-[#991B1B]`
- **Ghost**: transparent, nur hover-Effekt
- **Transition**: immer `transition-all duration-200 ease-in-out`
- **Größen**: Standard `h-10 px-4`, Small `h-9 px-3`, Icon `h-10 w-10`

### Cards
- `rounded-lg border border-[#e0e0e0] bg-white shadow-sm`
- Header: `p-6`
- Content: `p-6 pt-0`
- Titel im Card: `text-2xl font-semibold tracking-tight`

### Badges
- Rund: `rounded-full px-2.5 py-0.5 text-xs font-semibold`
- **Default**: `bg-[#000324] text-white`
- **Outline**: `border text-foreground`
- **Success**: `border-[#065F46] text-[#065F46]`
- **Danger**: `bg-[#991B1B] text-white`

### Inputs
- `h-10 rounded-md border border-[#e6e6e6] bg-white px-3 py-2`
- Focus: `border-[#000324] ring-[#000324]`

### Quality Score Badges
- Excellent (90+): Grün `bg-green-600`
- Good (70-89): Gelb `bg-yellow-500`
- Medium (50-69): Orange `bg-orange-500`
- Low (<50): Rot `bg-red-500`
- Gold Find: `text-yellow-600 bg-yellow-50 border-yellow-300`

## Icons
- Library: **Lucide React** (ausschließlich)
- Standard: `w-4 h-4`
- Section Headers: `w-5 h-5`
- Compact: `w-3 h-3`

## Scrollbars
- Breite: `6px`
- Track: `#e0e0e0`
- Thumb: `#6c757d`, `border-radius: 3px`

## Email-Template Design (HTML)
Alle Emails folgen diesem Aufbau:
1. **Dark Header** (`#0f172a`): Titel in Uppercase, `24px`, `font-weight: 700`, `letter-spacing: 0.5px`
   Subtitle in `#94a3b8`, `14px`
2. **White Content Area**: Cards mit `border: 1px solid #e2e8f0`, `border-radius: 8px`
   Metric Cards im KPI-Style: Label oben (11px, uppercase, `#64748b`), Wert groß (28px, bold)
3. **CTA Button**: `background: #0f172a`, `color: white`, `padding: 14px 32px`, `border-radius: 8px`
   Text: "Im Portal öffnen →"
4. **Dark Footer** (`#0f172a`): Text in `#64748b`, `12px`
   "SIRA Akquise Tool • Automatische Benachrichtigung"

## Design-Prinzipien
- **Clean & Professional**: Minimalistisch, keine bunten Gradients in der App
- **Konsistente Abstände**: Immer 4px-Grid (p-2, p-4, p-6, p-8, gap-4, gap-6)
- **Uppercase für Labels**: Meta-Informationen und Kategorien in `uppercase` + `letter-spacing`
- **Navy als Anker**: SIRA Navy `#000324` ist die dominante Farbe – Header, aktive States, CTAs
- **Grau-Hierarchie**: Verschiedene Grautöne für Tiefe und Hierarchie
- **Status durch Farbe**: Grün = gut, Rot = schlecht, Gelb = Warnung, Blau = Info
- **Transitions**: Alles mit `transition-all duration-200` für geschmeidiges Feeling

## Tech Stack
- **CSS Framework**: Tailwind CSS mit CSS-Variablen
- **UI Library**: shadcn/ui (New York Style)
- **Icons**: Lucide React
- **Font**: Inter (Google Fonts)
- **Dark Mode**: Unterstützt via `.dark` Klasse (class-based)
```

---

**Hinweis:** Einfach den Prompt-Block oben kopieren und in ein neues Projekt als System-Kontext einfügen.
