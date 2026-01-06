import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';
import * as dotenv from 'dotenv';

dotenv.config();

neonConfig.webSocketConstructor = ws;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function resetDatabase() {
  const client = await pool.connect();

  try {
    console.log('🗑️  Starte DB Reset...\n');

    // Tabellen in richtiger Reihenfolge löschen (wegen Foreign Keys)
    const tables = [
      'acquisitions',
      'listing_contacts',
      'user_sessions',
      'listings',
      'contacts',
      'discovered_links',
      'price_mirror_data',
      'scraper_state'
      // users NICHT löschen - behalten für Login
    ];

    for (const table of tables) {
      console.log(`  Lösche ${table}...`);
      await client.query(`TRUNCATE TABLE ${table} RESTART IDENTITY CASCADE`);
    }

    console.log('\n✅ Alle Tabellen geleert!');
    console.log('✅ ID-Sequences auf 1 zurückgesetzt!');
    console.log('\n📊 User-Accounts bleiben erhalten (für Login)');

  } catch (error) {
    console.error('❌ Fehler beim DB Reset:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

resetDatabase();
