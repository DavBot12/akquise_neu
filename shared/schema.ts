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
  akquise_erledigt: boolean("akquise_erledigt").default(false).notNull(),
  is_deleted: boolean("is_deleted").default(false).notNull(),
  deletion_reason: text("deletion_reason"),
  deleted_by_user_id: integer("deleted_by_user_id"),
  price_evaluation: text("price_evaluation").$type<"unter_schnitt" | "im_schnitt" | "ueber_schnitt">(),
  category: text("category").notNull(), // eigentumswohnung or grundstueck or haus
  region: text("region").notNull(), // wien or niederoesterreich
  source: text("source").notNull().default("willhaben"), // willhaben or derstandard
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
  next_page: integer("next_page").notNull(),
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
