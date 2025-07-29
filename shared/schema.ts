import { pgTable, text, serial, integer, boolean, timestamp, decimal, json } from "drizzle-orm/pg-core";
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
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
