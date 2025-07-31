import { 
  listings, 
  contacts, 
  listing_contacts,
  users,
  acquisitions,
  user_sessions,
  type Listing, 
  type Contact, 
  type ListingContact,
  type User,
  type Acquisition,
  type UserSession,
  type InsertListing, 
  type InsertContact, 
  type InsertListingContact,
  type InsertUser,
  type InsertAcquisition,
  type InsertUserSession
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
  updateAcquisitionStatus(id: number, status: "erfolg" | "absage" | "in_bearbeitung" | "nicht_erfolgreich", notes?: string): Promise<void>;
  getAcquisitionsByUser(userId: number): Promise<Acquisition[]>;
  getAcquisitionStats(userId?: number): Promise<{
    total: number;
    erfolg: number;
    absage: number;
    nicht_erfolgreich: number;
    in_bearbeitung: number;
    erfolgsrate: number;
  }>;
  getAllUsersWithStats(): Promise<Array<{
    id: number;
    username: string;
    total: number;
    erfolg: number;
    nicht_erfolgreich: number;
    erfolgsrate: number;
  }>>;
  
  // User statistics for sidebar
  getPersonalStats(userId: number): Promise<any>;
  getAllUserStats(): Promise<any[]>;
  
  // Real login tracking
  createUserSession(userId: number, ipAddress?: string, userAgent?: string): Promise<UserSession>;
  endUserSession(sessionId: number): Promise<void>;
  updateLoginStats(userId: number): Promise<void>;
  
  // Price mirror data
  savePriceMirrorData(data: any): Promise<void>;
  getPriceMirrorData(): Promise<any[]>;
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

  async updateAcquisitionStatus(id: number, status: "erfolg" | "absage" | "in_bearbeitung" | "nicht_erfolgreich", notes?: string): Promise<void> {
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
    nicht_erfolgreich: number;
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
      nicht_erfolgreich: 0,
      in_bearbeitung: 0,
      erfolgsrate: 0
    };

    results.forEach(result => {
      stats.total += result.count;
      if (result.status in stats) {
        (stats as any)[result.status] = result.count;
      }
    });

    stats.erfolgsrate = stats.total > 0 ? (stats.erfolg / stats.total) * 100 : 0;
    
    return stats;
  }

  async getAllUsersWithStats(): Promise<Array<{
    id: number;
    username: string;
    total: number;
    erfolg: number;
    nicht_erfolgreich: number;
    erfolgsrate: number;
  }>> {
    const allUsers = await db.select().from(users).where(eq(users.is_admin, false));
    const result = [];

    for (const user of allUsers) {
      const stats = await this.getAcquisitionStats(user.id);
      result.push({
        id: user.id,
        username: user.username,
        total: stats.total,
        erfolg: stats.erfolg,
        nicht_erfolgreich: stats.nicht_erfolgreich,
        erfolgsrate: stats.erfolgsrate
      });
    }

    return result;
  }

  // Personal statistics with real data
  async getPersonalStats(userId: number): Promise<any> {
    // Get user's acquisition stats
    const acquisitionStats = await this.getAcquisitionStats(userId);
    
    // Get user basic info
    const user = await this.getUser(userId);
    if (!user) return null;

    // Get real session data from database
    const sessions = await db
      .select()
      .from(user_sessions)
      .where(eq(user_sessions.user_id, userId))
      .orderBy(desc(user_sessions.login_time));

    const totalLogins = user.total_logins || 0;
    const lastLogin = user.last_login?.toISOString() || null;
    
    // Calculate average session duration from real data
    const completedSessions = sessions.filter(s => s.session_duration);
    const avgSessionDuration = completedSessions.length > 0 
      ? Math.round(completedSessions.reduce((sum, s) => sum + (s.session_duration || 0), 0) / completedSessions.length)
      : 0;

    // Calculate streak days from last 30 days
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const recentSessions = sessions.filter(s => 
      new Date(s.login_time) > thirtyDaysAgo
    );

    // Group sessions by date for streak calculation
    const loginDates = [...new Set(recentSessions.map(s => 
      new Date(s.login_time).toDateString()
    ))].sort((a, b) => new Date(b).getTime() - new Date(a).getTime());

    let streakDays = 0;
    let currentDate = new Date();
    for (const dateStr of loginDates) {
      const loginDate = new Date(dateStr);
      const diffDays = Math.floor((currentDate.getTime() - loginDate.getTime()) / (1000 * 60 * 60 * 24));
      
      if (diffDays <= streakDays + 1) {
        streakDays++;
        currentDate = loginDate;
      } else {
        break;
      }
    }

    // Generate monthly login data (real data from sessions)
    const monthlyLogins = [];
    for (let i = 11; i >= 0; i--) {
      const monthStart = new Date();
      monthStart.setMonth(monthStart.getMonth() - i);
      monthStart.setDate(1);
      const monthEnd = new Date(monthStart);
      monthEnd.setMonth(monthEnd.getMonth() + 1);
      
      const monthSessions = sessions.filter(s => {
        const sessionDate = new Date(s.login_time);
        return sessionDate >= monthStart && sessionDate < monthEnd;
      });
      
      monthlyLogins.push(monthSessions.length);
    }
    
    // Generate daily activity for last 30 days (real data)
    const dailyActivity = [];
    for (let i = 29; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      
      const dayStart = new Date(date);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(date);
      dayEnd.setHours(23, 59, 59, 999);
      
      const daySessions = sessions.filter(s => {
        const sessionDate = new Date(s.login_time);
        return sessionDate >= dayStart && sessionDate <= dayEnd;
      });
      
      const dayAcquisitions = await db
        .select()
        .from(acquisitions)
        .where(and(
          eq(acquisitions.user_id, userId),
          sql`DATE(${acquisitions.contacted_at}) = ${dateStr}`
        ));
      
      dailyActivity.push({
        date: dateStr,
        logins: daySessions.length,
        acquisitions: dayAcquisitions.length
      });
    }

    return {
      totalLogins,
      lastLogin,
      totalAcquisitions: acquisitionStats.total,
      successfulAcquisitions: acquisitionStats.erfolg,
      successRate: Math.round(acquisitionStats.erfolgsrate),
      avgSessionDuration,
      streakDays,
      monthlyLogins,
      dailyActivity
    };
  }

  // All user statistics with real data
  async getAllUserStats(): Promise<any[]> {
    const allUsers = await db.select().from(users);
    const userStats = [];

    for (const user of allUsers) {
      const acquisitionStats = await this.getAcquisitionStats(user.id);
      
      // Get real session data
      const sessions = await db
        .select()
        .from(user_sessions)
        .where(eq(user_sessions.user_id, user.id))
        .orderBy(desc(user_sessions.login_time))
        .limit(30);

      // Calculate if user is online (active session in last 30 minutes)
      const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
      const isOnline = sessions.some(s => 
        !s.logout_time && new Date(s.login_time) > thirtyMinutesAgo
      );

      // Get login history (last 15 sessions)
      const loginHistory = sessions.slice(0, 15).map(s => ({
        date: s.login_time.toISOString(),
        duration: s.session_duration || 0
      }));

      // Get recent acquisitions for recent actions
      const recentAcquisitions = await db
        .select()
        .from(acquisitions)
        .where(eq(acquisitions.user_id, user.id))
        .orderBy(desc(acquisitions.contacted_at))
        .limit(5);

      const recentActions = [
        ...recentAcquisitions.map(acq => ({
          action: "Akquise erstellt",
          timestamp: acq.contacted_at.toISOString(),
          details: `Listing #${acq.listing_id} kontaktiert`
        })),
        ...sessions.slice(0, 3).map(session => ({
          action: "Login",
          timestamp: session.login_time.toISOString(),
          details: `Session gestartet`
        }))
      ].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()).slice(0, 5);

      // Calculate average session duration
      const completedSessions = sessions.filter(s => s.session_duration);
      const avgSessionDuration = completedSessions.length > 0 
        ? Math.round(completedSessions.reduce((sum, s) => sum + (s.session_duration || 0), 0) / completedSessions.length)
        : 0;

      // Monthly logins (real data)
      const monthlyLogins = [];
      for (let i = 11; i >= 0; i--) {
        const monthStart = new Date();
        monthStart.setMonth(monthStart.getMonth() - i);
        monthStart.setDate(1);
        const monthEnd = new Date(monthStart);
        monthEnd.setMonth(monthEnd.getMonth() + 1);
        
        const monthSessions = sessions.filter(s => {
          const sessionDate = new Date(s.login_time);
          return sessionDate >= monthStart && sessionDate < monthEnd;
        });
        
        monthlyLogins.push(monthSessions.length);
      }
      
      userStats.push({
        userId: user.id,
        username: user.username,
        totalLogins: user.total_logins || 0,
        lastLogin: user.last_login?.toISOString() || new Date().toISOString(),
        totalAcquisitions: acquisitionStats.total,
        successfulAcquisitions: acquisitionStats.erfolg,
        successRate: Math.round(acquisitionStats.erfolgsrate),
        avgSessionDuration,
        isOnline,
        monthlyLogins,
        loginHistory,
        recentActions
      });
    }

    return userStats;
  }

  // Create user session
  async createUserSession(userId: number, ipAddress?: string, userAgent?: string): Promise<UserSession> {
    const [session] = await db
      .insert(user_sessions)
      .values({
        user_id: userId,
        ip_address: ipAddress,
        user_agent: userAgent
      })
      .returning();
    
    return session;
  }

  // End user session
  async endUserSession(sessionId: number): Promise<void> {
    const session = await db
      .select()
      .from(user_sessions)
      .where(eq(user_sessions.id, sessionId))
      .limit(1);

    if (session.length > 0) {
      const loginTime = new Date(session[0].login_time);
      const logoutTime = new Date();
      const duration = Math.round((logoutTime.getTime() - loginTime.getTime()) / (1000 * 60)); // minutes

      await db
        .update(user_sessions)
        .set({
          logout_time: logoutTime,
          session_duration: duration
        })
        .where(eq(user_sessions.id, sessionId));
    }
  }

  // Update user login statistics
  async updateLoginStats(userId: number): Promise<void> {
    await db
      .update(users)
      .set({
        last_login: new Date(),
        total_logins: sql`${users.total_logins} + 1`
      })
      .where(eq(users.id, userId));
  }

  // Save price mirror data
  async savePriceMirrorData(data: any): Promise<void> {
    try {
      await db
        .insert(price_mirror_data)
        .values(data)
        .onConflictDoUpdate({
          target: [price_mirror_data.category, price_mirror_data.region],
          set: {
            average_price: data.average_price,
            average_area: data.average_area,
            price_per_sqm: data.price_per_sqm,
            sample_size: data.sample_size,
            scraped_at: data.scraped_at
          }
        });
    } catch (error) {
      console.error("Fehler beim Speichern der Preisspiegel-Daten:", error);
    }
  }

  // Get price mirror data
  async getPriceMirrorData(): Promise<any[]> {
    try {
      const data = await db
        .select()
        .from(price_mirror_data)
        .orderBy(desc(price_mirror_data.scraped_at));
      return data;
    } catch (error) {
      console.error("Fehler beim Abrufen der Preisspiegel-Daten:", error);
      return [];
    }
  }
}

export const storage = new DatabaseStorage();
