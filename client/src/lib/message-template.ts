import type { Listing } from "@shared/schema";

export function personalizeMessage(template: string, listing: Listing): string {
  const bezirk = extractBezirk(listing.location, listing.region);
  const objekttyp = mapCategoryToGerman(listing.category);

  return template
    .replace(/\{\{bezirk\}\}/g, bezirk)
    .replace(/\{\{objekttyp\}\}/g, objekttyp);
}

function extractBezirk(location: string, region: string): string {
  // Extract PLZ from location (e.g., "1030 Wien" → "3. Bezirk")
  const plzMatch = location.match(/1(\d{2})\d/);
  if (plzMatch) {
    const bezirkNr = parseInt(plzMatch[1], 10);
    return `${bezirkNr}. Bezirk`;
  }

  // For Niederösterreich: Extract city name from location
  // Examples: "2340 Mödling" → "Mödling", "Baden bei Wien" → "Baden bei Wien"
  if (region !== 'wien') {
    // Remove PLZ if present (e.g., "2340 Mödling" → "Mödling")
    const cityMatch = location.replace(/^\d{4}\s*/, '').trim();
    return cityMatch || location;
  }

  // Fallback for Wien
  return 'Wien';
}

function mapCategoryToGerman(category: string): string {
  const mapping: Record<string, string> = {
    'eigentumswohnung': 'Wohnung',
    'haus': 'Haus',
    'grundstueck': 'Grundstück'
  };
  return mapping[category] || 'Immobilie';
}
