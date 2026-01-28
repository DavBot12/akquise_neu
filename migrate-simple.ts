import { db } from './server/db';
import { sql } from 'drizzle-orm';

async function migrateNextPage() {
  try {
    console.log('🔄 Altering column type from integer to text...');

    await db.execute(sql`
      ALTER TABLE scraper_state
      ALTER COLUMN next_page TYPE TEXT USING next_page::TEXT
    `);

    console.log('✅ Migration completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

migrateNextPage();
