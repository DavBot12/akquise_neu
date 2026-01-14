import { db } from "../db";
import { sql } from "drizzle-orm";

/**
 * Migration: Fügt is_approved Spalte zur users Tabelle hinzu
 * Alle existierenden Users (inkl. Admins) werden automatisch approved
 */
async function addIsApprovedColumn() {
  console.log("[MIGRATION] Adding is_approved column to users table...");

  try {
    // Füge is_approved Spalte hinzu (default: false)
    await db.execute(sql`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS is_approved BOOLEAN NOT NULL DEFAULT false
    `);

    console.log("[MIGRATION] ✅ Column is_approved added");

    // Setze alle existierenden User auf approved (inkl. Admins)
    await db.execute(sql`
      UPDATE users
      SET is_approved = true
      WHERE is_approved = false
    `);

    console.log("[MIGRATION] ✅ All existing users set to approved");
    console.log("[MIGRATION] Migration completed successfully!");
  } catch (error) {
    console.error("[MIGRATION] ❌ Error:", error);
    throw error;
  } finally {
    process.exit(0);
  }
}

addIsApprovedColumn();
