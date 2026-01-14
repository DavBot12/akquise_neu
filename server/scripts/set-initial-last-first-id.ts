import { db } from '../db';
import { scraper_state } from '../../shared/schema';

/**
 * Sets the initial lastFirstListingId to avoid scraping all 20 pages on first run
 *
 * Usage: npx tsx server/scripts/set-initial-last-first-id.ts
 */
async function setInitialId() {
  try {
    console.log('Setting initial lastFirstListingId to 1961300544...');

    await db
      .insert(scraper_state)
      .values({
        state_key: 'newest-scraper-last-first-id',
        next_page: 0,
        state_value: '1961300544'
      })
      .onConflictDoUpdate({
        target: scraper_state.state_key,
        set: {
          state_value: '1961300544',
          updated_at: new Date()
        }
      });

    console.log('✅ Successfully set lastFirstListingId to 1961300544');
    console.log('   This listing: https://www.willhaben.at/iad/immobilien/d/eigentumswohnung/wien/wien-1150-rudolfsheim-fuenfhaus/provisionsfreie-dachgeschoss-maisonette-wohnung-1961300544/');
    process.exit(0);
  } catch (error) {
    console.error('❌ Failed to set lastFirstListingId:', error);
    process.exit(1);
  }
}

setInitialId();
