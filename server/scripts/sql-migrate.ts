import 'dotenv/config';
import { pool } from '../db';

async function main() {
  const client = await pool.connect();
  try {
    console.log('[SQL] Creating table scraper_state if not exists...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS scraper_state (
        id serial PRIMARY KEY,
        state_key text NOT NULL UNIQUE,
        next_page integer NOT NULL,
        updated_at timestamp DEFAULT now() NOT NULL
      );
    `);

    console.log('[SQL] Upserting initial scraper_state rows...');
    await client.query(`
      INSERT INTO scraper_state (state_key, next_page) VALUES
        ('eigentumswohnung-wien', 2),
        ('eigentumswohnung-niederoesterreich', 1),
        ('grundstueck-wien', 1),
        ('grundstueck-niederoesterreich', 1)
      ON CONFLICT (state_key)
      DO UPDATE SET next_page = EXCLUDED.next_page, updated_at = now();
    `);

    console.log('[SQL] Repairing listings ID sequence to MAX(id)...');
    await client.query(`
      SELECT setval(
        pg_get_serial_sequence('listings','id'),
        COALESCE((SELECT MAX(id) FROM listings), 0),
        true
      );
    `);

    console.log('[DONE] Migration and fixes completed.');
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('[ERROR]', err);
  process.exit(1);
});
