import 'dotenv/config';
import { db } from '../db';
import { listings, discovered_links, scraper_state, price_mirror_data } from '@shared/schema';

async function clearDatabase() {
  try {
    console.log('🗑️  Clearing NeonDB...');

    // Delete all data from tables (order matters due to foreign keys)
    await db.delete(discovered_links);
    console.log('✅ Cleared discovered_links');

    await db.delete(listings);
    console.log('✅ Cleared listings');

    await db.delete(scraper_state);
    console.log('✅ Cleared scraper_state');

    await db.delete(price_mirror_data);
    console.log('✅ Cleared price_mirror_data');

    console.log('');
    console.log('🎉 Database cleared successfully!');
    console.log('📊 All tables are now empty and ready for fresh scraping.');

    process.exit(0);
  } catch (error) {
    console.error('❌ Error clearing database:', error);
    process.exit(1);
  }
}

clearDatabase();
