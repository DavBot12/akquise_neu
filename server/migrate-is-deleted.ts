import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';
import * as dotenv from 'dotenv';

dotenv.config();

neonConfig.webSocketConstructor = ws;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function migrate() {
  const client = await pool.connect();

  try {
    console.log('Adding is_deleted and deletion_reason columns...');

    await client.query(`
      ALTER TABLE listings
      ADD COLUMN IF NOT EXISTS is_deleted boolean DEFAULT false NOT NULL
    `);

    await client.query(`
      ALTER TABLE listings
      ADD COLUMN IF NOT EXISTS deletion_reason text
    `);

    console.log('✓ Columns added successfully!');
  } catch (error) {
    console.error('Migration failed:', error);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
