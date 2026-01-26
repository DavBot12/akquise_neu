import dotenv from 'dotenv';

// MUST load .env BEFORE importing db
dotenv.config({ path: '.env.development' });

import { db } from '../server/db';
import { listings } from '@shared/schema';

async function clearListings() {
  console.log('Deleting all listings...');

  const result = await db.delete(listings);

  console.log('✓ All listings deleted');
  process.exit(0);
}

clearListings().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
