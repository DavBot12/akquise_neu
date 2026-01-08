-- Migration: Add unique constraint to prevent duplicate acquisitions
-- Issue: Each acquisition was being counted 10x due to duplicate entries

-- First, remove any existing duplicate records, keeping only the earliest one
WITH duplicates AS (
  SELECT id,
         ROW_NUMBER() OVER (PARTITION BY user_id, listing_id ORDER BY contacted_at ASC) as rn
  FROM acquisitions
)
DELETE FROM acquisitions
WHERE id IN (
  SELECT id FROM duplicates WHERE rn > 1
);

-- Now add the unique constraint to prevent future duplicates
CREATE UNIQUE INDEX idx_acquisitions_user_listing ON acquisitions (user_id, listing_id);
