/**
 * ONE-TIME MIGRATION: Set last_changed_at = first_seen_at for existing listings
 *
 * This fixes all existing listings from DerStandard/ImmoScout that have last_changed_at = NULL
 *
 * Runs automatically on server startup (only once)
 */

import { db } from '../db';
import { listings } from '../../shared/schema';
import { sql, isNull } from 'drizzle-orm';

export async function fixLastChangedAt() {
  try {
    console.log('[MIGRATION] 🔧 Fixing last_changed_at for existing listings...');

    // Update all listings where last_changed_at is NULL
    // Set last_changed_at = first_seen_at
    const result = await db
      .update(listings)
      .set({
        last_changed_at: sql`${listings.first_seen_at}`
      })
      .where(isNull(listings.last_changed_at))
      .returning({ id: listings.id });

    console.log(`[MIGRATION] ✅ Fixed ${result.length} listings with NULL last_changed_at`);

    return result.length;
  } catch (error) {
    console.error('[MIGRATION] ❌ Error fixing last_changed_at:', error);
    throw error;
  }
}
