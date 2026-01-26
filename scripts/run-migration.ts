import pkg from 'pg';
const { Pool } = pkg;
import fs from 'fs';
import path from 'path';

async function runMigration() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    // Read the migration file
    const migrationPath = path.join(process.cwd(), 'migrations', '0003_add_source_field.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf-8');

    console.log('Running migration 0003_add_source_field.sql...');
    console.log(migrationSQL);

    // Execute the migration
    await pool.query(migrationSQL);

    console.log('✅ Migration completed successfully!');
  } catch (error: any) {
    console.error('❌ Migration failed:', error.message);
    throw error;
  } finally {
    await pool.end();
  }
}

runMigration();
