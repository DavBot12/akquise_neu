import { 
  listings, 
  contacts, 
  listing_contacts,
  users,
  acquisitions,
  type Listing, 
  type Contact, 
  type ListingContact,
  type User,
  type Acquisition,
  type InsertListing, 
  type InsertContact, 
  type InsertListingContact,
  type InsertUser,
  type InsertAcquisition
} from "@shared/schema";
import { db } from "./db";
import { eq, desc, and, sql } from "drizzle-orm";

export interface IStorage {
  // User methods (existing)
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;

  // Listing methods
  getListings(filters?: { 
    akquise_erledigt?: boolean; 
    region?: string; 
    price_evaluation?: string;
  }): Promise<Listing[]>;
  getListingById(id: number): Promise<Listing | undefined>;
  createListing(listing: InsertListing): Promise<Listing>;
  updateListingAkquiseStatus(id: number, akquise_erledigt: boolean): Promise<void>;
  getListingStats(): Promise<{
    activeListings: number;
    completedListings: number;
    lastScrape: string | null;
  }>;
  getRegionalAverages(): Promise<{ [key: string]: number }>;
  getPriceStatistics(filters?: { region?: string; category?: string }): Promise<any[]>;

  // Contact methods
  getContacts(): Promise<Contact[]>;
  getContactById(id: number): Promise<Contact | undefined>;
  createContact(contact: InsertContact): Promise<Contact>;
  updateContact(id: number, contact: Partial<InsertContact>): Promise<Contact>;
  deleteContact(id: number): Promise<void>;

  // Listing-Contact assignment methods
  assignContactToListing(listingId: number, contactId: number): Promise<ListingContact>;
  getContactsForListing(listingId: number): Promise<Contact[]>;
  getListingsForContact(contactId: number): Promise<Listing[]>;
  unassignContactFromListing(listingId: number, contactId: number): Promise<void>;

  // Acquisition tracking methods
  createAcquisition(acquisition: InsertAcquisition): Promise<Acquisition>;
  updateAcquisitionStatus(id: number, status: "erfolg" | "absage" | "in_bearbeitung", notes?: string): Promise<void>;
  getAcquisitionsByUser(userId: number): Promise<Acquisition[]>;
  getAcquisitionStats(userId?: number): Promise<{
    total: number;
    erfolg: number;
    absage: number;
    in_bearbeitung: number;
    erfolgsrate: number;
  }>;
}

export class DatabaseStorage implements IStorage {
  // User methods
  async getUser(id: number): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user || undefined;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user || undefined;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db
      .insert(users)
      .values(insertUser)
      .returning();
    return user;
  }

  // Listing methods
  async getListings(filters?: { 
    akquise_erledigt?: boolean; 
    region?: string; 
    price_evaluation?: string;
  }): Promise<Listing[]> {
    let query = db.select().from(listings);
    
    if (filters) {
      const conditions = [];
      if (filters.akquise_erledigt !== undefined) {
        conditions.push(eq(listings.akquise_erledigt, filters.akquise_erledigt));
      }
      if (filters.region) {
        conditions.push(eq(listings.region, filters.region));
      }
      if (filters.price_evaluation) {
        conditions.push(eq(listings.price_evaluation, filters.price_evaluation as any));
      }
      
      if (conditions.length > 0) {
        query = query.where(and(...conditions)) as any;
      }
    }
    
    return await query.orderBy(desc(listings.scraped_at));
  }

  async getListingById(id: number): Promise<Listing | undefined> {
    const [listing] = await db.select().from(listings).where(eq(listings.id, id));
    return listing || undefined;
  }

  async createListing(listing: InsertListing): Promise<Listing> {
    const [newListing] = await db
      .insert(listings)
      .values(listing as any)
      .returning();
    return newListing;
  }

  async updateListingAkquiseStatus(id: number, akquise_erledigt: boolean): Promise<void> {
    await db
      .update(listings)
      .set({ akquise_erledigt })
      .where(eq(listings.id, id));
  }

  async getListingStats(): Promise<{
    activeListings: number;
    completedListings: number;
    lastScrape: string | null;
  }> {
    const [activeCount] = await db
      .select({ count: sql<number>`count(*)` })
      .from(listings)
      .where(eq(listings.akquise_erledigt, false));

    const [completedCount] = await db
      .select({ count: sql<number>`count(*)` })
      .from(listings)
      .where(eq(listings.akquise_erledigt, true));

    const [lastScrapeResult] = await db
      .select({ scraped_at: listings.scraped_at })
      .from(listings)
      .orderBy(desc(listings.scraped_at))
      .limit(1);

    return {
      activeListings: Number(activeCount.count),
      completedListings: Number(completedCount.count),
      lastScrape: lastScrapeResult?.scraped_at?.toISOString() || null,
    };
  }

  async getRegionalAverages(): Promise<{ [key: string]: number }> {
    const averages = await db
      .select({
        region: listings.region,
        avg_price: sql<number>`avg(${listings.eur_per_m2})`,
      })
      .from(listings)
      .where(eq(listings.akquise_erledigt, false))
      .groupBy(listings.region);

    return averages.reduce((acc, item) => {
      acc[item.region] = Number(item.avg_price);
      return acc;
    }, {} as { [key: string]: number });
  }

  async getPriceStatistics(filters?: { region?: string; category?: string }): Promise<any[]> {
    let query = db
      .select({
        region: listings.region,
        category: listings.category,
        avgPrice: sql<number>`avg(${listings.price})`,
        avgPricePerM2: sql<number>`avg(${listings.eur_per_m2})`,
        totalListings: sql<number>`count(*)`,
        privateListings: sql<number>`count(*)`, // All listings in our DB are private
        commercialListings: sql<number>`0`, // We only scrape private listings
        minPrice: sql<number>`min(${listings.price})`,
        maxPrice: sql<number>`max(${listings.price})`,
      })
      .from(listings);

    const conditions = [];
    if (filters?.region) {
      conditions.push(eq(listings.region, filters.region));
    }
    if (filters?.category) {
      conditions.push(eq(listings.category, filters.category));
    }

    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as any;
    }

    const result = await query.groupBy(listings.region, listings.category);

    return result.map(row => ({
      region: row.region,
      category: row.category,
      avgPrice: Number(row.avgPrice) || 0,
      avgPricePerM2: Number(row.avgPricePerM2) || 0,
      totalListings: Number(row.totalListings) || 0,
      privateListings: Number(row.privateListings) || 0,
      commercialListings: Number(row.commercialListings) || 0,
      priceRange: {
        min: Number(row.minPrice) || 0,
        max: Number(row.maxPrice) || 0,
      },
    }));
  }

  // Contact methods
  async getContacts(): Promise<Contact[]> {
    const result = await db.select().from(contacts).orderBy(contacts.name);
    return result;
  }

  async getContactById(id: number): Promise<Contact | undefined> {
    const [contact] = await db.select().from(contacts).where(eq(contacts.id, id));
    return contact || undefined;
  }

  async createContact(contact: InsertContact): Promise<Contact> {
    const [newContact] = await db
      .insert(contacts)
      .values(contact)
      .returning();
    return newContact;
  }

  async updateContact(id: number, contact: Partial<InsertContact>): Promise<Contact> {
    const [updatedContact] = await db
      .update(contacts)
      .set(contact)
      .where(eq(contacts.id, id))
      .returning();
    return updatedContact;
  }

  async deleteContact(id: number): Promise<void> {
    await db.delete(contacts).where(eq(contacts.id, id));
  }

  // Listing-Contact assignment methods
  async assignContactToListing(listingId: number, contactId: number): Promise<ListingContact> {
    const [assignment] = await db
      .insert(listing_contacts)
      .values({ listing_id: listingId, contact_id: contactId })
      .returning();
    return assignment;
  }

  async getContactsForListing(listingId: number): Promise<Contact[]> {
    const result = await db
      .select()
      .from(contacts)
      .innerJoin(listing_contacts, eq(contacts.id, listing_contacts.contact_id))
      .where(eq(listing_contacts.listing_id, listingId));
    
    return result.map(row => row.contacts);
  }

  async getListingsForContact(contactId: number): Promise<Listing[]> {
    const result = await db
      .select()
      .from(listings)
      .innerJoin(listing_contacts, eq(listings.id, listing_contacts.listing_id))
      .where(eq(listing_contacts.contact_id, contactId));
    
    return result.map(row => row.listings);
  }

  async unassignContactFromListing(listingId: number, contactId: number): Promise<void> {
    await db
      .delete(listing_contacts)
      .where(
        and(
          eq(listing_contacts.listing_id, listingId),
          eq(listing_contacts.contact_id, contactId)
        )
      );
  }

  // Acquisition tracking methods
  async createAcquisition(insertAcquisition: InsertAcquisition): Promise<Acquisition> {
    const [acquisition] = await db
      .insert(acquisitions)
      .values(insertAcquisition)
      .returning();
    return acquisition;
  }

  async updateAcquisitionStatus(id: number, status: "erfolg" | "absage" | "in_bearbeitung", notes?: string): Promise<void> {
    await db
      .update(acquisitions)
      .set({ 
        status, 
        notes,
        result_date: status !== "in_bearbeitung" ? new Date() : null
      })
      .where(eq(acquisitions.id, id));
  }

  async getAcquisitionsByUser(userId: number): Promise<Acquisition[]> {
    return await db
      .select()
      .from(acquisitions)
      .where(eq(acquisitions.user_id, userId))
      .orderBy(desc(acquisitions.contacted_at));
  }

  async getAcquisitionStats(userId?: number): Promise<{
    total: number;
    erfolg: number;
    absage: number;
    in_bearbeitung: number;
    erfolgsrate: number;
  }> {
    const whereClause = userId ? eq(acquisitions.user_id, userId) : undefined;
    
    const results = await db
      .select({
        status: acquisitions.status,
        count: sql<number>`count(*)`.as('count')
      })
      .from(acquisitions)
      .where(whereClause)
      .groupBy(acquisitions.status);

    const stats = {
      total: 0,
      erfolg: 0,
      absage: 0,
      in_bearbeitung: 0,
      erfolgsrate: 0
    };

    results.forEach(result => {
      stats.total += result.count;
      stats[result.status as keyof typeof stats] = result.count;
    });

    stats.erfolgsrate = stats.total > 0 ? (stats.erfolg / stats.total) * 100 : 0;
    
    return stats;
  }
}

export const storage = new DatabaseStorage();
