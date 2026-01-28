/**
 * Einmaliges Geo-Filter Cleanup Script
 *
 * Geht durch alle aktiven Listings und:
 * 1. Prüft ob sie im Akquise-Gebiet liegen
 * 2. Verschiebt blockierte Listings nach geo_blocked_listings
 * 3. Soft-deleted sie aus listings
 *
 * Usage: npx tsx cleanup-geo.ts
 *
 * ACHTUNG: Dieses Script verändert Daten! Backup empfohlen.
 */

import pkg from 'pg';
const { Pool } = pkg;

// Direct import of geo-filter
import { isInAkquiseGebiet, extractPlzAndOrt } from './server/services/geo-filter';

// Create db connection directly (raw SQL to avoid schema issues)
if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set.");
}
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

interface CleanupResult {
  id: number;
  title: string;
  location: string;
  region: string;
  reason: string;
  url: string;
}

async function cleanupGeoFilter() {
  console.log('🧹 GEO-FILTER CLEANUP SCRIPT');
  console.log('============================\n');

  // Hole alle aktiven Listings (nicht gelöscht) - raw SQL
  console.log('📊 Lade alle aktiven Listings...');
  const result = await pool.query(`
    SELECT id, title, location, region, url, price, source, category
    FROM listings
    WHERE is_deleted = false
  `);
  const allListingsRaw = result.rows;

  console.log(`   ${allListingsRaw.length} aktive Listings gefunden\n`);

  const toBlock: CleanupResult[] = [];
  const allowed: CleanupResult[] = [];
  const noLocation: CleanupResult[] = [];

  // Prüfe jedes Listing
  console.log('🔍 Prüfe Geo-Filter für jedes Listing...\n');

  for (const listing of allListingsRaw) {
    if (!listing.location || !listing.region) {
      noLocation.push({
        id: listing.id,
        title: listing.title || 'Kein Titel',
        location: listing.location || 'KEINE LOCATION',
        region: listing.region || 'unbekannt',
        reason: 'Keine Location-Daten - wird behalten',
        url: listing.url || '',
      });
      continue;
    }

    const geoCheck = isInAkquiseGebiet(listing.location, listing.region);

    if (geoCheck.allowed) {
      allowed.push({
        id: listing.id,
        title: listing.title || 'Kein Titel',
        location: listing.location,
        region: listing.region,
        reason: geoCheck.reason,
        url: listing.url || '',
      });
    } else {
      toBlock.push({
        id: listing.id,
        title: listing.title || 'Kein Titel',
        location: listing.location,
        region: listing.region,
        reason: geoCheck.reason,
        url: listing.url || '',
      });
    }
  }

  // Zusammenfassung anzeigen
  console.log('📈 ZUSAMMENFASSUNG');
  console.log('==================');
  console.log(`✅ Erlaubt (bleiben):     ${allowed.length}`);
  console.log(`🚫 Zu blockieren:         ${toBlock.length}`);
  console.log(`❓ Ohne Location:         ${noLocation.length}`);
  console.log(`───────────────────────────`);
  console.log(`📊 Gesamt:                ${allListingsRaw.length}\n`);

  if (toBlock.length === 0) {
    console.log('✨ Keine Listings zu blockieren. Bestand ist sauber!\n');
    await pool.end();
    process.exit(0);
  }

  // Zeige was blockiert wird (erste 20)
  console.log('🚫 WIRD BLOCKIERT (erste 20):');
  console.log('─────────────────────────────');
  for (const item of toBlock.slice(0, 20)) {
    console.log(`  [${item.id}] ${item.location}`);
    console.log(`      → ${item.reason}`);
  }
  if (toBlock.length > 20) {
    console.log(`  ... und ${toBlock.length - 20} weitere\n`);
  }

  // Blockierte Orte zusammenfassen
  const blockedLocations = new Map<string, number>();
  for (const item of toBlock) {
    const { ort } = extractPlzAndOrt(item.location);
    const key = ort || item.location;
    blockedLocations.set(key, (blockedLocations.get(key) || 0) + 1);
  }

  console.log('\n📍 BLOCKIERTE ORTE (Top 15):');
  console.log('────────────────────────────');
  const sortedLocations = [...blockedLocations.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15);
  for (const [ort, count] of sortedLocations) {
    console.log(`  ${count.toString().padStart(3)}x ${ort}`);
  }

  // Automatisch fortfahren (für Docker-Deployment)
  console.log('\n🚀 Starte Cleanup...\n');

  // Cleanup durchführen
  console.log('🔄 Führe Cleanup durch...\n');

  let successCount = 0;
  let errorCount = 0;

  for (const item of toBlock) {
    try {
      // Hole vollständiges Listing für geo_blocked_listings
      const fullListing = allListingsRaw.find(l => l.id === item.id);
      if (!fullListing) continue;

      // 1. Speichere in geo_blocked_listings (raw SQL)
      const { plz, ort } = extractPlzAndOrt(item.location);
      await pool.query(`
        INSERT INTO geo_blocked_listings (title, price, location, region, category, plz, ort, url, source, block_reason, blocked_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
      `, [
        fullListing.title || '',
        fullListing.price ? parseInt(fullListing.price.toString()) : 0,
        fullListing.location || '',
        fullListing.region || '',
        fullListing.category || 'eigentumswohnung',
        plz,
        ort,
        fullListing.url || '',
        fullListing.source || 'willhaben',
        item.reason,
      ]);

      // 2. Soft-delete aus listings (raw SQL)
      await pool.query(`
        UPDATE listings SET is_deleted = true, deletion_reason = $1 WHERE id = $2
      `, [item.reason, item.id]);

      successCount++;

      // Progress anzeigen
      if (successCount % 50 === 0) {
        console.log(`   ${successCount}/${toBlock.length} verarbeitet...`);
      }
    } catch (error) {
      errorCount++;
      console.error(`   ❌ Fehler bei Listing ${item.id}: ${error}`);
    }
  }

  // Finale Zusammenfassung
  console.log('\n✅ CLEANUP ABGESCHLOSSEN');
  console.log('========================');
  console.log(`✅ Erfolgreich blockiert: ${successCount}`);
  console.log(`❌ Fehler:                ${errorCount}`);
  console.log(`📊 Verbleibende aktiv:    ${allowed.length + noLocation.length}`);

  console.log('\n💡 Du kannst blockierte Listings unter /blocked-listings einsehen.');
  console.log('   (Erreichbar über Settings → Blockierte Listings & Scraper-Statistiken)\n');

  await pool.end();
  process.exit(0);
}

// Script ausführen
cleanupGeoFilter().catch(async error => {
  console.error('❌ Kritischer Fehler:', error);
  try {
    await pool.end();
  } catch {}
  process.exit(1);
});
