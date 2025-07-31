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
  akquise_erledigt: boolean("akquise_erledigt").default(false).notNull(),
  price_evaluation: text("price_evaluation").$type<"unter_schnitt" | "im_schnitt" | "ueber_schnitt">(),
  category: text("category").notNull(), // eigentumswohnung or grundstueck
  region: text("region").notNull(), // wien or niederoesterreich
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
});

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
