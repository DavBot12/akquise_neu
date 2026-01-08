import 'dotenv/config';
import { db } from '../db';
import { sql } from 'drizzle-orm';

async function checkStatus() {
  console.log('🔍 Checking acquisition status distribution...\n');

  try {
    const statusCounts = await db.execute(sql`
      SELECT status, COUNT(*) as count
      FROM acquisitions
      GROUP BY status
      ORDER BY count DESC
    `);

    console.log('📊 Status Distribution:');
    statusCounts.rows.forEach((row: any) => {
      console.log(`   ${row.status}: ${row.count} records`);
    });

    console.log('\n🔍 Sample records:');
    const samples = await db.execute(sql`
      SELECT id, user_id, listing_id, status, contacted_at
      FROM acquisitions
      ORDER BY contacted_at DESC
      LIMIT 10
    `);

    samples.rows.forEach((row: any) => {
      console.log(`   ID ${row.id}: User ${row.user_id} + Listing ${row.listing_id} = ${row.status}`);
    });

  } catch (error: any) {
    console.error('❌ Error:', error.message);
    throw error;
  } finally {
    process.exit(0);
  }
}

checkStatus().catch(console.error);
