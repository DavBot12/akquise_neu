import 'dotenv/config';
import { db } from '../db';
import { sql } from 'drizzle-orm';

async function checkDuplicates() {
  console.log('🔍 Checking for duplicate acquisitions...\n');

  try {
    // Check for duplicates
    const duplicates = await db.execute(sql`
      SELECT user_id, listing_id, COUNT(*) as count
      FROM acquisitions
      GROUP BY user_id, listing_id
      HAVING COUNT(*) > 1
      ORDER BY count DESC
    `);

    if (duplicates.rows.length === 0) {
      console.log('✅ No duplicates found! Database is clean.');
    } else {
      console.log(`⚠️  Found ${duplicates.rows.length} duplicate user-listing combinations:\n`);
      duplicates.rows.forEach((row: any) => {
        console.log(`   User ${row.user_id} + Listing ${row.listing_id}: ${row.count} records`);
      });
    }

    // Get total stats
    const stats = await db.execute(sql`
      SELECT
        COUNT(*) as total_records,
        COUNT(DISTINCT (user_id, listing_id)) as unique_combinations
      FROM acquisitions
    `);

    console.log('\n📊 Overall Stats:');
    console.log(`   Total acquisition records: ${stats.rows[0].total_records}`);
    console.log(`   Unique user-listing combos: ${stats.rows[0].unique_combinations}`);
    console.log(`   Duplicate records: ${Number(stats.rows[0].total_records) - Number(stats.rows[0].unique_combinations)}`);

  } catch (error: any) {
    console.error('❌ Error:', error.message);
    throw error;
  } finally {
    process.exit(0);
  }
}

checkDuplicates().catch(console.error);
