import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

neonConfig.webSocketConstructor = ws;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function runMigration() {
  console.log('🔄 Running migration: 0004_add_unique_constraint_acquisitions.sql');

  try {
    const migrationPath = join(__dirname, '../../migrations/0004_add_unique_constraint_acquisitions.sql');
    const sql = readFileSync(migrationPath, 'utf-8');

    console.log('📄 Executing SQL...');
    await pool.query(sql);

    console.log('✅ Migration completed successfully!');
    console.log('📊 Duplicate acquisitions removed and unique constraint added.');
  } catch (error: any) {
    console.error('❌ Migration failed:', error.message);
    throw error;
  } finally {
    await pool.end();
  }
}

runMigration().catch(console.error);
