/**
 * Geografischer Filter für Akquise-Gebiet
 *
 * FOKUS: Max. 30min mit Auto von Wien erreichbar (Speckgürtel)
 *
 * BASIERT AUF: Stadtregion Wien (Statistik Austria)
 * - Kernzone: 40 Gemeinden direkt um Wien
 * - Außenzone: 171 Gemeinden (Pendlereinzugsgebiet)
 *
 * INTERESSANT (<25 min):
 * - Wien: KOMPLETT
 * - Bezirk Mödling: KOMPLETT
 * - Schwechat & Umgebung: KOMPLETT
 * - Klosterneuburg: Nahe Teile
 * - Groß-Enzersdorf, Vösendorf, Gießhübl
 *
 * NICHT INTERESSANT (>30 min):
 * - Baden & Umgebung (Triestingtal)
 * - Wiener Neustadt & Umgebung
 * - Gänserndorf & Marchfeld
 * - Korneuburg/Stockerau (Weinviertel)
 * - Tulln & Umgebung
 * - Purkersdorf/Pressbaum (Wienerwald zu weit)
 */

// Blacklist: Orte die NICHT interessant sind (>30 min von Wien)
const BLACKLISTED_LOCATIONS = new Set([
  // ============================================
  // SÜDEN - Baden & Triestingtal (>30 min)
  // ============================================
  'baden',
  'bad vöslau',
  'badener',
  'traiskirchen',
  'pfaffstätten',
  'sooß',
  'kottingbrunn',
  'leobersdorf',
  'enzesfeld',
  'lindabrunn',
  'hirtenberg',
  'berndorf',
  'pottenstein',
  'alland',
  'heiligenkreuz',
  'mayerling',
  'gainfarn',
  'tribuswinkel',

  // ============================================
  // SÜDEN - Wiener Neustadt & Umgebung (>35 min)
  // ============================================
  'wiener neustadt',
  'wr. neustadt',
  'wr neustadt',
  'neudörfl',
  'wöllersdorf',
  'felixdorf',
  'sollenau',
  'theresienfeld',
  'bad erlach',
  'pitten',
  'neunkirchen',
  'ternitz',
  'mattersburg',

  // ============================================
  // OSTEN - Gänserndorf & Marchfeld (>30 min)
  // ============================================
  'gänserndorf',
  'gaenserndorf',
  'marchegg',
  'deutsch-wagram',
  'strasshof',
  'aderklaa',
  'parbasdorf',
  'markgrafneusiedl',
  'obersiebenbrunn',
  'untersiebenbrunn',
  'lassee',
  'engelhartstetten',
  'eckartsau',
  'orth an der donau',

  // ============================================
  // OSTEN - Bruck/Leitha & Grenze (>35 min)
  // ============================================
  'bruck an der leitha',
  'hainburg',
  'wolfsthal',
  'petronell',
  'carnuntum',
  'bad deutsch-altenburg',
  'rohrau',
  'prellenkirchen',
  'mannersdorf',

  // ============================================
  // NORDEN - Korneuburg/Stockerau (>30 min)
  // ============================================
  'stockerau',
  'korneuburg',
  'leobendorf',
  'langenzersdorf',
  'bisamberg',
  'spillern',
  'ernstbrunn',
  'sierndorf',
  'hausleiten',
  'stetteldorf',

  // ============================================
  // NORDEN - Greifenstein/Donau (>30 min)
  // ============================================
  'greifenstein',
  'hadersfeld',
  'kritzendorf',
  'höflein',
  'st. andrä-wördern',
  'zeiselmauer',
  'muckendorf',
  'königstetten',

  // ============================================
  // NORDEN - Tulln & Umgebung (>35 min)
  // ============================================
  'tulln',
  'tullnerfeld',
  'langenlebarn',
  'judenau',
  'atzenbrugg',
  'michelhausen',
  'sieghartskirchen',

  // ============================================
  // NORDEN - Hollabrunn/Weinviertel (>45 min)
  // ============================================
  'hollabrunn',
  'retz',
  'mistelbach',
  'laa an der thaya',
  'poysdorf',
  'wolkersdorf',

  // ============================================
  // WESTEN - Purkersdorf/Pressbaum (>30 min)
  // ============================================
  'purkersdorf',
  'gablitz',
  'pressbaum',
  'tullnerbach',
  'wolfsgraben',
  'mauerbach',
  'eichgraben',
  'maria anzbach',

  // ============================================
  // WESTEN - Neulengbach/St. Pölten (>40 min)
  // ============================================
  'neulengbach',
  'st. pölten',
  'herzogenburg',
  'traismauer',
  'krems',
  'böheimkirchen',
  'kirchstetten',
]);

// PLZ-Blacklist (>30 min von Wien)
const BLACKLISTED_PLZ_PREFIXES = [
  // ============================================
  // SÜDEN - Baden & Triestingtal
  // ============================================
  '2500', // Baden
  '2511', // Pfaffstätten
  '2512', // Tribuswinkel
  '2521', // Trumau
  '2522', // Oberwaltersdorf
  '2523', // Tattendorf
  '2524', // Teesdorf
  '2525', // Günselsdorf
  '2531', // Gainfarn
  '2532', // Heiligenkreuz
  '2533', // Klausen-Leopoldsdorf
  '2534', // Alland
  '2540', // Bad Vöslau
  '2542', // Kottingbrunn
  '2544', // Leobersdorf
  '2551', // Enzesfeld-Lindabrunn
  '2552', // Hirtenberg
  '2560', // Berndorf
  '2563', // Pottenstein

  // ============================================
  // SÜDEN - Wiener Neustadt & Umgebung
  // ============================================
  '2500', // Wiener Neustadt (mehrere)
  '2501',
  '2502',
  '2503',
  '2504',
  '2505',
  '2506',
  '2601', // Sollenau
  '2602', // Blumau-Neurißhof
  '2603', // Felixdorf
  '2604', // Theresienfeld
  '2620', // Neunkirchen
  '2630', // Ternitz
  '2640', // Gloggnitz

  // ============================================
  // OSTEN - Gänserndorf & Marchfeld
  // ============================================
  '2212', // Großengersdorf
  '2213', // Bockfließ
  '2214', // Auersthal
  '2215', // Raggendorf
  '2221', // Groß-Schweinbarth
  '2222', // Bad Pirawarth
  '2223', // Hohenruppersdorf
  '2224', // Obersulz
  '2225', // Zistersdorf
  '2230', // Gänserndorf
  '2231', // Strasshof
  '2232', // Deutsch-Wagram
  '2233', // Aderklaa (borderline)
  '2234', // Parbasdorf
  '2235', // Markgrafneusiedl
  '2241', // Schönkirchen-Reyersdorf
  '2242', // Prottes
  '2243', // Matzen
  '2244', // Spannberg
  '2245', // Velm-Götzendorf
  '2251', // Ebenthal
  '2252', // Haringsee
  '2253', // Weikendorf
  '2261', // Angern
  '2262', // Stillfried
  '2263', // Dürnkrut
  '2264', // Jedenspeigen
  '2273', // Hohenau an der March
  '2274', // Rabensburg
  '2275', // Bernhardsthal
  '2282', // Gnadendorf
  '2283', // Obersiebenbrunn
  '2284', // Untersiebenbrunn
  '2285', // Leopoldsdorf im Marchfelde
  '2286', // Lassee
  '2292', // Engelhartstetten
  '2293', // Marchegg
  '2294', // Schloßhof
  '2295', // Zwerndorf

  // ============================================
  // OSTEN - Bruck/Leitha & Grenze
  // ============================================
  '2410', // Hainburg an der Donau
  '2412', // Wolfsthal
  '2413', // Edelstal
  '2421', // Kittsee
  '2422', // Pama
  '2423', // Deutsch Jahrndorf
  '2424', // Zurndorf
  '2425', // Nickelsdorf
  '2431', // Enzersdorf an der Fischa
  '2432', // Schwadorf
  '2433', // Margarethen am Moos
  '2434', // Götzendorf an der Leitha
  '2435', // Ebergassing (borderline)
  '2440', // Gramatneusiedl
  '2441', // Mitterndorf
  '2442', // Unterwaltersdorf
  '2443', // Deutsch-Jahrndorf
  '2451', // Hof am Leithaberge
  '2452', // Mannersdorf
  '2453', // Sommerein
  '2454', // Trautmannsdorf
  '2460', // Bruck an der Leitha
  '2462', // Wilfleinsdorf
  '2463', // Gallbrunn
  '2464', // Göttlesbrunn-Arbesthal
  '2465', // Höflein
  '2471', // Pachfurth
  '2472', // Prellenkirchen
  '2473', // Potzneusiedl
  '2481', // Achau (Achtung: PLZ-Überlappung!)
  '2482', // Münchendorf
  '2483', // Ebreichsdorf
  '2485', // Wampersdorf
  '2486', // Pottendorf

  // ============================================
  // NORDEN - Korneuburg/Stockerau/Weinviertel
  // ============================================
  '2000', // Stockerau
  '2002', // Großmugl
  '2003', // Leitzersdorf
  '2004', // Niederhollabrunn
  '2011', // Senning
  '2013', // Göllersdorf
  '2014', // Breitenwaida
  '2020', // Hollabrunn
  '2022', // Immendorf
  '2023', // Nappersdorf-Kammersdorf
  '2024', // Mailberg
  '2031', // Eggendorf im Thale
  '2032', // Enzersdorf im Thale
  '2033', // Kammersdorf
  '2034', // Zissersdorf
  '2041', // Wullersdorf
  '2042', // Guntersdorf
  '2051', // Zellerndorf
  '2052', // Pernersdorf
  '2053', // Jetzelsdorf
  '2054', // Haugsdorf
  '2061', // Hadres
  '2062', // Seefeld-Kadolz
  '2063', // Zwingendorf
  '2064', // Wulzeshofen
  '2073', // Schrattenthal
  '2074', // Unterretzbach
  '2081', // Niederfladnitz
  '2082', // Hardegg
  '2083', // Pleißing
  '2084', // Weitersfeld
  '2091', // Langau
  '2092', // Riegersburg
  '2093', // Geras
  '2094', // Drosendorf-Zissersdorf
  '2095', // Drosendorf Stadt
  '2100', // Korneuburg
  '2102', // Bisamberg
  '2103', // Langenzersdorf
  '2104', // Spillern
  '2105', // Oberrohrbach
  '2111', // Leobendorf
  '2112', // Würnitz
  '2113', // Karnabrunn
  '2114', // Großrußbach
  '2115', // Ernstbrunn
  '2116', // Niederleis
  '2120', // Wolkersdorf
  '2122', // Ulrichskirchen
  '2123', // Kronberg
  '2124', // Niederleis
  '2125', // Bogenneusiedl
  '2126', // Ladendorf
  '2130', // Mistelbach
  '2132', // Frättingsdorf
  '2133', // Fallbach
  '2134', // Staatz
  '2135', // Neudorf bei Staatz
  '2136', // Laa an der Thaya
  '2141', // Ameis
  '2143', // Großkrut
  '2144', // Altlichtenwarth
  '2145', // Hausbrunn

  // ============================================
  // NORDEN - Greifenstein/Tulln & Donau
  // ============================================
  '3400', // Klosterneuburg (ACHTUNG: Whitelist nimmt Vorrang!)
  '3420', // Kritzendorf
  '3421', // Höflein an der Donau
  '3422', // Greifenstein/Hadersfeld
  '3423', // St. Andrä-Wördern
  '3424', // Zeiselmauer-Wolfpassing
  '3425', // Muckendorf-Wipfing
  '3426', // Königstetten
  '3430', // Tulln an der Donau
  '3433', // Königstetten
  '3434', // Tulbing
  '3435', // Zwentendorf
  '3441', // Freundorf
  '3442', // Langenrohr
  '3443', // Sieghartskirchen
  '3451', // Michelhausen
  '3452', // Atzenbrugg
  '3454', // Reidling
  '3462', // Absdorf
  '3463', // Stetteldorf
  '3464', // Hausleiten
  '3465', // Königsbrunn
  '3470', // Kirchberg am Wagram
  '3471', // Großriedenthal
  '3472', // Hohenwarth
  '3481', // Fels am Wagram
  '3482', // Gösing am Wagram
  '3483', // Feuersbrunn
  '3484', // Grafenwörth
  '3485', // Haitzendorf
  '3491', // Straß im Straßertale
  '3492', // Etsdorf am Kamp
  '3493', // Hadersdorf am Kamp

  // ============================================
  // WESTEN - Purkersdorf/Wienerwald
  // ============================================
  '3001', // Mauerbach
  '3002', // Purkersdorf
  '3003', // Gablitz
  '3004', // Riederberg
  '3011', // Tullnerbach
  '3012', // Wolfsgraben
  '3013', // Pressbaum
  '3014', // Rekawinkel
  '3021', // Pressbaum
  '3031', // Rekawinkel
  '3032', // Eichgraben
  '3033', // Altlengbach
  '3034', // Maria Anzbach

  // ============================================
  // WESTEN - Neulengbach/St. Pölten
  // ============================================
  '3040', // Neulengbach
  '3041', // Asperhofen
  '3042', // Würmla
  '3051', // St. Christophen
  '3052', // Innermanzing
  '3053', // Laaben
  '3061', // Ollersbach
  '3062', // Kirchstetten
  '3100', // St. Pölten
  '3101', // St. Pölten
  '3104', // St. Pölten
  '3105', // Unterradlberg
  '3107', // St. Pölten
  '3108', // St. Pölten
  '3109', // St. Pölten
];

// Whitelist: Bezirke/Orte die SEHR interessant sind (<25 min von Wien)
const WHITELISTED_LOCATIONS = new Set([
  // ============================================
  // BEZIRK MÖDLING - KOMPLETT (<20 min)
  // ============================================
  'mödling',
  'moedling',
  'maria enzersdorf',
  'brunn am gebirge',
  'wiener neudorf',
  'biedermannsdorf',
  'achau',
  'guntramsdorf',
  'münchendorf',
  'münchendorfer',
  'perchtoldsdorf',
  'hinterbrühl',
  'gaaden',
  'gumpoldskirchen',
  'hennersdorf',
  'laxenburg',
  'vösendorf',
  'voesendorf',
  'gießhübl',
  'giesshuebl',
  'laab im walde',

  // ============================================
  // SCHWECHAT & UMGEBUNG (<20 min)
  // ============================================
  'schwechat',
  'rannersdorf',
  'mannswörth',
  'mannswoerth',
  'zwölfaxing',
  'zwoelfaxing',
  'maria lanzendorf',
  'lanzendorf',
  'himberg',
  'velm',

  // ============================================
  // OSTEN NAH (<25 min)
  // ============================================
  'groß-enzersdorf',
  'gross-enzersdorf',
  'großenzersdorf',
  'grossenzersdorf',
  'essling',

  // ============================================
  // KLOSTERNEUBURG - nahe Gebiete (<25 min)
  // ============================================
  'klosterneuburg',
  'weidling',
  'kierling',
  'gugging',
  'kritzendorf', // Nur der ort selbst, nicht die PLZ-Region

  // ============================================
  // GERASDORF/NORDEN NAH (<25 min)
  // ============================================
  'gerasdorf',
  'süßenbrunn',
  'suessenbrunn',
]);

// PLZ-Whitelist (alle <25 min von Wien Zentrum)
const WHITELISTED_PLZ_PREFIXES = [
  // ============================================
  // BEZIRK MÖDLING
  // ============================================
  '2331', // Vösendorf
  '2332', // Hennersdorf
  '2333', // Leopoldsdorf bei Wien
  '2334', // Vösendorf-Süd
  '2340', // Mödling
  '2344', // Maria Enzersdorf
  '2345', // Brunn am Gebirge
  '2351', // Wiener Neudorf
  '2352', // Gumpoldskirchen
  '2353', // Guntramsdorf
  '2354', // Hafnerberg (borderline)
  '2355', // Wiener Neudorf
  '2356', // Wiener Neudorf
  '2361', // Laxenburg
  '2362', // Biedermannsdorf
  '2371', // Hinterbrühl
  '2372', // Gießhübl
  '2380', // Perchtoldsdorf
  '2381', // Laab im Walde

  // ============================================
  // SCHWECHAT & UMGEBUNG
  // ============================================
  '2320', // Schwechat
  '2322', // Zwölfaxing
  '2324', // Mannswörth

  // ============================================
  // HIMBERG/SÜDEN NAH
  // ============================================
  '2325', // Himberg
  '2326', // Maria Lanzendorf
  '2327', // Lanzendorf

  // ============================================
  // GROß-ENZERSDORF/OSTEN NAH
  // ============================================
  '2301', // Groß-Enzersdorf
  '2304', // Orth (nur Stadtrand)

  // ============================================
  // KLOSTERNEUBURG (nur nahe Teile!)
  // ============================================
  '3400', // Klosterneuburg Zentrum
  '3401', // Klosterneuburg
  '3402', // Klosterneuburg

  // ============================================
  // GERASDORF/NORDEN NAH
  // ============================================
  '2201', // Gerasdorf bei Wien
  '2202', // Enzersfeld
];

/**
 * Prüft ob ein Ort auf der Blacklist steht
 */
function isBlacklistedLocation(location: string): boolean {
  const normalized = location.toLowerCase().trim();

  // Prüfe jeden blacklisted Ort
  const blacklistedArray = Array.from(BLACKLISTED_LOCATIONS);
  for (const blacklisted of blacklistedArray) {
    if (normalized.includes(blacklisted)) {
      return true;
    }
  }

  return false;
}

/**
 * Prüft ob ein Ort auf der Whitelist steht
 */
function isWhitelistedLocation(location: string): boolean {
  const normalized = location.toLowerCase().trim();

  // Prüfe jeden whitelisted Ort
  const whitelistedArray = Array.from(WHITELISTED_LOCATIONS);
  for (const whitelisted of whitelistedArray) {
    if (normalized.includes(whitelisted)) {
      return true;
    }
  }

  return false;
}

/**
 * Prüft ob eine PLZ blacklisted ist
 */
function isBlacklistedPLZ(location: string): boolean {
  // Extrahiere PLZ aus Location (z.B. "2500 Wiener Neustadt" -> "2500")
  const plzMatch = location.match(/\b\d{4}\b/);
  if (!plzMatch) return false;

  const plz = plzMatch[0];

  // Prüfe ob PLZ mit einem blacklisted Prefix beginnt
  return BLACKLISTED_PLZ_PREFIXES.some(prefix => plz.startsWith(prefix));
}

/**
 * Prüft ob eine PLZ whitelisted ist
 */
function isWhitelistedPLZ(location: string): boolean {
  // Extrahiere PLZ aus Location
  const plzMatch = location.match(/\b\d{4}\b/);
  if (!plzMatch) return false;

  const plz = plzMatch[0];

  // Prüfe ob PLZ mit einem whitelisted Prefix beginnt
  return WHITELISTED_PLZ_PREFIXES.some(prefix => plz.startsWith(prefix));
}

/**
 * HAUPTFUNKTION: Prüft ob ein Listing im gewünschten Akquise-Gebiet liegt
 *
 * @param location - Der Location-String aus dem Listing (z.B. "2340 Mödling" oder "Klosterneuburg")
 * @param region - Die Region (wien oder niederoesterreich)
 * @returns true wenn das Listing INTERESSANT ist, false wenn es NICHT interessant ist
 */
export function isInAkquiseGebiet(location: string, region: string): { allowed: boolean; reason: string } {
  if (!location) {
    return { allowed: true, reason: 'No location data' };
  }

  // Wien ist IMMER interessant (komplett)
  if (region === 'wien') {
    return { allowed: true, reason: 'Wien komplett erlaubt' };
  }

  // Niederösterreich: Prüfe Filter
  if (region === 'niederoesterreich') {
    // 1. WHITELIST hat höchste Priorität (<25 min: Mödling, Schwechat, Klosterneuburg, etc.)
    if (isWhitelistedPLZ(location)) {
      return { allowed: true, reason: 'PLZ auf Whitelist (<25 min von Wien)' };
    }

    if (isWhitelistedLocation(location)) {
      return { allowed: true, reason: 'Ort auf Whitelist (<25 min von Wien)' };
    }

    // 2. BLACKLIST hat zweithöchste Priorität
    if (isBlacklistedPLZ(location)) {
      return { allowed: false, reason: `PLZ blacklisted (zu weit/uninteressant): ${location}` };
    }

    if (isBlacklistedLocation(location)) {
      return { allowed: false, reason: `Ort blacklisted (zu weit/uninteressant): ${location}` };
    }

    // 3. Default für NÖ: BLOCKIEREN (nur explizit gewhitelistete Orte erlauben)
    // Begründung: Die meisten unbekannten NÖ-Orte sind zu weit weg von Wien
    return { allowed: false, reason: 'NÖ Standard (nicht auf Whitelist - blockiert)' };
  }

  // Andere Regionen: Erlauben
  return { allowed: true, reason: 'Andere Region' };
}

/**
 * Filter-Funktion für Listings
 * Kann direkt in den Scrapern verwendet werden
 */
export function filterListingByGeo(listing: { location: string; region: string }): boolean {
  const result = isInAkquiseGebiet(listing.location, listing.region);
  return result.allowed;
}

/**
 * Extrahiert PLZ und Ort aus einem Location-String
 * z.B. "2500 Baden" → { plz: "2500", ort: "Baden" }
 * z.B. "1010 Wien, Innere Stadt" → { plz: "1010", ort: "Wien" }
 */
export function extractPlzAndOrt(location: string): { plz: string | null; ort: string | null } {
  if (!location) {
    return { plz: null, ort: null };
  }

  // Pattern: "XXXX Ort" oder "XXXX Ort, ..."
  const match = location.match(/(\d{4})\s+([^,]+)/);

  if (match) {
    return {
      plz: match[1],
      ort: match[2].trim(),
    };
  }

  // Fallback: Kein PLZ gefunden, ganzer String als Ort
  return {
    plz: null,
    ort: location.trim(),
  };
}
