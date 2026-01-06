-- Add is_deleted and deletion_reason columns to listings table
ALTER TABLE "listings" ADD COLUMN IF NOT EXISTS "is_deleted" boolean DEFAULT false NOT NULL;
ALTER TABLE "listings" ADD COLUMN IF NOT EXISTS "deletion_reason" text;
