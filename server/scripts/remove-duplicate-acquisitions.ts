import 'dotenv/config';
import { db } from '../db';
import { acquisitions } from '../../shared/schema';
import { sql } from 'drizzle-orm';

async function removeDuplicates() {
  console.log('🔄 Removing duplicate acquisitions...');

  try {
    // Find and delete duplicates, keeping only the earliest record for each (user_id, listing_id) pair
    const result = await db.execute(sql`
      WITH duplicates AS (
        SELECT id,
               ROW_NUMBER() OVER (PARTITION BY user_id, listing_id ORDER BY contacted_at ASC) as rn
        FROM acquisitions
      )
      DELETE FROM acquisitions
      WHERE id IN (
        SELECT id FROM duplicates WHERE rn > 1
      )
      RETURNING id
    `);

    const deletedCount = result.rowCount || 0;
    console.log(`✅ Removed ${deletedCount} duplicate acquisition records`);
    console.log('📊 Each user-listing combination now has only one record (the earliest)');
    console.log('🎯 Team Performance counting should now be accurate!');
  } catch (error: any) {
    console.error('❌ Error removing duplicates:', error.message);
    throw error;
  } finally {
    process.exit(0);
  }
}

removeDuplicates().catch(console.error);
