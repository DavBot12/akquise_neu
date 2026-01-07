-- Price Mirror Listings Table for Vienna Market Data
CREATE TABLE "price_mirror_listings" (
  "id" SERIAL PRIMARY KEY,
  "category" TEXT NOT NULL,
  "bezirk_code" TEXT NOT NULL,
  "bezirk_name" TEXT NOT NULL,
  "building_type" TEXT,
  "price" DECIMAL(12,2) NOT NULL,
  "area_m2" DECIMAL(10,2),
  "eur_per_m2" DECIMAL(10,2),
  "url" TEXT NOT NULL UNIQUE,
  "scraped_at" TIMESTAMP DEFAULT NOW() NOT NULL,
  "first_seen_at" TIMESTAMP DEFAULT NOW() NOT NULL,
  "last_changed_at" TIMESTAMP,
  "is_active" BOOLEAN DEFAULT TRUE NOT NULL
);

-- Indexes for fast filtering and aggregation
CREATE INDEX "idx_price_mirror_category" ON "price_mirror_listings"("category");
CREATE INDEX "idx_price_mirror_bezirk_code" ON "price_mirror_listings"("bezirk_code");
CREATE INDEX "idx_price_mirror_building_type" ON "price_mirror_listings"("building_type");
CREATE INDEX "idx_price_mirror_category_bezirk" ON "price_mirror_listings"("category", "bezirk_code");
CREATE INDEX "idx_price_mirror_eur_per_m2" ON "price_mirror_listings"("eur_per_m2");
CREATE INDEX "idx_price_mirror_is_active" ON "price_mirror_listings"("is_active");
