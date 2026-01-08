ALTER TABLE "listings" ADD COLUMN "source" text DEFAULT 'willhaben' NOT NULL;
CREATE INDEX "idx_listings_source" ON "listings" ("source");
