import { db } from '../db';
import { sql } from 'drizzle-orm';

/**
 * Migration: Add state_value column to scraper_state table
 *
 * This column allows storing text values (like listing IDs) in the scraper state,
 * which is needed for the smart pagination feature.
 *
 * Usage:
 *   With DATABASE_URL set: npx tsx server/scripts/add-state-value-column.ts
 *   Or run SQL directly: ALTER TABLE scraper_state ADD COLUMN IF NOT EXISTS state_value TEXT;
 */
async function migrate() {
  try {
    console.log('Starting migration: Adding state_value column to scraper_state...');

    await db.execute(sql`
      ALTER TABLE scraper_state ADD COLUMN IF NOT EXISTS state_value TEXT;
    `);

    console.log('✅ Migration completed successfully');
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

migrate();
