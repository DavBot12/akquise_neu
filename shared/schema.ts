import { pgTable, text, serial, integer, boolean, timestamp, decimal, json, uniqueIndex } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const listings = pgTable("listings", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  price: integer("price").notNull(),
  location: text("location").notNull(),
  area: decimal("area", { precision: 10, scale: 2 }),
  eur_per_m2: decimal("eur_per_m2", { precision: 10, scale: 2 }),
  description: text("description"),
  phone_number: text("phone_number"),
  images: json("images").$type<string[]>().default([]),
  url: text("url").notNull().unique(),
  scraped_at: timestamp("scraped_at").defaultNow().notNull(),
  first_seen_at: timestamp("first_seen_at").defaultNow().notNull(), // Wann das System das Inserat erstmals sah
  last_changed_at: timestamp("last_changed_at"), // "Zuletzt geändert" Datum von Willhaben
  published_at: timestamp("published_at"), // "Veröffentlicht am" Datum (nur Willhaben)
  akquise_erledigt: boolean("akquise_erledigt").default(false).notNull(),
  is_deleted: boolean("is_deleted").default(false).notNull(),
  deletion_reason: text("deletion_reason"),
  deleted_by_user_id: integer("deleted_by_user_id"),
  price_evaluation: text("price_evaluation").$type<"unter_schnitt" | "im_schnitt" | "ueber_schnitt">(),
  category: text("category").notNull(), // eigentumswohnung or grundstueck or haus
  region: text("region").notNull(), // wien or niederoesterreich
  source: text("source").notNull().default("willhaben"), // willhaben, derstandard, or immoscout
  // Quality scoring (0-150+, can exceed 100 for gold finds)
  quality_score: integer("quality_score").default(0),
  quality_tier: text("quality_tier").$type<"excellent" | "good" | "medium" | "low">(),
  is_gold_find: boolean("is_gold_find").default(false),
  // Price drop tracking (for quick UI display without JOIN)
  last_price_drop: integer("last_price_drop"), // Amount of last price drop (negative number)
  last_price_drop_percentage: decimal("last_price_drop_percentage", { precision: 5, scale: 2 }), // % of last drop
  last_price_drop_date: timestamp("last_price_drop_date"), // When was the last price drop
  total_price_drops: integer("total_price_drops").default(0), // Count of price drops
  // Duplicate detection: Listings with same duplicate_group_id are duplicates on different portals
  duplicate_group_id: integer("duplicate_group_id"), // Shared ID for duplicate group
  is_primary_listing: boolean("is_primary_listing").default(true), // Is this the primary listing in the group?
  duplicate_sources: json("duplicate_sources").$type<string[]>(), // All sources for this property: ["willhaben", "derstandard"]
});

export const contacts = pgTable("contacts", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  company: text("company"),
  phone: text("phone"),
  email: text("email"),
  notes: text("notes"),
  created_at: timestamp("created_at").defaultNow().notNull(),
});

export const listing_contacts = pgTable("listing_contacts", {
  id: serial("id").primaryKey(),
  listing_id: integer("listing_id").notNull().references(() => listings.id, { onDelete: "cascade" }),
  contact_id: integer("contact_id").notNull().references(() => contacts.id, { onDelete: "cascade" }),
  assigned_at: timestamp("assigned_at").defaultNow().notNull(),
});

export const listingsRelations = relations(listings, ({ many }) => ({
  listing_contacts: many(listing_contacts),
}));

export const contactsRelations = relations(contacts, ({ many }) => ({
  listing_contacts: many(listing_contacts),
}));

export const listingContactsRelations = relations(listing_contacts, ({ one }) => ({
  listing: one(listings, {
    fields: [listing_contacts.listing_id],
    references: [listings.id],
  }),
  contact: one(contacts, {
    fields: [listing_contacts.contact_id],
    references: [contacts.id],
  }),
}));

export const insertListingSchema = createInsertSchema(listings).omit({
  id: true,
  scraped_at: true,
});

export const insertContactSchema = createInsertSchema(contacts).omit({
  id: true,
  created_at: true,
});

export const insertListingContactSchema = createInsertSchema(listing_contacts).omit({
  id: true,
  assigned_at: true,
});

export type InsertListing = z.infer<typeof insertListingSchema>;
export type Listing = typeof listings.$inferSelect;
export type InsertContact = z.infer<typeof insertContactSchema>;
export type Contact = typeof contacts.$inferSelect;
export type InsertListingContact = z.infer<typeof insertListingContactSchema>;
export type ListingContact = typeof listing_contacts.$inferSelect;

// Users table (keeping existing structure)
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  is_admin: boolean("is_admin").default(false).notNull(),
  is_approved: boolean("is_approved").default(false).notNull(), // Freigabe durch Admin erforderlich
  last_login: timestamp("last_login"),
  total_logins: integer("total_logins").default(0),
  total_session_time: integer("total_session_time").default(0), // in minutes
  created_at: timestamp("created_at").defaultNow(),
});

// User sessions tracking table for real statistics
export const user_sessions = pgTable("user_sessions", {
  id: serial("id").primaryKey(),
  user_id: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  login_time: timestamp("login_time").defaultNow().notNull(),
  logout_time: timestamp("logout_time"),
  session_duration: integer("session_duration"), // in minutes
  ip_address: text("ip_address"),
  user_agent: text("user_agent"),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

// Acquisition tracking table for success/failure statistics
export const acquisitions = pgTable("acquisitions", {
  id: serial("id").primaryKey(),
  user_id: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  listing_id: integer("listing_id").notNull().references(() => listings.id, { onDelete: "cascade" }),
  status: text("status").$type<"erfolg" | "absage" | "in_bearbeitung" | "nicht_erfolgreich">().notNull(),
  notes: text("notes"),
  contacted_at: timestamp("contacted_at").defaultNow().notNull(),
  result_date: timestamp("result_date"),
}, (table) => ({
  // Unique constraint: each user can only have one acquisition record per listing
  uniqueUserListing: uniqueIndex("idx_acquisitions_user_listing").on(table.user_id, table.listing_id),
}));

export const acquisitionsRelations = relations(acquisitions, ({ one }) => ({
  user: one(users, {
    fields: [acquisitions.user_id],
    references: [users.id],
  }),
  listing: one(listings, {
    fields: [acquisitions.listing_id],
    references: [listings.id],
  }),
}));

export const usersRelations = relations(users, ({ many }) => ({
  acquisitions: many(acquisitions),
  sessions: many(user_sessions),
}));

export const userSessionsRelations = relations(user_sessions, ({ one }) => ({
  user: one(users, {
    fields: [user_sessions.user_id],
    references: [users.id],
  }),
}));

export const insertAcquisitionSchema = createInsertSchema(acquisitions).omit({
  id: true,
  contacted_at: true,
});

export type InsertAcquisition = z.infer<typeof insertAcquisitionSchema>;
export type Acquisition = typeof acquisitions.$inferSelect;

export const insertUserSessionSchema = createInsertSchema(user_sessions).omit({
  id: true,
  login_time: true,
});

export type InsertUserSession = z.infer<typeof insertUserSessionSchema>;
export type UserSession = typeof user_sessions.$inferSelect;

// Price mirror data table for daily market analysis
export const price_mirror_data = pgTable("price_mirror_data", {
  id: serial("id").primaryKey(),
  category: text("category").notNull(), // eigentumswohnung, haus, grundstuecke
  region: text("region").notNull(), // wien, niederoesterreich, etc.
  average_price: integer("average_price"),
  average_area: integer("average_area"), // in m²
  price_per_sqm: integer("price_per_sqm"), // Euro per m²
  sample_size: integer("sample_size"), // number of listings analyzed
  scraped_at: timestamp("scraped_at").defaultNow().notNull(),
}, (table) => ({
  categoryRegionUnique: uniqueIndex('price_mirror_category_region_unique').on(table.category, table.region)
}));

export const insertPriceMirrorSchema = createInsertSchema(price_mirror_data).omit({
  id: true,
  scraped_at: true,
});

export type InsertPriceMirrorData = z.infer<typeof insertPriceMirrorSchema>;
export type PriceMirrorData = typeof price_mirror_data.$inferSelect;

// Discovered links for Scraper V2 (immediate persistence of found URLs)
export const discovered_links = pgTable("discovered_links", {
  id: serial("id").primaryKey(),
  url: text("url").notNull().unique(),
  category: text("category"),
  region: text("region"),
  phone_number: text("phone_number"),
  discovered_at: timestamp("discovered_at").defaultNow().notNull(),
});

export const insertDiscoveredLinkSchema = createInsertSchema(discovered_links).omit({
  id: true,
  discovered_at: true,
});

export type InsertDiscoveredLink = z.infer<typeof insertDiscoveredLinkSchema>;
export type DiscoveredLink = typeof discovered_links.$inferSelect;

export const scraper_state = pgTable("scraper_state", {
  id: serial("id").primaryKey(),
  state_key: text("state_key").notNull().unique(),
  next_page: text("next_page").notNull(), // Changed from integer to text to support ImmoScout hex IDs
  state_value: text("state_value"), // For storing text values like listing IDs
  updated_at: timestamp("updated_at").defaultNow().notNull(),
});

export const insertScraperStateSchema = createInsertSchema(scraper_state).omit({
  id: true,
  updated_at: true,
});

export type InsertScraperState = z.infer<typeof insertScraperStateSchema>;
export type ScraperState = typeof scraper_state.$inferSelect;

// Price mirror listings for detailed market data (Vienna only, all listings)
export const price_mirror_listings = pgTable("price_mirror_listings", {
  id: serial("id").primaryKey(),
  category: text("category").notNull(), // 'eigentumswohnung' | 'haus'
  bezirk_code: text("bezirk_code").notNull(), // "1010", "1020", etc.
  bezirk_name: text("bezirk_name").notNull(), // "Innere Stadt", "Leopoldstadt"
  building_type: text("building_type"), // 'neubau' | 'altbau' | null (nur für Wohnungen)
  price: decimal("price", { precision: 12, scale: 2 }).notNull(),
  area_m2: decimal("area_m2", { precision: 10, scale: 2 }),
  eur_per_m2: decimal("eur_per_m2", { precision: 10, scale: 2 }),
  url: text("url").notNull().unique(),
  scraped_at: timestamp("scraped_at").defaultNow().notNull(),
  first_seen_at: timestamp("first_seen_at").defaultNow().notNull(),
  last_changed_at: timestamp("last_changed_at"),
  is_active: boolean("is_active").default(true).notNull(),
});

export const insertPriceMirrorListingSchema = createInsertSchema(price_mirror_listings).omit({
  id: true,
  scraped_at: true,
  first_seen_at: true,
});

export type InsertPriceMirrorListing = z.infer<typeof insertPriceMirrorListingSchema>;
export type PriceMirrorListing = typeof price_mirror_listings.$inferSelect;

// Machine Learning - Quality Score Feedback (stores user corrections for training)
export const quality_feedback = pgTable("quality_feedback", {
  id: serial("id").primaryKey(),
  listing_id: integer("listing_id").notNull().references(() => listings.id, { onDelete: "cascade" }),
  user_id: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  system_score: integer("system_score").notNull(), // What the system predicted (0-150)
  user_score: integer("user_score").notNull(), // What the user said it should be (0-150)
  score_delta: integer("score_delta").notNull(), // Difference (positive = user rated higher)
  features: json("features").$type<Record<string, any>>().notNull(), // Snapshot of all features for ML training
  created_at: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  // Each user can only provide one feedback per listing
  uniqueUserListing: uniqueIndex("idx_quality_feedback_user_listing").on(table.user_id, table.listing_id),
}));

export const qualityFeedbackRelations = relations(quality_feedback, ({ one }) => ({
  user: one(users, {
    fields: [quality_feedback.user_id],
    references: [users.id],
  }),
  listing: one(listings, {
    fields: [quality_feedback.listing_id],
    references: [listings.id],
  }),
}));

// Machine Learning - Model Weights (stores trained models)
export const ml_model_weights = pgTable("ml_model_weights", {
  id: serial("id").primaryKey(),
  model_version: text("model_version").notNull().unique(), // e.g., "v1.0", "v2.0"
  algorithm: text("algorithm").notNull(), // "weighted_avg", "linear_regression", "gradient_boosting"
  weights: json("weights").$type<Record<string, any>>().notNull(), // Learned weights as JSON
  training_samples: integer("training_samples").notNull(), // Number of samples used for training
  mae: decimal("mae", { precision: 5, scale: 2 }), // Mean Absolute Error
  rmse: decimal("rmse", { precision: 5, scale: 2 }), // Root Mean Squared Error
  r_squared: decimal("r_squared", { precision: 5, scale: 4 }), // R² coefficient
  trained_at: timestamp("trained_at").defaultNow().notNull(),
  is_active: boolean("is_active").default(false), // Only one model should be active at a time
  config: json("config").$type<Record<string, any>>(), // Additional config (regularization params, etc.)
});

export const insertQualityFeedbackSchema = createInsertSchema(quality_feedback).omit({
  id: true,
  created_at: true,
});

export const insertMlModelWeightsSchema = createInsertSchema(ml_model_weights).omit({
  id: true,
  trained_at: true,
});

export type InsertQualityFeedback = z.infer<typeof insertQualityFeedbackSchema>;
export type QualityFeedback = typeof quality_feedback.$inferSelect;
export type InsertMlModelWeights = z.infer<typeof insertMlModelWeightsSchema>;
export type MlModelWeights = typeof ml_model_weights.$inferSelect;

// Price History - Track price changes over time (detects motivated sellers!)
export const price_history = pgTable("price_history", {
  id: serial("id").primaryKey(),
  listing_id: integer("listing_id").notNull().references(() => listings.id, { onDelete: "cascade" }),
  old_price: integer("old_price").notNull(),
  new_price: integer("new_price").notNull(),
  price_change: integer("price_change").notNull(), // negative = price drop, positive = price increase
  change_percentage: decimal("change_percentage", { precision: 5, scale: 2 }).notNull(), // % change
  detected_at: timestamp("detected_at").defaultNow().notNull(),
  old_area: decimal("old_area", { precision: 10, scale: 2 }),
  new_area: decimal("new_area", { precision: 10, scale: 2 }),
  old_eur_per_m2: decimal("old_eur_per_m2", { precision: 10, scale: 2 }),
  new_eur_per_m2: decimal("new_eur_per_m2", { precision: 10, scale: 2 }),
});

export const priceHistoryRelations = relations(price_history, ({ one }) => ({
  listing: one(listings, {
    fields: [price_history.listing_id],
    references: [listings.id],
  }),
}));

export const insertPriceHistorySchema = createInsertSchema(price_history).omit({
  id: true,
  detected_at: true,
});

export type InsertPriceHistory = z.infer<typeof insertPriceHistorySchema>;
export type PriceHistory = typeof price_history.$inferSelect;

// Machine Learning - Outcome Feedback (learns from real acquisition results)
export const outcome_feedback = pgTable("outcome_feedback", {
  id: serial("id").primaryKey(),
  listing_id: integer("listing_id").notNull().references(() => listings.id, { onDelete: "cascade" }),
  user_id: integer("user_id").references(() => users.id, { onDelete: "set null" }), // User who performed action

  // Outcome type determines the ML signal
  outcome_type: text("outcome_type").$type<
    | "akquise_success"      // Successful acquisition - very positive signal (+50)
    | "akquise_completed"    // Just marked as done (neutral) - slight positive (+20)
    | "deleted_spam"         // Spam/Fake listing - very negative (-50)
    | "deleted_not_relevant" // Not interesting - negative (-30)
    | "deleted_sold"         // Already sold - neutral (0, no signal)
    | "deleted_other"        // Other reason - slight negative (-10)
  >().notNull(),

  // Score adjustment for ML training
  score_adjustment: integer("score_adjustment").notNull(), // +50, +20, 0, -10, -30, -50

  // ML Features snapshot (same structure as quality_feedback)
  features: json("features").$type<Record<string, any>>().notNull(),

  // Original quality score at time of outcome
  original_score: integer("original_score").notNull(),

  // Additional context
  notes: text("notes"), // Optional reason/notes

  created_at: timestamp("created_at").defaultNow().notNull(),
});

export const outcomeFeedbackRelations = relations(outcome_feedback, ({ one }) => ({
  user: one(users, {
    fields: [outcome_feedback.user_id],
    references: [users.id],
  }),
  listing: one(listings, {
    fields: [outcome_feedback.listing_id],
    references: [listings.id],
  }),
}));

export const insertOutcomeFeedbackSchema = createInsertSchema(outcome_feedback).omit({
  id: true,
  created_at: true,
});

export type InsertOutcomeFeedback = z.infer<typeof insertOutcomeFeedbackSchema>;
export type OutcomeFeedback = typeof outcome_feedback.$inferSelect;

// Scraper Statistics - Track scraper performance per platform
export const scraper_stats = pgTable("scraper_stats", {
  id: serial("id").primaryKey(),
  scraper_name: text("scraper_name").notNull(), // 'newest', 'multi-newest', 'v3', '24-7'
  platform: text("platform").notNull(), // 'willhaben', 'derstandard', 'immoscout'
  category: text("category").notNull(), // 'eigentumswohnung-wien', etc.
  listings_found: integer("listings_found").default(0).notNull(),
  listings_new: integer("listings_new").default(0).notNull(),
  listings_updated: integer("listings_updated").default(0).notNull(),
  listings_skipped: integer("listings_skipped").default(0).notNull(),
  pages_scraped: integer("pages_scraped").default(0).notNull(),
  errors_count: integer("errors_count").default(0).notNull(),
  duration_seconds: integer("duration_seconds"),
  average_quality_score: integer("average_quality_score"),
  scraped_at: timestamp("scraped_at").defaultNow().notNull(),
  scrape_type: text("scrape_type").notNull(), // 'quick-check', 'full-scrape', 'manual'
});

export const insertScraperStatsSchema = createInsertSchema(scraper_stats).omit({
  id: true,
  scraped_at: true,
});

export type InsertScraperStats = z.infer<typeof insertScraperStatsSchema>;
export type ScraperStats = typeof scraper_stats.$inferSelect;

// Geo-Blocked Listings - Listings die vom Geo-Filter blockiert wurden (außerhalb Akquise-Gebiet)
// Daten werden nicht gelöscht sondern hier archiviert!
export const geo_blocked_listings = pgTable("geo_blocked_listings", {
  id: serial("id").primaryKey(),

  // Alle Original-Listing-Daten (Kopie, kein FK damit Daten erhalten bleiben)
  title: text("title").notNull(),
  price: integer("price").notNull(),
  location: text("location").notNull(),
  area: decimal("area", { precision: 10, scale: 2 }),
  eur_per_m2: decimal("eur_per_m2", { precision: 10, scale: 2 }),
  description: text("description"),
  phone_number: text("phone_number"),
  images: json("images").$type<string[]>().default([]),
  url: text("url").notNull(),
  category: text("category").notNull(), // eigentumswohnung, haus, grundstueck
  region: text("region").notNull(), // wien, niederoesterreich
  source: text("source").notNull(), // willhaben, derstandard, immoscout

  // Original Timestamps vom Scraper
  original_scraped_at: timestamp("original_scraped_at"),
  original_published_at: timestamp("original_published_at"),
  original_last_changed_at: timestamp("original_last_changed_at"),

  // Geo-Filter Metadaten
  block_reason: text("block_reason").notNull(), // Warum blockiert? z.B. "PLZ blacklisted", "NÖ Standard"
  blocked_at: timestamp("blocked_at").defaultNow().notNull(), // Wann wurde es blockiert?

  // Index für spätere Analyse
  plz: text("plz"), // Extrahierte PLZ für Statistiken
  ort: text("ort"), // Extrahierter Ortsname
});

export const insertGeoBlockedListingSchema = createInsertSchema(geo_blocked_listings).omit({
  id: true,
  blocked_at: true,
});

export type InsertGeoBlockedListing = z.infer<typeof insertGeoBlockedListingSchema>;
export type GeoBlockedListing = typeof geo_blocked_listings.$inferSelect;
