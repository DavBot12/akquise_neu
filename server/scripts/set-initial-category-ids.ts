import { db } from '../db';
import { scraper_state } from '../../shared/schema';

async function setInitialCategoryIds() {
  try {
    console.log('Setting initial category IDs for NEWEST scraper...');

    // 4 categories with their initial IDs
    const categories = [
      { key: 'eigentumswohnung-wien', id: '1961300544' },
      { key: 'haus-wien', id: '2133428463' },
      { key: 'haus-niederoesterreich', id: '1448776617' },
      { key: 'eigentumswohnung-niederoesterreich', id: null }, // To be determined
    ];

    for (const category of categories) {
      const stateKey = `newest-scraper-${category.key}`;

      if (category.id) {
        await db
          .insert(scraper_state)
          .values({
            state_key: stateKey,
            next_page: 0,
            state_value: category.id
          })
          .onConflictDoUpdate({
            target: scraper_state.state_key,
            set: {
              state_value: category.id,
              updated_at: new Date()
            }
          });

        console.log(`✅ Set ${category.key}: ${category.id}`);
      } else {
        console.log(`⏭️ Skipped ${category.key}: no ID provided`);
      }
    }

    console.log('✅ All initial category IDs have been set');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error setting initial category IDs:', error);
    process.exit(1);
  }
}

setInitialCategoryIds();
