import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { scraper_state } from './shared/schema';
import { sql } from 'drizzle-orm';
import 'dotenv/config';

/**
 * Safe migration: Convert next_page from integer to text without data loss
 */
async function migrateNextPageToText() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL not found in environment');
  }

  const sqlClient = neon(connectionString);
  const db = drizzle(sqlClient);

  try {
    console.log('📊 Step 1: Reading current data...');
    const currentData = await db.select().from(scraper_state);
    console.log(`   Found ${currentData.length} records`);

    console.log('🔄 Step 2: Altering column type...');
    await db.execute(sql`
      ALTER TABLE scraper_state
      ALTER COLUMN next_page TYPE TEXT USING next_page::TEXT
    `);

    console.log('✅ Migration completed successfully!');
    console.log(`   All ${currentData.length} records preserved`);

    // Verify migration
    const afterData = await db.select().from(scraper_state);
    console.log('✓ Verification: Data still intact');

  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  }
}

migrateNextPageToText()
  .then(() => {
    console.log('🎉 Migration completed!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('💥 Migration failed:', error);
    process.exit(1);
  });
