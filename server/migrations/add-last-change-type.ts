/**
 * Migration: Add last_change_type column to listings table
 *
 * Run with: npx tsx server/migrations/add-last-change-type.ts
 */

import 'dotenv/config';
import { db } from '../db';
import { sql } from 'drizzle-orm';

async function migrate() {
  console.log('Adding last_change_type column to listings...');

  try {
    await db.execute(sql`
      ALTER TABLE listings
      ADD COLUMN IF NOT EXISTS last_change_type TEXT
    `);

    console.log('✅ Migration complete: last_change_type column added');
  } catch (error: any) {
    if (error.message?.includes('already exists')) {
      console.log('Column already exists, skipping...');
    } else {
      console.error('Migration error:', error);
      throw error;
    }
  }

  process.exit(0);
}

migrate();
