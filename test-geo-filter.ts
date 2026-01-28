/**
 * Test-Script: Alle Listings durch den Geo-Filter laufen lassen
 *
 * Zeigt welche Listings blockiert werden würden und warum.
 *
 * Usage: npx tsx test-geo-filter.ts
 */

import { db } from './server/db';
import { listings } from './shared/schema';
import { isInAkquiseGebiet } from './server/services/geo-filter';
// No drizzle-orm imports needed - we filter in JS

interface FilterResult {
  id: number;
  title: string;
  location: string;
  region: string;
  allowed: boolean;
  reason: string;
  url: string;
}

async function testGeoFilter() {
  console.log('🔍 Lade alle aktiven Listings aus der Datenbank...\n');

  // Hole alle Listings mit einfacher Query
  const allListingsRaw = await db.select().from(listings);

  // Filter nur aktive Listings (nicht gelöscht) in JavaScript
  const allListings = allListingsRaw.filter(l => !l.deleted_at);

  console.log(`📊 ${allListings.length} aktive Listings gefunden\n`);

  const blocked: FilterResult[] = [];
  const allowed: FilterResult[] = [];
  const noLocation: FilterResult[] = [];

  // Teste jedes Listing
  for (const listing of allListings) {
    if (!listing.location) {
      noLocation.push({
        id: listing.id,
        title: listing.title || 'Kein Titel',
        location: 'KEINE LOCATION',
        region: listing.region || 'unbekannt',
        allowed: true,
        reason: 'Keine Location-Daten',
        url: listing.url || '',
      });
      continue;
    }

    const result = isInAkquiseGebiet(listing.location, listing.region || '');

    const filterResult: FilterResult = {
      id: listing.id,
      title: listing.title || 'Kein Titel',
      location: listing.location,
      region: listing.region || 'unbekannt',
      allowed: result.allowed,
      reason: result.reason,
      url: listing.url || '',
    };

    if (result.allowed) {
      allowed.push(filterResult);
    } else {
      blocked.push(filterResult);
    }
  }

  // Ergebnisse ausgeben
  console.log('=' .repeat(80));
  console.log('📊 ERGEBNIS-ZUSAMMENFASSUNG');
  console.log('='.repeat(80));
  console.log(`✅ Erlaubt:        ${allowed.length} Listings`);
  console.log(`❌ Blockiert:      ${blocked.length} Listings`);
  console.log(`⚠️  Ohne Location:  ${noLocation.length} Listings`);
  console.log('='.repeat(80));

  // Blockierte Listings nach Region gruppieren
  if (blocked.length > 0) {
    console.log('\n❌ BLOCKIERTE LISTINGS (würden gefiltert werden):\n');

    // Nach Grund gruppieren
    const byReason: Record<string, FilterResult[]> = {};
    for (const b of blocked) {
      const key = b.reason;
      if (!byReason[key]) byReason[key] = [];
      byReason[key].push(b);
    }

    for (const [reason, items] of Object.entries(byReason)) {
      console.log(`\n📍 ${reason} (${items.length} Listings):`);
      console.log('-'.repeat(60));

      // Nur erste 10 pro Kategorie zeigen
      const displayItems = items.slice(0, 10);
      for (const item of displayItems) {
        console.log(`  ID ${item.id}: ${item.location}`);
        console.log(`     ${item.title.substring(0, 60)}...`);
      }

      if (items.length > 10) {
        console.log(`  ... und ${items.length - 10} weitere`);
      }
    }
  }

  // Statistik nach Location
  console.log('\n\n📊 STATISTIK NACH LOCATION:');
  console.log('='.repeat(80));

  // Extrahiere unique Orte aus blockierten Listings
  const blockedLocations: Record<string, number> = {};
  for (const b of blocked) {
    // Extrahiere Ort aus Location (z.B. "2500 Baden" -> "Baden")
    const match = b.location.match(/\d{4}\s+(.+)/);
    const ort = match ? match[1].split(',')[0].trim() : b.location;
    blockedLocations[ort] = (blockedLocations[ort] || 0) + 1;
  }

  // Sortiere nach Häufigkeit
  const sortedLocations = Object.entries(blockedLocations)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20);

  console.log('\nTop 20 blockierte Orte:');
  for (const [ort, count] of sortedLocations) {
    console.log(`  ${count.toString().padStart(3)} x ${ort}`);
  }

  // Erlaubte Orte (Sample)
  console.log('\n\n✅ ERLAUBTE LISTINGS (Sample):');
  console.log('='.repeat(80));

  const allowedByRegion: Record<string, FilterResult[]> = {};
  for (const a of allowed) {
    const key = a.region;
    if (!allowedByRegion[key]) allowedByRegion[key] = [];
    allowedByRegion[key].push(a);
  }

  for (const [region, items] of Object.entries(allowedByRegion)) {
    console.log(`\n📍 ${region} (${items.length} Listings):`);

    // Nur erste 5 pro Region zeigen
    const displayItems = items.slice(0, 5);
    for (const item of displayItems) {
      console.log(`  ✅ ${item.location} - ${item.reason}`);
    }
  }

  console.log('\n\n✅ Test abgeschlossen!');

  // Return stats for programmatic use
  return {
    total: allListings.length,
    allowed: allowed.length,
    blocked: blocked.length,
    noLocation: noLocation.length,
    blockedListings: blocked,
  };
}

// Run the test
testGeoFilter()
  .then((stats) => {
    console.log('\n📈 Final Stats:', JSON.stringify({
      total: stats.total,
      allowed: stats.allowed,
      blocked: stats.blocked,
      noLocation: stats.noLocation,
      blockRate: `${((stats.blocked / stats.total) * 100).toFixed(1)}%`,
    }, null, 2));
    process.exit(0);
  })
  .catch((err) => {
    console.error('❌ Fehler:', err);
    process.exit(1);
  });
