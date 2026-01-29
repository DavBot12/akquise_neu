/**
 * PRODUCTION STARTUP SCRIPT
 *
 * Runs on production start:
 * 1. Applies database migrations
 * 2. Scans for duplicate listings
 * 3. Merges duplicates (keeps newer, deletes older)
 * 4. Outputs statistics
 *
 * Run with: npx tsx server/startup-production.ts
 */

import 'dotenv/config';
import { db } from './db';
import { sql, eq } from 'drizzle-orm';
import { listings } from '../shared/schema';

interface DuplicateGroup {
  price: number;
  area: string | null;
  location: string;
  listings: {
    id: number;
    title: string;
    url: string;
    scraped_at: Date;
    first_seen_at: Date;
    description: string | null;
    images: string[] | null;
  }[];
}

async function runMigrations() {
  console.log('\n========================================');
  console.log('🔧 RUNNING DATABASE MIGRATIONS');
  console.log('========================================\n');

  // Migration 1: Add last_change_type column
  try {
    await db.execute(sql`
      ALTER TABLE listings
      ADD COLUMN IF NOT EXISTS last_change_type TEXT
    `);
    console.log('✅ Migration: last_change_type column added/verified');
  } catch (error: any) {
    if (!error.message?.includes('already exists')) {
      console.error('❌ Migration error:', error.message);
    }
  }

  console.log('✅ All migrations complete\n');
}

/**
 * Extract Willhaben listing ID from URL
 * Format: https://www.willhaben.at/iad/.../titel-1234567890
 */
function extractWillhabenId(url: string): string | null {
  if (!url.includes('willhaben')) return null;
  const match = url.match(/[-\/](\d{8,12})\/?(?:\?|$)/);
  return match ? match[1] : null;
}

async function scanForDuplicates(): Promise<DuplicateGroup[]> {
  console.log('\n========================================');
  console.log('🔍 SCANNING FOR DUPLICATE LISTINGS');
  console.log('========================================\n');

  // Get all active Willhaben listings
  const allListings = await db
    .select({
      id: listings.id,
      title: listings.title,
      url: listings.url,
      price: listings.price,
      area: listings.area,
      location: listings.location,
      scraped_at: listings.scraped_at,
      first_seen_at: listings.first_seen_at,
      description: listings.description,
      images: listings.images,
      source: listings.source,
    })
    .from(listings)
    .where(sql`is_deleted = false`);

  // Group by Willhaben ID (extracted from URL)
  const willhabenGroups = new Map<string, typeof allListings>();

  for (const listing of allListings) {
    const willhabenId = extractWillhabenId(listing.url);

    if (willhabenId) {
      // Group by Willhaben ID - EXACT duplicates
      const existing = willhabenGroups.get(willhabenId) || [];
      existing.push(listing);
      willhabenGroups.set(willhabenId, existing);
    }
  }

  // Convert to DuplicateGroup format (only groups with 2+ listings)
  const duplicateGroups: DuplicateGroup[] = [];

  Array.from(willhabenGroups.entries()).forEach(([willhabenId, groupListings]) => {
    if (groupListings.length > 1) {
      duplicateGroups.push({
        price: groupListings[0].price,
        area: groupListings[0].area,
        location: groupListings[0].location,
        listings: groupListings.map((l: any) => ({
          id: l.id,
          title: l.title,
          url: l.url,
          scraped_at: l.scraped_at,
          first_seen_at: l.first_seen_at,
          description: l.description,
          images: l.images,
        })),
      });
      console.log(`🔗 Willhaben ID ${willhabenId}: ${groupListings.length} duplicates`);
    }
  });

  console.log(`\nFound ${duplicateGroups.length} duplicate groups (by Willhaben ID)\n`);
  return duplicateGroups;
}

function detectChanges(older: any, newer: any): string | null {
  const changes: string[] = [];

  if (older.title !== newer.title) {
    changes.push('Titel');
  }

  const oldDesc = (older.description || '').trim();
  const newDesc = (newer.description || '').trim();
  if (oldDesc !== newDesc && newDesc.length > 0) {
    changes.push('Beschreibung');
  }

  const oldImages = older.images?.length || 0;
  const newImages = newer.images?.length || 0;
  if (oldImages !== newImages) {
    changes.push('Bilder');
  }

  return changes.length > 0 ? changes.join(', ') : null;
}

async function mergeDuplicates(groups: DuplicateGroup[]): Promise<{
  merged: number;
  deleted: number;
  changesDetected: number;
}> {
  console.log('\n========================================');
  console.log('🔄 MERGING DUPLICATES');
  console.log('========================================\n');

  let merged = 0;
  let deleted = 0;
  let changesDetected = 0;

  for (const group of groups) {
    // Sort by scraped_at DESC (newest first)
    const sorted = [...group.listings].sort(
      (a, b) => new Date(b.scraped_at).getTime() - new Date(a.scraped_at).getTime()
    );

    const newest = sorted[0];
    const olderOnes = sorted.slice(1);

    console.log(`\n📦 Group: €${group.price} | ${group.location} | ${group.area || 'N/A'}m²`);
    console.log(`   Keeping: ID ${newest.id} (${newest.title.substring(0, 40)}...)`);

    for (const older of olderOnes) {
      // Detect what changed between versions
      const changeType = detectChanges(older, newest);

      if (changeType) {
        changesDetected++;
        console.log(`   Changes detected: ${changeType}`);

        // Update the newer listing with change info if not already set
        await db
          .update(listings)
          .set({
            last_change_type: changeType,
            last_changed_at: newest.scraped_at,
          })
          .where(eq(listings.id, newest.id));
      }

      // Soft-delete the older duplicate
      await db
        .update(listings)
        .set({
          is_deleted: true,
          deletion_reason: `Duplikat von ID ${newest.id} (zusammengeführt)`,
        })
        .where(eq(listings.id, older.id));

      console.log(`   Deleted: ID ${older.id} (older duplicate)`);
      deleted++;
    }

    merged++;
  }

  return { merged, deleted, changesDetected };
}

async function printStatistics(stats: { merged: number; deleted: number; changesDetected: number }) {
  console.log('\n========================================');
  console.log('📊 CLEANUP STATISTICS');
  console.log('========================================\n');

  console.log(`✅ Duplicate groups processed: ${stats.merged}`);
  console.log(`🗑️  Listings soft-deleted: ${stats.deleted}`);
  console.log(`📝 Changes detected: ${stats.changesDetected}`);

  // Get current counts
  const activeCount = await db.execute(sql`
    SELECT COUNT(*) as count FROM listings WHERE is_deleted = false
  `);
  const deletedCount = await db.execute(sql`
    SELECT COUNT(*) as count FROM listings WHERE is_deleted = true
  `);

  console.log(`\n📈 Current Database State:`);
  console.log(`   Active listings: ${(activeCount.rows[0] as any).count}`);
  console.log(`   Deleted listings: ${(deletedCount.rows[0] as any).count}`);
  console.log('\n========================================\n');
}

async function main() {
  console.log('\n🚀 AKQUISE TOOL - PRODUCTION STARTUP');
  console.log('====================================\n');

  try {
    // Step 1: Run migrations
    await runMigrations();

    // Step 2: Scan for duplicates
    const duplicateGroups = await scanForDuplicates();

    // Step 3: Merge duplicates if any found
    if (duplicateGroups.length > 0) {
      const stats = await mergeDuplicates(duplicateGroups);

      // Step 4: Print statistics
      await printStatistics(stats);
    } else {
      console.log('✅ No duplicates found - database is clean!\n');
    }

    console.log('🎉 Startup complete!\n');
    process.exit(0);
  } catch (error: any) {
    console.error('\n❌ STARTUP ERROR:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

main();
