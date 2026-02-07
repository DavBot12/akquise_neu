import type { Express } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import axios from "axios";
import bcrypt from "bcrypt";
import { Resend } from "resend";
import { storage } from "./storage";
import { insertListingSchema, insertContactSchema, insertListingContactSchema, listings, discovered_links, users, user_sessions } from "@shared/schema";
import { db } from "./db";
import { eq, desc, sql } from "drizzle-orm";

import { PriceEvaluator } from "./services/priceEvaluator";
import { ScraperV3Service } from "./services/scraper-v3";
import { MultiNewestScraperService } from "./services/scraper-newest-multi";
import { DerStandardScraperService } from "./services/scraper-derstandard";
import { ImmoScout24ScraperService } from "./services/scraper-immoscout-v2";
import { registerMLRoutes } from "./routes-ml";
import { trackPriceChange, detectPriceChange } from "./services/price-tracker";
import { extractFeatures } from "./services/ml-feature-extractor";
import { createOutcomeFeedback, getScoreAdjustment } from "./storage-ml";
import { isInAkquiseGebiet } from "./services/geo-filter";
import { detectChangeType } from "./services/scraper-utils";
import { emailService } from "./services/email-service";
import { newsletterScheduler } from "./services/newsletter-scheduler";

/**
 * Check and send email alerts for listings
 * - Gold Find: Old listing (>30 days) with fresh update (<3 days)
 * - Price Drop: >10% price reduction
 * - Top Listing: Quality score >= 90
 */
async function checkAndSendAlerts(
  listing: any,
  alertType: 'new' | 'update',
  oldPrice?: number
): Promise<void> {
  try {
    // Skip if email service is not configured
    if (!emailService.isConfigured()) {
      return;
    }

    // Check for Gold Find (new listings only - old listing with fresh update)
    if (alertType === 'new' && listing.is_gold_find) {
      console.log('[EMAIL-ALERT] 🏆 Gold Find detected:', listing.title?.substring(0, 50));
      await emailService.sendGoldFindAlert(listing);
    }

    // Check for Price Drop (update only)
    if (alertType === 'update' && oldPrice && listing.price < oldPrice) {
      const dropPercentage = ((oldPrice - listing.price) / oldPrice) * 100;
      if (dropPercentage >= 10) {
        console.log(`[EMAIL-ALERT] 📉 Price Drop ${dropPercentage.toFixed(1)}%:`, listing.title?.substring(0, 50));
        await emailService.sendPriceDropAlert(listing, oldPrice, dropPercentage);
      }
    }

    // Check for Top Listing (new listings only - quality score >= 90)
    if (alertType === 'new' && listing.quality_score && listing.quality_score >= 90) {
      console.log('[EMAIL-ALERT] ⭐ Top Listing detected:', listing.title?.substring(0, 50), `(Score: ${listing.quality_score})`);
      await emailService.sendTopListingAlert(listing);
    }
  } catch (error) {
    console.error('[EMAIL-ALERT] Error sending alert:', error);
    // Don't throw - email failures shouldn't break scraping
  }
}

export async function registerRoutes(app: Express): Promise<Server> {
  // Register ML routes
  registerMLRoutes(app);
  const httpServer = createServer(app);
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  // WebSocket helper
  const broadcastLog = (message: string) => {
    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({ type: 'scraperUpdate', message }));
      }
    });
  };

  wss.on('connection', (ws) => {
    console.log('WebSocket client connected');
    ws.on('close', () => console.log('WebSocket client disconnected'));
    ws.send(JSON.stringify({ type: 'connected', message: 'WebSocket connected' }));
  });

  const priceEvaluator = new PriceEvaluator();

  // Import scraper services (V3, 24/7, Newest, derStandard)
  const { ContinuousScraper247Service } = await import('./services/scraper-24-7');
  const continuousScraper = new ContinuousScraper247Service();
  const newestScraper = new MultiNewestScraperService();
  const derStandardScraper = new DerStandardScraperService();
  const immoScoutScraper = new ImmoScout24ScraperService();

  // Listings routes
  app.get("/api/listings", async (req, res) => {
    try {
      const { region, district, price_evaluation, akquise_erledigt, angeschrieben, is_deleted, category, has_phone, min_price, max_price, source, limit, offset, sortBy, has_price_drop } = req.query;
      const filters: any = {};

      if (region && region !== "Alle Regionen") filters.region = region;
      if (district && district !== "Alle Bezirke") filters.district = district;
      if (price_evaluation && price_evaluation !== "Alle Preise") {
        const mapping: { [key: string]: string } = {
          "Unter dem Schnitt": "unter_schnitt",
          "Im Schnitt": "im_schnitt",
          "Über dem Schnitt": "ueber_schnitt"
        };
        filters.price_evaluation = mapping[price_evaluation as string];
      }
      if (akquise_erledigt !== undefined) filters.akquise_erledigt = akquise_erledigt === "true";
      if (angeschrieben !== undefined) filters.angeschrieben = angeschrieben === "true";
      if (is_deleted !== undefined) filters.is_deleted = is_deleted === "true";
      if (category && category !== "Alle Kategorien") filters.category = category;
      if (has_phone !== undefined) filters.has_phone = has_phone === "true";
      if (min_price) filters.min_price = parseInt(min_price as string);
      if (max_price) filters.max_price = parseInt(max_price as string);
      if (source && source !== "Alle Plattformen") filters.source = source;
      // NEW: Pagination and sorting
      if (limit) filters.limit = parseInt(limit as string);
      if (offset) filters.offset = parseInt(offset as string);
      if (sortBy) filters.sortBy = sortBy as string;
      if (has_price_drop !== undefined) filters.has_price_drop = has_price_drop === "true";

      const listings = await storage.getListings(filters);
      res.json(listings);
    } catch (error: any) {
      console.error('[LISTINGS-API] Error fetching listings:', error);
      res.status(500).json({ message: "Failed to fetch listings", error: error?.message || String(error) });
    }
  });

  // All listings with pagination (for /all-listings page)
  app.get("/api/listings/all", async (req, res) => {
    try {
      const { region, district, price_evaluation, akquise_erledigt, angeschrieben, is_deleted, category, has_phone, min_price, max_price, source, page, per_page, sortBy, has_price_drop } = req.query;
      const filters: any = {};

      if (region && region !== "Alle Regionen") filters.region = region;
      if (district && district !== "Alle Bezirke") filters.district = district;
      if (price_evaluation && price_evaluation !== "Alle Preise") {
        const mapping: { [key: string]: string } = {
          "Unter dem Schnitt": "unter_schnitt",
          "Im Schnitt": "im_schnitt",
          "Über dem Schnitt": "ueber_schnitt"
        };
        filters.price_evaluation = mapping[price_evaluation as string];
      }
      if (akquise_erledigt !== undefined) filters.akquise_erledigt = akquise_erledigt === "true";
      if (angeschrieben !== undefined) filters.angeschrieben = angeschrieben === "true";
      if (is_deleted !== undefined) filters.is_deleted = is_deleted === "true";
      if (category && category !== "Alle Kategorien") filters.category = category;
      if (has_phone !== undefined) filters.has_phone = has_phone === "true";
      if (min_price) filters.min_price = parseInt(min_price as string);
      if (max_price) filters.max_price = parseInt(max_price as string);
      if (source && source !== "Alle Plattformen") filters.source = source;
      if (sortBy) filters.sortBy = sortBy as string;
      if (has_price_drop !== undefined) filters.has_price_drop = has_price_drop === "true";

      // Pagination
      const pageNum = parseInt(page as string) || 1;
      const perPage = Math.min(parseInt(per_page as string) || 50, 200); // Max 200 per page
      filters.limit = perPage;
      filters.offset = (pageNum - 1) * perPage;

      // Get total count and listings in parallel
      const [listings, totalCount] = await Promise.all([
        storage.getListings(filters),
        storage.getListingsCount(filters)
      ]);

      res.json({
        listings,
        pagination: {
          page: pageNum,
          per_page: perPage,
          total: totalCount,
          total_pages: Math.ceil(totalCount / perPage)
        }
      });
    } catch (error: any) {
      console.error('[LISTINGS-ALL-API] Error:', error);
      res.status(500).json({ message: "Failed to fetch all listings", error: error?.message || String(error) });
    }
  });

  // Duplicate detection endpoints
  app.post("/api/duplicates/scan", async (req, res) => {
    try {
      const { scanAllForDuplicates } = await import('./services/duplicate-detector');
      const result = await scanAllForDuplicates();
      res.json(result);
    } catch (error: any) {
      console.error('[DUPLICATES-API] Scan error:', error);
      res.status(500).json({ message: "Failed to scan for duplicates", error: error?.message });
    }
  });

  app.get("/api/duplicates/:listingId", async (req, res) => {
    try {
      const { findDuplicates, getDuplicateGroup } = await import('./services/duplicate-detector');
      const listingId = parseInt(req.params.listingId);

      // Get the listing first
      const listing = await storage.getListingById(listingId);
      if (!listing) {
        return res.status(404).json({ message: "Listing not found" });
      }

      // If already in a group, return group members
      if (listing.duplicate_group_id) {
        const group = await getDuplicateGroup(listing.duplicate_group_id);
        return res.json({ grouped: true, members: group });
      }

      // Otherwise, find potential duplicates
      const candidates = await findDuplicates(listingId);
      res.json({ grouped: false, candidates });
    } catch (error: any) {
      console.error('[DUPLICATES-API] Error:', error);
      res.status(500).json({ message: "Failed to get duplicates", error: error?.message });
    }
  });

  app.post("/api/duplicates/group", async (req, res) => {
    try {
      const { groupDuplicates } = await import('./services/duplicate-detector');
      const { listingIds } = req.body;

      if (!Array.isArray(listingIds) || listingIds.length < 2) {
        return res.status(400).json({ message: "At least 2 listing IDs required" });
      }

      await groupDuplicates(listingIds);
      res.json({ success: true, message: `Grouped ${listingIds.length} listings` });
    } catch (error: any) {
      console.error('[DUPLICATES-API] Group error:', error);
      res.status(500).json({ message: "Failed to group listings", error: error?.message });
    }
  });

  app.post("/api/duplicates/ungroup/:listingId", async (req, res) => {
    try {
      const { ungroupListing } = await import('./services/duplicate-detector');
      const listingId = parseInt(req.params.listingId);

      await ungroupListing(listingId);
      res.json({ success: true, message: "Listing ungrouped" });
    } catch (error: any) {
      console.error('[DUPLICATES-API] Ungroup error:', error);
      res.status(500).json({ message: "Failed to ungroup listing", error: error?.message });
    }
  });

  // Fetch recent discovered links (Scraper V2)
  app.get("/api/scraper/v2/links", async (req, res) => {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 200;
      const links = await storage.getDiscoveredLinks(Math.min(limit, 1000));
      res.json(links);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch discovered links" });
    }
  });

  app.get("/api/listings/stats", async (req, res) => {
    try {
      const stats = await storage.getListingStats();
      res.json(stats);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch stats" });
    }
  });

  // Geo-Filter: Blockierte Orte aus aktueller DB abrufen
  app.get("/api/geo-filter/blocked-locations", async (req, res) => {
    try {
      // Hole alle aktiven Listings
      const allListings = await db.select().from(listings);
      const activeListings = allListings.filter(l => !l.deleted_at);

      interface BlockedLocation {
        id: number;
        title: string;
        location: string;
        region: string;
        reason: string;
        url: string;
      }

      const blocked: BlockedLocation[] = [];

      for (const listing of activeListings) {
        if (!listing.location || !listing.region) continue;

        const result = isInAkquiseGebiet(listing.location, listing.region);

        if (!result.allowed) {
          blocked.push({
            id: listing.id,
            title: listing.title || 'Kein Titel',
            location: listing.location,
            region: listing.region,
            reason: result.reason,
            url: listing.url || '',
          });
        }
      }

      // Sortiere nach Ort
      blocked.sort((a, b) => a.location.localeCompare(b.location));

      // Für Download als TXT
      const format = req.query.format;
      if (format === 'txt') {
        const lines = [
          `Blockierte Orte im Geo-Filter`,
          `Stand: ${new Date().toLocaleString('de-DE')}`,
          `Gesamt: ${blocked.length} von ${activeListings.length} Listings blockiert`,
          ``,
          `-------------------------------------------`,
          ``,
        ];

        // Gruppiere nach Grund
        const byReason: Record<string, BlockedLocation[]> = {};
        for (const b of blocked) {
          if (!byReason[b.reason]) byReason[b.reason] = [];
          byReason[b.reason].push(b);
        }

        for (const [reason, items] of Object.entries(byReason)) {
          lines.push(`${reason} (${items.length} Listings):`);
          lines.push(`-------------------------------------------`);
          for (const item of items) {
            lines.push(`  ${item.location}`);
            lines.push(`    → ${item.title.substring(0, 60)}...`);
            lines.push(`    → ${item.url}`);
          }
          lines.push(``);
        }

        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="blockierte-orte.txt"');
        res.send(lines.join('\n'));
      } else {
        // JSON-Response
        res.json({
          total_active: activeListings.length,
          total_blocked: blocked.length,
          block_rate: `${((blocked.length / activeListings.length) * 100).toFixed(1)}%`,
          blocked_locations: blocked,
        });
      }
    } catch (error: any) {
      console.error('[GEO-FILTER] Error:', error);
      res.status(500).json({ message: "Failed to get blocked locations", error: error?.message });
    }
  });

  // Geo-Blocked Listings aus der separaten Tabelle
  app.get("/api/geo-blocked-listings", async (req, res) => {
    try {
      const { source, region, limit, offset } = req.query;
      const filters: any = {};
      if (source && source !== "all") filters.source = source;
      if (region && region !== "all") filters.region = region;
      if (limit) filters.limit = parseInt(limit as string);
      if (offset) filters.offset = parseInt(offset as string);

      const blockedListings = await storage.getGeoBlockedListings(filters);
      res.json(blockedListings);
    } catch (error: any) {
      console.error('[GEO-BLOCKED] Error fetching blocked listings:', error);
      res.status(500).json({ message: "Failed to fetch blocked listings", error: error?.message });
    }
  });

  // Geo-Blocked Statistiken
  app.get("/api/geo-blocked-stats", async (req, res) => {
    try {
      const stats = await storage.getGeoBlockedStats();
      res.json(stats);
    } catch (error: any) {
      console.error('[GEO-BLOCKED] Error fetching stats:', error);
      res.status(500).json({ message: "Failed to fetch stats", error: error?.message });
    }
  });

  // Scraper Intake Statistiken (täglicher Eingang)
  app.get("/api/scraper-intake-stats", async (req, res) => {
    try {
      // Hole Listings der letzten 7 Tage
      const allListings = await db.select().from(listings);
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const sevenDaysAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);

      // Filter Listings der letzten 7 Tage (basierend auf first_seen_at)
      const recentListings = allListings.filter(l => {
        if (!l.first_seen_at) return false;
        const seenDate = new Date(l.first_seen_at);
        return seenDate >= sevenDaysAgo;
      });

      // Heute
      const todayListings = recentListings.filter(l => {
        const seenDate = new Date(l.first_seen_at!);
        return seenDate >= today;
      });

      // By Hour (today)
      const byHour: Record<string, number> = {};
      for (const l of todayListings) {
        const hour = new Date(l.first_seen_at!).getHours();
        byHour[hour.toString()] = (byHour[hour.toString()] || 0) + 1;
      }

      // By Source (today)
      const todayBySource: Record<string, number> = {};
      for (const l of todayListings) {
        const source = l.source || 'unknown';
        todayBySource[source] = (todayBySource[source] || 0) + 1;
      }

      // Avg Quality Score (today)
      const todayScores = todayListings
        .filter(l => l.quality_score !== null && l.quality_score !== undefined)
        .map(l => l.quality_score!);
      const avgQualityScore = todayScores.length > 0
        ? Math.round(todayScores.reduce((a, b) => a + b, 0) / todayScores.length)
        : 0;

      // By Day (last 7 days)
      const byDay: Record<string, number> = {};
      for (const l of recentListings) {
        const day = new Date(l.first_seen_at!).toISOString().split('T')[0];
        byDay[day] = (byDay[day] || 0) + 1;
      }

      // By Source (last 7 days)
      const weekBySource: Record<string, number> = {};
      for (const l of recentListings) {
        const source = l.source || 'unknown';
        weekBySource[source] = (weekBySource[source] || 0) + 1;
      }

      res.json({
        today: {
          total: todayListings.length,
          by_source: todayBySource,
          by_hour: byHour,
          avg_quality_score: avgQualityScore,
        },
        last_7_days: {
          total: recentListings.length,
          by_day: byDay,
          by_source: weekBySource,
        },
      });
    } catch (error: any) {
      console.error('[SCRAPER-STATS] Error:', error);
      res.status(500).json({ message: "Failed to fetch scraper stats", error: error?.message });
    }
  });

  // Scraper Analytics Stats (extended with 30 days + ML insights)
  app.get("/api/scraper-analytics-stats", async (req, res) => {
    try {
      const allListings = await db.select().from(listings);
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const sevenDaysAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
      const thirtyDaysAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);

      // Helper: Get date to use for filtering (first_seen_at or created_at as fallback)
      const getListingDate = (l: typeof allListings[0]): Date | null => {
        if (l.first_seen_at) return new Date(l.first_seen_at);
        if (l.created_at) return new Date(l.created_at);
        return null;
      };

      console.log(`[SCRAPER-ANALYTICS] Total listings: ${allListings.length}`);

      // Filter by time periods - use first_seen_at OR created_at
      const last30DaysListings = allListings.filter(l => {
        const date = getListingDate(l);
        if (!date) return false;
        return date >= thirtyDaysAgo;
      });

      console.log(`[SCRAPER-ANALYTICS] Last 30 days: ${last30DaysListings.length}`);

      const last7DaysListings = last30DaysListings.filter(l => {
        const date = getListingDate(l)!;
        return date >= sevenDaysAgo;
      });

      const todayListings = last7DaysListings.filter(l => {
        const date = getListingDate(l)!;
        return date >= today;
      });

      console.log(`[SCRAPER-ANALYTICS] Last 7 days: ${last7DaysListings.length}, Today: ${todayListings.length}`);

      // === TODAY STATS ===
      const todayByHour: Record<string, number> = {};
      const todayBySource: Record<string, number> = {};
      for (const l of todayListings) {
        const date = getListingDate(l)!;
        const hour = date.getHours();
        todayByHour[hour.toString()] = (todayByHour[hour.toString()] || 0) + 1;
        const source = l.source || 'unknown';
        todayBySource[source] = (todayBySource[source] || 0) + 1;
      }
      const todayScores = todayListings.filter(l => l.quality_score).map(l => l.quality_score!);
      const avgQualityScore = todayScores.length > 0
        ? Math.round(todayScores.reduce((a, b) => a + b, 0) / todayScores.length)
        : 0;

      // === 7 DAYS STATS ===
      const week7ByDay: Record<string, number> = {};
      const week7BySource: Record<string, number> = {};
      for (const l of last7DaysListings) {
        const date = getListingDate(l)!;
        const day = date.toISOString().split('T')[0];
        week7ByDay[day] = (week7ByDay[day] || 0) + 1;
        const source = l.source || 'unknown';
        week7BySource[source] = (week7BySource[source] || 0) + 1;
      }

      // === 30 DAYS STATS ===
      const month30ByDay: Record<string, number> = {};
      const month30BySource: Record<string, number> = {};
      for (const l of last30DaysListings) {
        const date = getListingDate(l)!;
        const day = date.toISOString().split('T')[0];
        month30ByDay[day] = (month30ByDay[day] || 0) + 1;
        const source = l.source || 'unknown';
        month30BySource[source] = (month30BySource[source] || 0) + 1;
      }

      // === ML INSIGHTS ===
      // Calculate average listings per hour (over 30 days)
      const hourlyTotals: Record<number, number[]> = {};
      for (let i = 0; i < 24; i++) hourlyTotals[i] = [];

      // Group by date and hour
      const dateHourCounts: Record<string, Record<number, number>> = {};
      for (const l of last30DaysListings) {
        const listingDate = getListingDate(l)!;
        const dateStr = listingDate.toISOString().split('T')[0];
        const hour = listingDate.getHours();
        if (!dateHourCounts[dateStr]) dateHourCounts[dateStr] = {};
        dateHourCounts[dateStr][hour] = (dateHourCounts[dateStr][hour] || 0) + 1;
      }

      // Calculate average per hour
      const daysWithData = Object.keys(dateHourCounts).length || 1;
      const hourlyAvg: Record<number, number> = {};
      for (let h = 0; h < 24; h++) {
        let total = 0;
        for (const date of Object.keys(dateHourCounts)) {
          total += dateHourCounts[date][h] || 0;
        }
        hourlyAvg[h] = Math.round(total / daysWithData * 10) / 10;
      }

      // Find peak and quiet hours
      const hourEntries = Object.entries(hourlyAvg).map(([h, avg]) => ({ hour: parseInt(h), avg }));
      hourEntries.sort((a, b) => b.avg - a.avg);
      const peakHours = hourEntries.slice(0, 4).map(e => e.hour).sort((a, b) => a - b);
      const quietHours = hourEntries.slice(-4).map(e => e.hour).sort((a, b) => a - b);
      const bestHour = hourEntries[0];
      const worstHour = hourEntries[hourEntries.length - 1];

      // Calculate best day of week
      const dayOfWeekTotals: Record<string, number[]> = {
        'Mo': [], 'Di': [], 'Mi': [], 'Do': [], 'Fr': [], 'Sa': [], 'So': []
      };
      const dayNames = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
      for (const [date, count] of Object.entries(month30ByDay)) {
        const dayOfWeek = dayNames[new Date(date).getDay()];
        dayOfWeekTotals[dayOfWeek].push(count);
      }
      const dayOfWeekAvg: Record<string, number> = {};
      for (const [day, counts] of Object.entries(dayOfWeekTotals)) {
        dayOfWeekAvg[day] = counts.length > 0
          ? Math.round(counts.reduce((a, b) => a + b, 0) / counts.length)
          : 0;
      }
      const bestDayEntry = Object.entries(dayOfWeekAvg).sort((a, b) => b[1] - a[1])[0];

      // Calculate trend (this week vs last week)
      const thisWeekStart = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
      const lastWeekStart = new Date(today.getTime() - 14 * 24 * 60 * 60 * 1000);
      const thisWeekListings = last30DaysListings.filter(l => getListingDate(l)! >= thisWeekStart);
      const lastWeekListings = last30DaysListings.filter(l => {
        const d = getListingDate(l)!;
        return d >= lastWeekStart && d < thisWeekStart;
      });
      const thisWeekCount = thisWeekListings.length;
      const lastWeekCount = lastWeekListings.length || 1;
      const trendPercentage = Math.round(((thisWeekCount - lastWeekCount) / lastWeekCount) * 100);
      let trend: 'up' | 'down' | 'stable' = 'stable';
      if (trendPercentage > 5) trend = 'up';
      else if (trendPercentage < -5) trend = 'down';

      res.json({
        today: {
          total: todayListings.length,
          by_source: todayBySource,
          by_hour: todayByHour,
          avg_quality_score: avgQualityScore,
        },
        last_7_days: {
          total: last7DaysListings.length,
          by_day: week7ByDay,
          by_source: week7BySource,
        },
        last_30_days: {
          total: last30DaysListings.length,
          by_day: month30ByDay,
          by_source: month30BySource,
          avg_per_day: Math.round(last30DaysListings.length / 30),
        },
        insights: {
          best_hour: bestHour?.hour ?? 12,
          best_hour_avg: bestHour?.avg ?? 0,
          worst_hour: worstHour?.hour ?? 3,
          worst_hour_avg: worstHour?.avg ?? 0,
          best_day_of_week: bestDayEntry?.[0] ?? 'Mo',
          best_day_avg: bestDayEntry?.[1] ?? 0,
          trend,
          trend_percentage: trendPercentage,
          peak_hours: peakHours,
          quiet_hours: quietHours,
        },
      });
    } catch (error: any) {
      console.error('[SCRAPER-ANALYTICS] Error:', error);
      res.status(500).json({ message: "Failed to fetch scraper analytics", error: error?.message });
    }
  });

  app.patch("/api/listings/:id/akquise", async (req, res) => {
    try {
      const { id } = req.params;
      const { akquise_erledigt, is_success, userId } = req.body;
      const listingId = parseInt(id);

      await storage.updateListingAkquiseStatus(listingId, akquise_erledigt);

      // Create ML outcome feedback when marking as completed
      if (akquise_erledigt) {
        try {
          const listing = await storage.getListingById(listingId);
          if (listing) {
            const outcomeType = is_success ? 'akquise_success' : 'akquise_completed';
            const features = extractFeatures(listing);

            await createOutcomeFeedback({
              listing_id: listingId,
              user_id: userId || null,
              outcome_type: outcomeType,
              score_adjustment: getScoreAdjustment(outcomeType),
              features,
              original_score: listing.quality_score || 0,
              notes: is_success ? 'Erfolgreiche Akquise' : 'Akquise erledigt',
            });
            console.log(`[ML-OUTCOME] Created outcome feedback: ${outcomeType} for listing ${listingId}`);
          }
        } catch (mlError) {
          console.error('[ML-OUTCOME] Failed to create outcome feedback:', mlError);
          // Don't fail the main operation if ML feedback fails
        }
      }

      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Failed to update listing status" });
    }
  });

  app.delete("/api/listings/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const { reason, userId, deleteType } = req.body;
      const listingId = parseInt(id);

      // Get listing before deletion for ML feedback
      const listing = await storage.getListingById(listingId);

      await storage.markListingAsDeleted(listingId, userId, reason);

      // Create ML outcome feedback based on deletion type
      if (listing) {
        try {
          // Map deleteType to outcome_type
          let outcomeType: 'deleted_spam' | 'deleted_not_relevant' | 'deleted_sold' | 'deleted_other' = 'deleted_other';

          if (deleteType === 'spam') outcomeType = 'deleted_spam';
          else if (deleteType === 'not_relevant') outcomeType = 'deleted_not_relevant';
          else if (deleteType === 'sold') outcomeType = 'deleted_sold';
          else if (reason?.toLowerCase().includes('spam') || reason?.toLowerCase().includes('fake')) outcomeType = 'deleted_spam';
          else if (reason?.toLowerCase().includes('verkauft') || reason?.toLowerCase().includes('sold')) outcomeType = 'deleted_sold';

          const features = extractFeatures(listing);

          await createOutcomeFeedback({
            listing_id: listingId,
            user_id: userId || null,
            outcome_type: outcomeType,
            score_adjustment: getScoreAdjustment(outcomeType),
            features,
            original_score: listing.quality_score || 0,
            notes: reason || `Deleted: ${outcomeType}`,
          });
          console.log(`[ML-OUTCOME] Created outcome feedback: ${outcomeType} for listing ${listingId}`);
        } catch (mlError) {
          console.error('[ML-OUTCOME] Failed to create outcome feedback:', mlError);
          // Don't fail the main operation if ML feedback fails
        }
      }

      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Failed to delete listing" });
    }
  });

  app.get("/api/listings/deleted-unsuccessful", async (req, res) => {
    try {
      const results = await storage.getDeletedAndUnsuccessful();
      res.json(results);
    } catch (error) {
      console.error("Error fetching deleted/unsuccessful listings:", error);
      res.status(500).json({ message: "Failed to fetch deleted/unsuccessful listings", error: String(error) });
    }
  });

  app.get("/api/listings/successful", async (req, res) => {
    try {
      const { userId } = req.query;
      const results = await storage.getSuccessfulAcquisitions(userId ? parseInt(userId as string) : undefined);
      res.json(results);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch successful acquisitions" });
    }
  });

  app.get("/api/listings/contacted", async (req, res) => {
    try {
      const { userId } = req.query;
      const results = await storage.getContactedListings(userId ? parseInt(userId as string) : undefined);
      res.json(results);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch contacted listings" });
    }
  });

  app.patch("/api/listings/:id/angeschrieben", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { angeschrieben } = req.body;
      await storage.markAsContacted(id, angeschrieben);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Failed to mark listing as contacted" });
    }
  });

  // Get single listing by ID (for email deep-links)
  // IMPORTANT: Must be AFTER all specific /api/listings/xxx routes
  app.get("/api/listings/by-id/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) {
        return res.status(400).json({ error: "Invalid listing ID" });
      }

      const [listing] = await db
        .select()
        .from(listings)
        .where(eq(listings.id, id))
        .limit(1);

      if (!listing) {
        return res.status(404).json({ error: "Listing not found" });
      }

      res.json(listing);
    } catch (error: any) {
      console.error('[LISTINGS-API] Error fetching single listing:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Contacts routes
  app.get("/api/contacts", async (req, res) => {
    try {
      const contacts = await storage.getContacts();
      res.json(contacts);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch contacts" });
    }
  });

  app.post("/api/contacts", async (req, res) => {
    try {
      const validatedData = insertContactSchema.parse(req.body);
      const contact = await storage.createContact(validatedData);
      res.json(contact);
    } catch (error) {
      res.status(400).json({ message: "Invalid contact data" });
    }
  });

  app.patch("/api/contacts/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const validatedData = insertContactSchema.partial().parse(req.body);
      const contact = await storage.updateContact(parseInt(id), validatedData);
      res.json(contact);
    } catch (error) {
      res.status(400).json({ message: "Invalid contact data" });
    }
  });

  app.delete("/api/contacts/:id", async (req, res) => {
    try {
      const { id } = req.params;
      await storage.deleteContact(parseInt(id));
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Failed to delete contact" });
    }
  });

  // Contact-Listing assignment routes
  app.post("/api/listings/:listingId/contacts/:contactId", async (req, res) => {
    try {
      const { listingId, contactId } = req.params;
      const assignment = await storage.assignContactToListing(
        parseInt(listingId),
        parseInt(contactId)
      );
      res.json(assignment);
    } catch (error) {
      res.status(500).json({ message: "Failed to assign contact to listing" });
    }
  });

  app.delete("/api/listings/:listingId/contacts/:contactId", async (req, res) => {
    try {
      const { listingId, contactId } = req.params;
      await storage.unassignContactFromListing(
        parseInt(listingId),
        parseInt(contactId)
      );
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Failed to unassign contact from listing" });
    }
  });

  app.get("/api/contacts/:id/listings", async (req, res) => {
    try {
      const { id } = req.params;
      const listings = await storage.getListingsForContact(parseInt(id));
      res.json(listings);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch contact listings" });
    }
  });

  // Price statistics route
  app.get("/api/price-stats", async (req, res) => {
    try {
      const { region, category } = req.query;
      const filters: any = {};

      if (region && region !== "all") filters.region = region;
      if (category && category !== "all") filters.category = category;

      const priceStats = await storage.getPriceStatistics(filters);
      res.json(priceStats);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch price statistics" });
    }
  });

  // User statistics routes for sidebar
  app.get("/api/user-stats/personal/:userId", async (req, res) => {
    try {
      const { userId } = req.params;
      const stats = await storage.getPersonalStats(parseInt(userId));
      res.json(stats);
    } catch (error) {
      console.error("Error fetching personal stats:", error);
      res.status(500).json({ message: "Failed to fetch personal statistics" });
    }
  });

  app.get("/api/user-stats/all", async (req, res) => {
    try {
      const stats = await storage.getAllUserStats();
      res.json(stats);
    } catch (error) {
      console.error("Error fetching all user stats:", error);
      res.status(500).json({ message: "Failed to fetch user statistics" });
    }
  });

  // Logout endpoint to end session
  app.post("/api/auth/logout", async (req, res) => {
    try {
      const { sessionId } = req.body;
      if (sessionId) {
        await storage.endUserSession(sessionId);
      }
      res.json({ success: true });
    } catch (error) {
      console.error("Logout error:", error);
      res.status(500).json({ error: "Logout failed" });
    }
  });

  // User changes own password (no old password required)
  app.post("/api/auth/change-password", async (req, res) => {
    try {
      const { userId, newPassword } = req.body;

      if (!newPassword || newPassword.length < 4) {
        res.status(400).json({ error: "Neues Passwort muss mindestens 4 Zeichen lang sein" });
        return;
      }

      const user = await storage.getUser(userId);
      if (!user) {
        res.status(404).json({ error: "Benutzer nicht gefunden" });
        return;
      }

      // Hash new password (12 rounds for security)
      const hashedPassword = await bcrypt.hash(newPassword, 12);

      // Update password
      await db.update(users)
        .set({ password: hashedPassword })
        .where(eq(users.id, userId));

      console.log(`[PASSWORD CHANGE] User ${user.username} changed their password`);
      res.json({ success: true });
    } catch (error) {
      console.error("Password change error:", error);
      res.status(500).json({ error: "Passwort-Änderung fehlgeschlagen" });
    }
  });

  // DISABLED: Price mirror scraper routes - will be improved later with per-district pricing
  // app.post("/api/scraper/price-mirror", async (req, res) => {
  //   try {
  //     console.log("🚀 PRICE MIRROR SCRAPER API TRIGGERED");
  //
  //     // Start daily price mirror scraping with detailed logging
  //     priceMirrorService.startDailyPriceMirrorScrape()
  //       .then(() => {
  //         console.log("✅ PRICE MIRROR SCRAPER COMPLETED SUCCESSFULLY");
  //       })
  //       .catch((error: any) => {
  //         console.error("❌ PRICE MIRROR SCRAPER FAILED:", error);
  //       });
  //
  //     res.json({ success: true, message: "Preisspiegel-Scraper gestartet" });
  //   } catch (error: any) {
  //     console.error("❌ Price mirror scraper API error:", error);
  //     res.status(500).json({ error: "Failed to start price mirror scraper", details: error.message });
  //   }
  // });

  // app.get("/api/price-mirror-data", async (req, res) => {
  //   try {
  //     console.log("📊 FETCHING PRICE MIRROR DATA");
  //     const data = await storage.getPriceMirrorData();
  //     console.log(`📈 FOUND ${data.length} PRICE MIRROR RECORDS`);
  //     res.json(data);
  //   } catch (error: any) {
  //     console.error("❌ Price mirror data error:", error);
  //     res.status(500).json({ error: "Failed to fetch price mirror data", details: error.message });
  //   }
  // });

  // Scraper routes mapped to V3 (stealth-based) to keep UI compatible
  app.post("/api/scraper/start", async (req, res) => {
    try {
      const { categories: rawCategories = [], maxPages = 10, delay = 1000, keyword } = req.body;

      // Normalize UI inputs into proper categories and regions
      const { categories, regions } = normalizeInputs(rawCategories, []);

      if (categories.length === 0) {
        categories.push('eigentumswohnung', 'grundstueck');
      }

      const v3 = new ScraperV3Service();

      // broadcast status
      wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify({ type: 'scraperStatus', status: 'Läuft (V3)' }));
        }
      });

      (async () => {
        await v3.start({
          categories,
          regions,
          maxPages,
          delayMs: Math.max(400, Number(delay) || 800),
          jitterMs: 600,
          keyword: keyword || 'privat', // Default: 'privat', kann vom UI überschrieben werden
          onLog: (message) => {
            console.log('[V3-SCRAPER]', message);
            wss.clients.forEach(client => {
              if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({ type: 'scraperUpdate', message }));
              }
            });
          },
          onDiscoveredLink: async ({ url, category, region }) => {
            try {
              const saved = await storage.saveDiscoveredLink({ url, category, region });
              wss.clients.forEach(client => {
                if (client.readyState === WebSocket.OPEN) {
                  client.send(JSON.stringify({ type: 'discoveredLink', link: saved }));
                }
              });
            } catch (e) {
              console.error('saveDiscoveredLink error', e);
            }
          },
          onPhoneFound: async ({ url, phone }) => {
            try {
              const updated = await storage.updateDiscoveredLinkPhone(url, phone);
              wss.clients.forEach(client => {
                if (client.readyState === WebSocket.OPEN) {
                  client.send(JSON.stringify({ type: 'phoneFound', link: updated || { url, phone_number: phone } }));
                }
              });
            } catch (e) {
              console.error('updateDiscoveredLinkPhone error', e);
            }
          },
          onListingFound: async (listingData: any) => {
            try {
              // sanitize payload for DB schema
              const { scraped_at: _omitScrapedAt, ...rest } = listingData || {};
              const safe: any = { ...rest };
              if (!safe.location || String(safe.location).trim().length === 0) {
                safe.location = safe.region === 'wien' ? 'Wien' : 'Niederösterreich';
              }
              if (typeof safe.area === 'number') safe.area = String(safe.area);
              if (typeof safe.eur_per_m2 === 'number') safe.eur_per_m2 = String(safe.eur_per_m2);

              // Check if listing already exists
              const existing = await storage.getListingByUrl(safe.url);
              if (existing) {
                // Detect what changed
                const changeType = detectChangeType(
                  { price: existing.price, title: existing.title, description: existing.description, area: existing.area, images: existing.images },
                  { price: safe.price, title: safe.title, description: safe.description, area: safe.area, images: safe.images }
                );

                console.log('[V3-DB] Update (bereits vorhanden):', safe.title?.substring(0, 50), changeType ? `(${changeType})` : '');

                // Update scraped_at, last_changed_at, price, and change type
                await storage.updateListingOnRescrape(safe.url, {
                  scraped_at: new Date(),
                  last_changed_at: safe.last_changed_at,
                  last_change_type: changeType || undefined,
                  price: safe.price,
                  title: safe.title,
                  description: safe.description,
                  area: safe.area,
                  images: safe.images
                });

                // Track price changes for price drop detection
                if (existing.price !== safe.price) {
                  await trackPriceChange(existing.id,
                    { price: existing.price, area: existing.area, eur_per_m2: existing.eur_per_m2 },
                    { price: safe.price, area: safe.area, eur_per_m2: safe.eur_per_m2 }
                  );

                  // Check for price drop email alert
                  await checkAndSendAlerts({ ...existing, price: safe.price }, 'update', existing.price);
                }

                console.log('[V3-DB] ✓ Aktualisiert:', existing.id);
                return;
              }

              const priceEvaluation = await priceEvaluator.evaluateListing(
                Number(safe.eur_per_m2 || 0),
                safe.region
              );
              const listing = await storage.createListing({
                ...safe,
                price_evaluation: priceEvaluation,
              });

              // Send email alerts for new listings (Gold Find, Top Listing)
              await checkAndSendAlerts(listing, 'new');

              wss.clients.forEach(client => {
                if (client.readyState === WebSocket.OPEN) {
                  client.send(JSON.stringify({ type: 'newListing', listing }));
                }
              });
              // push stats update
              const allListings = await storage.getListings({});
              const stats = {
                activeListings: allListings.filter(l => !l.akquise_erledigt).length,
                completedListings: allListings.filter(l => l.akquise_erledigt).length,
                totalListings: allListings.length,
                newListings: allListings.filter(l => {
                  const today = new Date();
                  const listingDate = new Date(l.scraped_at);
                  return listingDate.toDateString() === today.toDateString();
                }).length,
              };
              wss.clients.forEach(client => {
                if (client.readyState === WebSocket.OPEN) {
                  client.send(JSON.stringify({ type: 'statsUpdate', stats }));
                }
              });
            } catch (error) {
              console.error('Error saving V3 listing:', error);
            }
          },
        });
      })();

      res.json({ success: true, message: "V3 Scraper gestartet" });
    } catch (error) {
      res.status(500).json({ message: "Failed to start scraping (V2)" });
    }
  });



  // 24/7 SCRAPER ENDPOINTS
  app.post("/api/scraper/start-247", async (req, res) => {
    try {
      const scraperOptions = {
        onProgress: (message: string) => {
          console.log('[24/7-SCRAPER]', message);
          wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
              client.send(JSON.stringify({ type: 'scraperUpdate', message: `[24/7] ${message}` }));
            }
          });
        },
        onListingFound: async (listingData: any) => {
          try {
            // Check ob bereits in DB
            const existing = await storage.getListingByUrl(listingData.url);
            if (existing) {
              // Detect what changed
              const changeType = detectChangeType(
                { price: existing.price, title: existing.title, description: existing.description, area: existing.area, images: existing.images },
                { price: listingData.price, title: listingData.title, description: listingData.description, area: listingData.area, images: listingData.images }
              );

              console.log('[24/7-DB] Update (bereits vorhanden):', listingData.title.substring(0, 50), changeType ? `(${changeType})` : '');

              // Update scraped_at, last_changed_at, price, and change type
              await storage.updateListingOnRescrape(listingData.url, {
                scraped_at: new Date(),
                last_changed_at: listingData.last_changed_at,
                last_change_type: changeType || undefined,
                price: listingData.price,
                title: listingData.title,
                description: listingData.description,
                area: listingData.area,
                images: listingData.images
              });

              // Track price changes for price drop detection
              if (existing.price !== listingData.price) {
                await trackPriceChange(existing.id,
                  { price: existing.price, area: existing.area, eur_per_m2: existing.eur_per_m2 },
                  { price: listingData.price, area: listingData.area, eur_per_m2: listingData.eur_per_m2 }
                );

                // Check for price drop email alert
                await checkAndSendAlerts({ ...existing, price: listingData.price }, 'update', existing.price);
              }

              console.log('[24/7-DB] ✓ Aktualisiert:', existing.id);
              return;
            }

            console.log('[24/7-DB] Speichere Listing:', listingData.title, '-', listingData.price);

            // Price evaluation
            const priceEvaluation = await priceEvaluator.evaluateListing(
              listingData.eur_per_m2,
              listingData.region
            );

            // Save to database
            const listing = await storage.createListing({
              ...listingData,
              price_evaluation: priceEvaluation
            });

            console.log('[24/7-DB] ✓ Gespeichert in DB:', listing.id);

            // Send email alerts for new listings (Gold Find, Top Listing)
            await checkAndSendAlerts(listing, 'new');

            // Broadcast new listing
            wss.clients.forEach(client => {
              if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({ type: 'newListing', listing }));
              }
            });
          } catch (error) {
            console.error('[24/7-DB] ✗ Fehler beim Speichern:', error);
          }
        }
      };

      await continuousScraper.start247Scraping(scraperOptions);

      res.json({ success: true, message: "24/7 Scraper gestartet" });
    } catch (error) {
      res.status(500).json({ message: "Failed to start 24/7 scraper" });
    }
  });

  app.post("/api/scraper/stop-247", async (req, res) => {
    try {
      continuousScraper.stop247Scraping((msg) => broadcastLog(msg));
      res.json({ success: true, message: "24/7 Scraper gestoppt" });
    } catch (error) {
      res.status(500).json({ message: "Failed to stop 24/7 scraper" });
    }
  });

  app.get("/api/scraper/status-247", async (req, res) => {
    try {
      const status = continuousScraper.getStatus();
      res.json(status);
    } catch (error) {
      res.status(500).json({ message: "Failed to get 24/7 scraper status" });
    }
  });

  // NEWEST SCRAPER ENDPOINTS (Neueste Inserate mit sort=1)
  app.post("/api/scraper/start-newest", async (req, res) => {
    try {
      const { intervalMinutes = 30, maxPages = 3 } = req.body;

      const scraperOptions = {
        intervalMinutes,
        maxPages,
        onLog: (message: string) => {
          console.log('[NEWEST-SCRAPER]', message);
          wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
              client.send(JSON.stringify({ type: 'scraperUpdate', message }));
            }
          });
        },
        onListingFound: async (listingData: any) => {
          try {
            const isDebug = process.env.DEBUG_SCRAPER === 'true';

            if (isDebug) {
              console.log('[NEWEST-DB] 🔍 Checking if exists:', listingData.url);
            }

            // Check if listing already exists
            const existing = await storage.getListingByUrl(listingData.url);
            if (existing) {
              if (isDebug) {
                console.log('[NEWEST-DB] 📝 UPDATE (bereits vorhanden - ID:', existing.id + '):', listingData.title.substring(0, 50));
                console.log('[NEWEST-DB]    Old price:', existing.price, '→ New price:', listingData.price);
                console.log('[NEWEST-DB]    Old scraped_at:', existing.scraped_at);
              }

              // Detect what changed
              const changeType = detectChangeType(
                { price: existing.price, title: existing.title, description: existing.description, area: existing.area, images: existing.images },
                { price: listingData.price, title: listingData.title, description: listingData.description, area: listingData.area, images: listingData.images }
              );

              // Update scraped_at, last_changed_at, price, and change type
              await storage.updateListingOnRescrape(listingData.url, {
                scraped_at: new Date(),
                last_changed_at: listingData.last_changed_at,
                last_change_type: changeType || undefined,
                price: listingData.price,
                title: listingData.title,
                description: listingData.description,
                area: listingData.area,
                images: listingData.images
              });

              // Track price changes for price drop detection
              if (existing.price !== listingData.price) {
                await trackPriceChange(existing.id,
                  { price: existing.price, area: existing.area, eur_per_m2: existing.eur_per_m2 },
                  { price: listingData.price, area: listingData.area, eur_per_m2: listingData.eur_per_m2 }
                );

                // Check for price drop email alert
                await checkAndSendAlerts({ ...existing, price: listingData.price }, 'update', existing.price);
              }

              if (isDebug) {
                console.log('[NEWEST-DB] ✅ UPDATE COMPLETE - scraped_at aktualisiert!', changeType ? `(${changeType})` : '');
                console.log('[NEWEST-DB] ✓ Aktualisiert:', existing.id);
              }
              return;
            }

            if (isDebug) {
              console.log('[NEWEST-DB] 🆕 NEW LISTING - saving to DB...');
              console.log('[NEWEST-DB]    Title:', listingData.title.substring(0, 60));
              console.log('[NEWEST-DB]    Price:', listingData.price);
              console.log('[NEWEST-DB]    Region:', listingData.region);
            }

            // Price evaluation
            const priceEvaluation = await priceEvaluator.evaluateListing(
              Number(listingData.eur_per_m2 || 0),
              listingData.region
            );

            if (isDebug) {
              console.log('[NEWEST-DB]    Price evaluation:', priceEvaluation);
            }

            // Save to database
            const listing = await storage.createListing({
              ...listingData,
              price_evaluation: priceEvaluation
            });

            if (isDebug) {
              console.log('[NEWEST-DB] ✅ NEW LISTING SAVED - ID:', listing.id);
            }

            // Send email alerts for new listings (Gold Find, Top Listing)
            await checkAndSendAlerts(listing, 'new');

            // Broadcast new listing
            wss.clients.forEach(client => {
              if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({ type: 'newListing', listing }));
              }
            });
          } catch (error: any) {
            console.error('[NEWEST-DB] ❌ FATAL ERROR beim Speichern:', error);
            console.error('[NEWEST-DB]    Error message:', error?.message);
            console.error('[NEWEST-DB]    Error stack:', error?.stack);
            console.error('[NEWEST-DB]    Listing data:', listingData);
          }
        },
        onPhoneFound: async ({ url, phone }: { url: string; phone: string }) => {
          try {
            const updated = await storage.updateDiscoveredLinkPhone(url, phone);
            wss.clients.forEach(client => {
              if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({ type: 'phoneFound', link: updated || { url, phone_number: phone } }));
              }
            });
          } catch (e) {
            console.error('updateDiscoveredLinkPhone error', e);
          }
        }
      };

      await newestScraper.start(scraperOptions);

      res.json({ success: true, message: "Newest Scraper gestartet (sort=1)" });
    } catch (error) {
      res.status(500).json({ message: "Failed to start newest scraper" });
    }
  });

  app.post("/api/scraper/stop-newest", async (req, res) => {
    try {
      newestScraper.stop((msg) => broadcastLog(msg));
      res.json({ success: true, message: "Newest Scraper gestoppt" });
    } catch (error) {
      res.status(500).json({ message: "Failed to stop newest scraper" });
    }
  });

  app.get("/api/scraper/status-newest", async (req, res) => {
    try {
      const status = newestScraper.getStatus();
      res.json(status);
    } catch (error) {
      res.status(500).json({ message: "Failed to get newest scraper status" });
    }
  });

  // Manual triggers for testing/debugging (optional)
  app.post("/api/scraper/trigger-newest-full", async (req, res) => {
    try {
      // Trigger immediate full scrape (will respect mutex if already running)
      (newestScraper as any).runFullScrape();
      res.json({ success: true, message: "Full scrape triggered manually" });
    } catch (error) {
      res.status(500).json({ message: "Failed to trigger full scrape" });
    }
  });

  app.post("/api/scraper/trigger-newest-quick", async (req, res) => {
    try {
      const hasNewListings = await (newestScraper as any).quickCheck();
      res.json({
        success: true,
        hasNewListings,
        message: hasNewListings ? "New listings detected" : "No new listings"
      });
    } catch (error) {
      res.status(500).json({ message: "Failed to trigger quick check" });
    }
  });

  // ============== PREISSPIEGEL SCRAPER (Vienna Market Data) ==============

  app.post("/api/scraper/start-preisspiegel", async (req, res) => {
    try {
      const { preisspiegelScraper } = await import('./services/scraper-preisspiegel');

      const logMessages: string[] = [];
      const onLog = (msg: string) => {
        logMessages.push(msg);
        if (wss) {
          wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
              client.send(JSON.stringify({ type: 'log', message: msg }));
            }
          });
        }
      };

      const onListingFound = async (listing: any) => {
        try {
          const result = await storage.upsertPriceMirrorListing(listing);
          console.log('[PREISSPIEGEL] DB Insert OK:', result.id, result.price, result.area_m2);
        } catch (e: any) {
          console.error('[PREISSPIEGEL] DB Error:', e?.message || e, 'Data:', listing);
          onLog(`[PREISSPIEGEL] DB Error: ${e?.message || e}`);
        }
      };

      preisspiegelScraper.startManualScrape({ onLog, onListingFound });

      res.json({ success: true, message: "Preisspiegel Scraper gestartet (Wien Marktdaten)" });
    } catch (error) {
      res.status(500).json({ message: "Failed to start preisspiegel scraper" });
    }
  });

  app.post("/api/scraper/stop-preisspiegel", async (req, res) => {
    try {
      const { preisspiegelScraper } = await import('./services/scraper-preisspiegel');
      preisspiegelScraper.stop();
      res.json({ success: true, message: "Preisspiegel Scraper gestoppt" });
    } catch (error) {
      res.status(500).json({ message: "Failed to stop preisspiegel scraper" });
    }
  });

  app.get("/api/scraper/status-preisspiegel", async (req, res) => {
    try {
      const { preisspiegelScraper } = await import('./services/scraper-preisspiegel');
      const status = preisspiegelScraper.getStatus();
      res.json(status);
    } catch (error) {
      res.status(500).json({ message: "Failed to get preisspiegel scraper status" });
    }
  });

  // Price Mirror Listings API
  app.get("/api/price-mirror/listings", async (req, res) => {
    try {
      const { category, bezirk_code, building_type } = req.query;
      const filters: any = {};

      if (category) filters.category = category;
      if (bezirk_code) filters.bezirk_code = bezirk_code;
      if (building_type) filters.building_type = building_type;

      const listings = await storage.getPriceMirrorListings(filters);
      res.json(listings);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch price mirror listings" });
    }
  });

  app.get("/api/price-mirror/stats", async (req, res) => {
    try {
      const { category, bezirk_code, building_type } = req.query;
      const filters: any = {};

      if (category) filters.category = category;
      if (bezirk_code) filters.bezirk_code = bezirk_code;
      if (building_type) filters.building_type = building_type as 'neubau' | 'altbau';

      const stats = await storage.getMarketStats(filters);
      console.log('[PREISSPIEGEL] Stats query result:', stats);
      res.json(stats);
    } catch (error) {
      console.error('[PREISSPIEGEL] Stats error:', error);
      res.status(500).json({ message: "Failed to fetch market stats" });
    }
  });

  app.get("/api/price-mirror/stats-by-bezirk", async (req, res) => {
    try {
      const { category, building_type } = req.query;
      const filters: any = {};

      if (category) filters.category = category;
      if (building_type) filters.building_type = building_type as 'neubau' | 'altbau';

      const stats = await storage.getMarketStatsByBezirk(filters);
      res.json(stats);
    } catch (error) {
      console.error('[PREISSPIEGEL] Stats by Bezirk error:', error);
      res.status(500).json({ message: "Failed to fetch market stats by Bezirk" });
    }
  });

  // ============== DERSTANDARD SCRAPER ==============

  app.post("/api/derstandard-scraper/start", async (req, res) => {
    try {
      const { intervalMinutes = 30, maxPages = 3, categories = [] } = req.body;

      // Filter baseUrls by selected categories if provided
      let selectedCategories = categories.length > 0 ? categories : Object.keys(derStandardScraper['baseUrls']);

      const scraperOptions = {
        intervalMinutes,
        maxPages,
        categories: selectedCategories,
        onLog: (message: string) => {
          console.log('[DERSTANDARD-SCRAPER]', message);
          wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
              client.send(JSON.stringify({ type: 'scraperUpdate', message }));
            }
          });
        },
        onListingFound: async (listingData: any) => {
          try {
            // Check if listing already exists
            const existing = await storage.getListingByUrl(listingData.url);
            if (existing) {
              // Detect what changed
              const changeType = detectChangeType(
                { price: existing.price, title: existing.title, description: existing.description, area: existing.area, images: existing.images },
                { price: listingData.price, title: listingData.title, description: listingData.description, area: listingData.area, images: listingData.images }
              );

              console.log('[DERSTANDARD-DB] Update (bereits vorhanden):', listingData.title.substring(0, 50), changeType ? `(${changeType})` : '');

              // Update scraped_at, price, and last_changed_at ONLY if something changed
              await storage.updateListingOnRescrape(listingData.url, {
                scraped_at: new Date(),
                last_changed_at: changeType ? new Date() : undefined, // Only update if changed
                last_change_type: changeType || undefined,
                price: listingData.price,
                title: listingData.title,
                description: listingData.description,
                area: listingData.area,
                images: listingData.images
              });

              // Track price changes for price drop detection
              if (existing.price !== listingData.price) {
                await trackPriceChange(existing.id,
                  { price: existing.price, area: existing.area, eur_per_m2: existing.eur_per_m2 },
                  { price: listingData.price, area: listingData.area, eur_per_m2: listingData.eur_per_m2 }
                );

                // Check for price drop email alert
                await checkAndSendAlerts({ ...existing, price: listingData.price }, 'update', existing.price);
              }

              console.log('[DERSTANDARD-DB] ✓ Aktualisiert:', existing.id, changeType ? `(${changeType})` : '(keine Änderungen)');
              return;
            }

            // Price evaluation
            const priceEvaluation = await priceEvaluator.evaluateListing(
              Number(listingData.eur_per_m2 || 0),
              listingData.region
            );

            // Save to database
            const listing = await storage.createListing({
              ...listingData,
              price_evaluation: priceEvaluation,
              source: 'derstandard'
            });

            console.log('[DERSTANDARD-DB] ✓ Neues Listing gespeichert:', listing.id);

            // Send email alerts for new listings (Gold Find, Top Listing)
            await checkAndSendAlerts(listing, 'new');

            // Broadcast new listing
            wss.clients.forEach(client => {
              if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({ type: 'newListing', listing }));
              }
            });
          } catch (error) {
            console.error('[DERSTANDARD-DB] ✗ Fehler beim Speichern:', error);
          }
        },
        onPhoneFound: async ({ url, phone }: { url: string; phone: string }) => {
          try {
            const updated = await storage.updateDiscoveredLinkPhone(url, phone);
            wss.clients.forEach(client => {
              if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({ type: 'phoneFound', link: updated || { url, phone_number: phone } }));
              }
            });
          } catch (e) {
            console.error('updateDiscoveredLinkPhone error', e);
          }
        }
      };

      await derStandardScraper.start(scraperOptions);

      res.json({ success: true, message: "derStandard Scraper gestartet" });
    } catch (error) {
      res.status(500).json({ message: "Failed to start derStandard scraper" });
    }
  });

  app.post("/api/derstandard-scraper/stop", async (req, res) => {
    try {
      derStandardScraper.stop();
      res.json({ success: true, message: "derStandard Scraper gestoppt" });
    } catch (error) {
      res.status(500).json({ message: "Failed to stop derStandard scraper" });
    }
  });

  app.get("/api/derstandard-scraper/status", async (req, res) => {
    try {
      const status = derStandardScraper.getStatus();
      res.json(status);
    } catch (error) {
      res.status(500).json({ message: "Failed to get derStandard scraper status" });
    }
  });

  // ============== IMMOSCOUT SCRAPER ==============

  app.post("/api/immoscout-scraper/start", async (req, res) => {
    try {
      const { intervalMinutes = 30, maxPages = 3, categories = [] } = req.body;

      // Filter baseUrls by selected categories if provided
      let selectedCategories = categories.length > 0 ? categories : Object.keys(immoScoutScraper['baseUrls']);

      const scraperOptions = {
        intervalMinutes,
        maxPages,
        categories: selectedCategories,
        onLog: (message: string) => {
          console.log('[IMMOSCOUT-SCRAPER]', message);
          wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
              client.send(JSON.stringify({ type: 'scraperUpdate', message }));
            }
          });
        },
        onListingFound: async (listingData: any) => {
          try {
            // Check if listing already exists
            const existing = await storage.getListingByUrl(listingData.url);
            if (existing) {
              // Detect what changed
              const changeType = detectChangeType(
                { price: existing.price, title: existing.title, description: existing.description, area: existing.area, images: existing.images },
                { price: listingData.price, title: listingData.title, description: listingData.description, area: listingData.area, images: listingData.images }
              );

              console.log('[IMMOSCOUT-DB] Update (bereits vorhanden):', listingData.title.substring(0, 50), changeType ? `(${changeType})` : '');

              // Update scraped_at, price, images, and last_changed_at ONLY if something changed
              await storage.updateListingOnRescrape(listingData.url, {
                scraped_at: new Date(),
                last_changed_at: changeType ? new Date() : undefined, // Only update if changed
                last_change_type: changeType || undefined,
                price: listingData.price,
                title: listingData.title,
                description: listingData.description,
                area: listingData.area,
                images: listingData.images || []
              });

              // Track price changes for price drop detection
              if (existing.price !== listingData.price) {
                await trackPriceChange(existing.id,
                  { price: existing.price, area: existing.area, eur_per_m2: existing.eur_per_m2 },
                  { price: listingData.price, area: listingData.area, eur_per_m2: listingData.eur_per_m2 }
                );

                // Check for price drop email alert
                await checkAndSendAlerts({ ...existing, price: listingData.price }, 'update', existing.price);
              }

              console.log('[IMMOSCOUT-DB] ✓ Aktualisiert:', existing.id, changeType ? `(${changeType})` : '(keine Änderungen)');
              return;
            }

            // Price evaluation
            const priceEvaluation = await priceEvaluator.evaluateListing(
              Number(listingData.eur_per_m2 || 0),
              listingData.region
            );

            // Save to database
            const listing = await storage.createListing({
              ...listingData,
              price_evaluation: priceEvaluation,
              source: 'immoscout'
            });

            console.log('[IMMOSCOUT-DB] ✓ Neues Listing gespeichert:', listing.id);

            // Send email alerts for new listings (Gold Find, Top Listing)
            await checkAndSendAlerts(listing, 'new');

            // Broadcast new listing
            wss.clients.forEach(client => {
              if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({ type: 'newListing', listing }));
              }
            });
          } catch (error) {
            console.error('[IMMOSCOUT-DB] ✗ Fehler beim Speichern:', error);
          }
        },
        onPhoneFound: async ({ url, phone }: { url: string; phone: string }) => {
          try {
            const updated = await storage.updateDiscoveredLinkPhone(url, phone);
            wss.clients.forEach(client => {
              if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({ type: 'phoneFound', link: updated || { url, phone_number: phone } }));
              }
            });
          } catch (e) {
            console.error('updateDiscoveredLinkPhone error', e);
          }
        }
      };

      await immoScoutScraper.start(scraperOptions);

      res.json({ success: true, message: "ImmoScout Scraper gestartet" });
    } catch (error) {
      res.status(500).json({ message: "Failed to start ImmoScout scraper" });
    }
  });

  app.post("/api/immoscout-scraper/stop", async (req, res) => {
    try {
      immoScoutScraper.stop();
      res.json({ success: true, message: "ImmoScout Scraper gestoppt" });
    } catch (error) {
      res.status(500).json({ message: "Failed to stop ImmoScout scraper" });
    }
  });

  app.get("/api/immoscout-scraper/status", async (req, res) => {
    try {
      const status = immoScoutScraper.getStatus();
      res.json(status);
    } catch (error) {
      res.status(500).json({ message: "Failed to get ImmoScout scraper status" });
    }
  });

  // Combined status endpoint for all scrapers
  app.get("/api/scraper/status-all", async (req, res) => {
    try {
      const status247 = continuousScraper.getStatus();
      const statusNewest = newestScraper.getStatus();
      const statusDerStandard = derStandardScraper.getStatus();
      const statusImmoScout = immoScoutScraper.getStatus();

      res.json({
        scraper247: status247,
        scraperNewest: statusNewest,
        scraperDerStandard: statusDerStandard,
        scraperImmoScout: statusImmoScout
      });
    } catch (error) {
      res.status(500).json({ message: "Failed to get scraper status" });
    }
  });





  // Helpers to normalize UI inputs to willhaben slugs
  const normalizeCategory = (c: string) => {
    const s = c.toLowerCase();
    if (s.includes('eigentumswohn')) return 'eigentumswohnung';
    if (s.includes('grundst')) return 'grundstuecke';
    if (s.includes('haus')) return 'haus';
    return s.replace(/\s+/g, '-');
  };
  const normalizeRegion = (r: string) => {
    const s = r.toLowerCase();
    if (s.includes('wien')) return 'wien';
    if (s.includes('niederö') || s.includes('niederoe') || s.includes('niederoe') || s.includes('niederoester')) return 'niederoesterreich';
    if (s.includes('oberö') || s.includes('oberoe') || s.includes('oberoester')) return 'oberoesterreich';
    if (s.includes('salzburg')) return 'salzburg';
    if (s.includes('tirol')) return 'tirol';
    if (s.includes('vorarlberg')) return 'vorarlberg';
    if (s.includes('kärnten') || s.includes('kaernten')) return 'kaernten';
    if (s.includes('steiermark')) return 'steiermark';
    if (s.includes('burgenland')) return 'burgenland';
    return s.replace(/\s+/g, '-');
  };
  const normalizeInputs = (rawCategories: string[], rawRegions: string[]) => {
    const catSet = new Set<string>();
    const regSet = new Set<string>(rawRegions.map(normalizeRegion));
    for (const raw of rawCategories) {
      const s = raw.toLowerCase();
      if (s.includes('-wien') || s.includes('-nö') || s.includes('-noe') || s.includes('-niederoe') || s.includes('-niederoester')) {
        const parts = s.split('-');
        // try to extract region suffix from the end
        const maybeRegion = parts.slice(-1)[0];
        const region = normalizeRegion(maybeRegion);
        if (region) regSet.add(region);
        const cat = normalizeCategory(parts[0]);
        catSet.add(cat);
      } else {
        catSet.add(normalizeCategory(s));
      }
    }
    // default regions if empty
    if (regSet.size === 0) {
      regSet.add('wien');
      regSet.add('niederoesterreich');
    }
    return { categories: Array.from(catSet), regions: Array.from(regSet) };
  };

  // Authentication routes with real tracking
  app.get("/api/auth/user", async (req, res) => {
    try {
      const sessionId = req.headers['x-session-id'];

      if (!sessionId) {
        res.json(null);
        return;
      }

      // Validate session exists and is active
      const [session] = await db
        .select()
        .from(user_sessions)
        .where(eq(user_sessions.id, parseInt(sessionId as string)));

      if (!session || session.logout_time) {
        res.json(null);
        return;
      }

      // Get user data
      const user = await storage.getUser(session.user_id);
      if (!user) {
        res.json(null);
        return;
      }

      res.json({
        id: user.id,
        username: user.username,
        is_admin: user.is_admin,
        sessionId: session.id
      });
    } catch (error) {
      console.error("Get user error:", error);
      res.status(500).json({ error: "Failed to get user" });
    }
  });

  app.post("/api/auth/login", async (req, res) => {
    try {
      const { username, password } = req.body;
      const user = await storage.getUserByUsername(username);

      // Compare password using bcrypt
      if (user && await bcrypt.compare(password, user.password)) {
        // Check if user is approved (Admins sind immer approved)
        if (!user.is_approved && !user.is_admin) {
          res.status(403).json({ error: "Account wartet auf Freigabe durch Admin" });
          return;
        }

        // Create user session for tracking
        const userAgent = req.headers['user-agent'];
        const ipAddress = req.ip || req.connection.remoteAddress;
        const session = await storage.createUserSession(user.id, ipAddress, userAgent);

        // Update login statistics
        await storage.updateLoginStats(user.id);

        res.json({ success: true, user: { id: user.id, username: user.username, is_admin: user.is_admin }, sessionId: session.id });
      } else {
        res.status(401).json({ error: "Invalid credentials" });
      }
    } catch (error) {
      console.error("Login error:", error);
      res.status(500).json({ error: "Login failed" });
    }
  });

  app.post("/api/auth/register", async (req, res) => {
    try {
      const { username, password } = req.body;
      const existingUser = await storage.getUserByUsername(username);

      if (existingUser) {
        res.status(400).json({ error: "Username already exists" });
        return;
      }

      const user = await storage.createUser({ username, password });

      // Send email notification to admin (Resend)
      if (process.env.RESEND_API_KEY) {
        try {
          const resend = new Resend(process.env.RESEND_API_KEY);

          const emailResult = await resend.emails.send({
            from: 'Akquise System <onboarding@resend.dev>',
            to: 'admin@sira-group.at',
            subject: 'Neue Konto-Registrierung - Freigabe erforderlich',
            html: `
              <h2>Neue Konto-Registrierung</h2>
              <p>Ein neuer Benutzer hat sich registriert und wartet auf Freigabe:</p>
              <ul>
                <li><strong>Benutzername:</strong> ${username}</li>
                <li><strong>User ID:</strong> ${user.id}</li>
                <li><strong>Registriert am:</strong> ${new Date().toLocaleString('de-DE')}</li>
              </ul>
              <p>Bitte geben Sie diesen Benutzer frei, damit er Zugriff auf das System erhält.</p>
            `
          });

          console.log(`[REGISTRATION] ✅ Email notification sent to admin@sira-group.at for user: ${username}`, emailResult);
        } catch (emailError: any) {
          console.error('[REGISTRATION] ❌ Failed to send email notification:', emailError);
          console.error('[REGISTRATION] ❌ Error details:', emailError?.message, emailError?.statusCode, emailError?.error);
          // Don't fail registration if email fails
        }
      } else {
        console.log(`[REGISTRATION] ℹ️ New user registered: ${username} (ID: ${user.id}) - Email notification disabled (no Resend API key)`);
      }

      // Don't return user data or auto-login - require admin approval first
      res.json({
        success: true,
        message: "Registrierung erfolgreich! Ihr Account wartet auf Freigabe durch den Administrator.",
        requiresApproval: true
      });
    } catch (error) {
      console.error("Registration error:", error);
      res.status(500).json({ error: "Registration failed" });
    }
  });

  // Acquisition tracking routes
  app.post("/api/acquisitions", async (req, res) => {
    try {
      const acquisition = await storage.createAcquisition(req.body);
      res.json(acquisition);
    } catch (error: any) {
      console.error("Error creating acquisition:", error);
      // Check for unique constraint violation (PostgreSQL error code 23505)
      if (error.code === '23505' || error.message?.includes('duplicate')) {
        return res.status(409).json({ error: "Duplicate acquisition: You have already recorded this acquisition" });
      }
      res.status(500).json({ error: "Failed to create acquisition" });
    }
  });

  app.patch("/api/acquisitions/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const { status, notes } = req.body;
      await storage.updateAcquisitionStatus(parseInt(id), status, notes);
      res.json({ success: true });
    } catch (error) {
      console.error("Error updating acquisition:", error);
      res.status(500).json({ error: "Failed to update acquisition" });
    }
  });

  app.get("/api/acquisitions/stats", async (req, res) => {
    try {
      const userId = req.query.userId ? parseInt(req.query.userId as string) : undefined;
      const stats = await storage.getAcquisitionStats(userId);
      res.json(stats);
    } catch (error) {
      console.error("Error fetching acquisition stats:", error);
      res.status(500).json({ error: "Failed to fetch stats" });
    }
  });

  app.get("/api/acquisitions/user/:userId", async (req, res) => {
    try {
      const { userId } = req.params;
      const acquisitions = await storage.getAcquisitionsByUser(parseInt(userId));
      res.json(acquisitions);
    } catch (error) {
      console.error("Error fetching user acquisitions:", error);
      res.status(500).json({ error: "Failed to fetch acquisitions" });
    }
  });

  // Admin routes
  app.get("/api/admin/users-stats", async (req, res) => {
    try {
      const stats = await storage.getAllUsersWithStats();
      res.json(stats);
    } catch (error) {
      console.error("Error fetching users stats:", error);
      res.status(500).json({ error: "Failed to fetch users stats" });
    }
  });

  app.get("/api/admin/users", async (req, res) => {
    try {
      const allUsers = await db.select().from(users).orderBy(desc(users.created_at));
      res.json(allUsers);
    } catch (error) {
      console.error("Error fetching all users:", error);
      res.status(500).json({ error: "Failed to fetch users" });
    }
  });

  app.patch("/api/admin/users/:id/approve", async (req, res) => {
    try {
      const { id } = req.params;
      const { is_approved } = req.body;

      await db.update(users)
        .set({ is_approved })
        .where(eq(users.id, parseInt(id)));

      res.json({ success: true });
    } catch (error) {
      console.error("Error updating user approval:", error);
      res.status(500).json({ error: "Failed to update user approval" });
    }
  });

  app.post("/api/admin/users/:id/reset-password", async (req, res) => {
    try {
      const { id } = req.params;
      const { newPassword } = req.body;

      if (!newPassword || newPassword.length < 4) {
        res.status(400).json({ error: "Password must be at least 4 characters" });
        return;
      }

      const hashedPassword = await bcrypt.hash(newPassword, 12);

      await db.update(users)
        .set({ password: hashedPassword })
        .where(eq(users.id, parseInt(id)));

      console.log(`[ADMIN] Password reset for user ID ${id}`);
      res.json({ success: true });
    } catch (error) {
      console.error("Error resetting password:", error);
      res.status(500).json({ error: "Failed to reset password" });
    }
  });

  app.delete("/api/admin/users/:id", async (req, res) => {
    try {
      const { id } = req.params;
      await db.delete(users).where(eq(users.id, parseInt(id)));
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting user:", error);
      res.status(500).json({ error: "Failed to delete user" });
    }
  });

  app.post("/api/admin/clear-listings", async (req, res) => {
    try {
      await db.delete(listings);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to clear listings" });
    }
  });

  app.post("/api/admin/clear-discovered-links", async (req, res) => {
    try {
      await db.delete(discovered_links);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to clear discovered_links" });
    }
  });

  // REMOVED: Scraper V2 endpoint - use V3 at /api/scraper/start instead

  // ============== EMAIL SERVICE ENDPOINTS ==============

  // Check email service configuration status
  app.get("/api/email/status", async (req, res) => {
    try {
      const isConfigured = emailService.isConfigured();
      res.json({
        configured: isConfigured,
        sender: process.env.MS_GRAPH_SENDER_EMAIL ? '✓ Set' : '✗ Missing',
        recipients: process.env.ALERT_RECIPIENT_EMAILS ? '✓ Set' : '✗ Missing',
        tenantId: process.env.MS_GRAPH_TENANT_ID ? '✓ Set' : '✗ Missing',
        clientId: process.env.MS_GRAPH_CLIENT_ID ? '✓ Set' : '✗ Missing',
        clientSecret: process.env.MS_GRAPH_CLIENT_SECRET ? '✓ Set' : '✗ Missing',
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Send test email with real listing from database
  app.post("/api/email/test", async (req, res) => {
    try {
      if (!emailService.isConfigured()) {
        return res.status(400).json({
          success: false,
          error: "Email service not configured. Check environment variables.",
        });
      }

      // Get newest listing from database for testing
      const [newestListing] = await db
        .select()
        .from(listings)
        .where(sql`is_deleted = false`)
        .orderBy(desc(listings.first_seen_at))
        .limit(1);

      if (!newestListing) {
        return res.status(404).json({
          success: false,
          error: "Keine Listings in der Datenbank gefunden.",
        });
      }

      const { alertType = "gold_find" } = req.body;

      if (alertType === "gold_find") {
        await emailService.sendGoldFindAlert(newestListing);
      } else if (alertType === "price_drop") {
        // Simulate 15% price drop for testing
        const oldPrice = Math.round(newestListing.price * 1.15);
        await emailService.sendPriceDropAlert(newestListing, oldPrice, 15);
      } else if (alertType === "top_listing") {
        await emailService.sendTopListingAlert(newestListing);
      } else if (alertType === "newsletter") {
        // Send newsletter with top 5 listings
        const topListings = await newsletterScheduler.getTopListingsForNewsletter();
        if (topListings.length === 0) {
          return res.json({
            success: false,
            message: "Keine Listings für Newsletter gefunden.",
          });
        }
        await emailService.sendWeeklyNewsletter(topListings);
      }

      res.json({
        success: true,
        message: `Test-Email (${alertType}) wurde gesendet an ${process.env.ALERT_RECIPIENT_EMAILS}`,
        listing: {
          id: newestListing.id,
          title: newestListing.title?.substring(0, 50),
          price: newestListing.price,
          quality_score: newestListing.quality_score,
        },
      });
    } catch (error: any) {
      console.error("[EMAIL-TEST] Error:", error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  // ============== NEWSLETTER ENDPOINTS ==============

  // Get newsletter scheduler status
  app.get("/api/newsletter/status", async (req, res) => {
    try {
      const status = newsletterScheduler.getStatus();
      res.json(status);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Manually trigger newsletter (for testing)
  app.post("/api/newsletter/send", async (req, res) => {
    try {
      if (!emailService.isConfigured()) {
        return res.status(400).json({
          success: false,
          error: "Email service not configured.",
        });
      }

      const topListings = await newsletterScheduler.getTopListingsForNewsletter();

      if (topListings.length === 0) {
        return res.json({
          success: false,
          message: "Keine Listings für Newsletter gefunden (letzte 7 Tage).",
        });
      }

      await emailService.sendWeeklyNewsletter(topListings);

      res.json({
        success: true,
        message: `Newsletter mit ${topListings.length} Top-Objekten gesendet an ${process.env.ALERT_RECIPIENT_EMAILS}`,
        listings: topListings.map(l => ({
          id: l.id,
          title: l.title?.substring(0, 50),
          quality_score: l.quality_score,
        })),
      });
    } catch (error: any) {
      console.error("[NEWSLETTER] Manual send error:", error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  // Start the newsletter scheduler
  newsletterScheduler.start();

  return httpServer;
}
