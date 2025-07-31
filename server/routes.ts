import type { Express } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import axios from "axios";
import { storage } from "./storage";
import { insertListingSchema, insertContactSchema, insertListingContactSchema } from "@shared/schema";
import { ScraperService } from "./services/scraper";

import { PriceEvaluator } from "./services/priceEvaluator";

export async function registerRoutes(app: Express): Promise<Server> {
  const scraperService = new ScraperService();
  const priceEvaluator = new PriceEvaluator();
  // Import remaining scraper services
  const { StealthScraperService } = await import('./services/scraper-stealth');
  const { ContinuousScraper247Service } = await import('./services/scraper-24-7');
  const { PriceMirrorScraperService } = await import('./services/price-mirror-scraper');
  const stealthScraperService = new StealthScraperService();
  const continuousScraper = new ContinuousScraper247Service();
  const priceMirrorService = new PriceMirrorScraperService();

  // Listings routes
  app.get("/api/listings", async (req, res) => {
    try {
      const { region, price_evaluation, akquise_erledigt } = req.query;
      const filters: any = {};
      
      if (region && region !== "Alle Regionen") filters.region = region;
      if (price_evaluation && price_evaluation !== "Alle Preise") {
        const mapping: { [key: string]: string } = {
          "Unter dem Schnitt": "unter_schnitt",
          "Im Schnitt": "im_schnitt", 
          "Über dem Schnitt": "ueber_schnitt"
        };
        filters.price_evaluation = mapping[price_evaluation as string];
      }
      if (akquise_erledigt !== undefined) filters.akquise_erledigt = akquise_erledigt === "true";

      const listings = await storage.getListings(filters);
      res.json(listings);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch listings" });
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

  app.patch("/api/listings/:id/akquise", async (req, res) => {
    try {
      const { id } = req.params;
      const { akquise_erledigt } = req.body;
      await storage.updateListingAkquiseStatus(parseInt(id), akquise_erledigt);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Failed to update listing status" });
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

  // Price mirror scraper routes
  app.post("/api/scraper/price-mirror", async (req, res) => {
    try {
      console.log("🚀 PRICE MIRROR SCRAPER API TRIGGERED");
      
      // Start daily price mirror scraping with detailed logging
      priceMirrorService.startDailyPriceMirrorScrape()
        .then(() => {
          console.log("✅ PRICE MIRROR SCRAPER COMPLETED SUCCESSFULLY");
        })
        .catch((error: any) => {
          console.error("❌ PRICE MIRROR SCRAPER FAILED:", error);
        });
      
      res.json({ success: true, message: "Preisspiegel-Scraper gestartet" });
    } catch (error: any) {
      console.error("❌ Price mirror scraper API error:", error);
      res.status(500).json({ error: "Failed to start price mirror scraper", details: error.message });
    }
  });

  app.get("/api/price-mirror-data", async (req, res) => {
    try {
      console.log("📊 FETCHING PRICE MIRROR DATA");
      const data = await storage.getPriceMirrorData();
      console.log(`📈 FOUND ${data.length} PRICE MIRROR RECORDS`);
      res.json(data);
    } catch (error: any) {
      console.error("❌ Price mirror data error:", error);
      res.status(500).json({ error: "Failed to fetch price mirror data", details: error.message });
    }
  });

  // Scraper routes
  app.post("/api/scraper/start", async (req, res) => {
    try {
      const { categories = [], maxPages = 10, delay = 1000 } = req.body;
      
      // Broadcast scraping started
      wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify({ type: 'scraperStatus', status: 'Läuft' }));
        }
      });

      // Try Playwright scraper first, fallback to HTTP scraper
      const scraperOptions = {
        categories,
        maxPages,
        delay,
        onProgress: (message: string) => {
          console.log(`[SCRAPER] ${message}`);
          
          // Broadcast to WebSocket clients mit besseren Updates
          wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
              client.send(JSON.stringify({ 
                type: 'log', 
                message, 
                timestamp: new Date().toISOString() 
              }));
            }
          });
        },
        onListingFound: async (listingData: any) => {
          try {
            // Evaluate price
            const priceEvaluation = await priceEvaluator.evaluateListing(
              listingData.eur_per_m2,
              listingData.region
            );
            
            // Save to database
            const listing = await storage.createListing({
              ...listingData,
              price_evaluation: priceEvaluation
            });
            
            // Broadcast new listing UND aktuelle Statistiken
            wss.clients.forEach(client => {
              if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({ type: 'newListing', listing }));
                
                // Auch sofort aktuelle Statistiken senden
                storage.getListings({}).then(allListings => {
                  const stats = {
                    activeListings: allListings.filter(l => !l.akquise_erledigt).length,
                    completedListings: allListings.filter(l => l.akquise_erledigt).length,
                    totalListings: allListings.length,
                    newListings: allListings.filter(l => {
                      const today = new Date();
                      const listingDate = new Date(l.scraped_at);
                      return listingDate.toDateString() === today.toDateString();
                    }).length
                  };
                  
                  client.send(JSON.stringify({ 
                    type: 'statsUpdate', 
                    stats 
                  }));
                }).catch(err => console.error('Stats update error:', err));
              }
            });
          } catch (error) {
            console.error('Error saving listing:', error);
          }
        }
      };

      // STEALTH DOPPELMARKLER-SCANNER: Advanced Session Management
      scraperOptions.onProgress('🥷 STEALTH DOPPELMARKLER-SCANNER aktiviert - Session-basiert!');
      
      // Sequenziell für jeden Kategorie den STEALTH Scan durchführen
      for (const category of categories) {
        try {
          await stealthScraperService.stealthDoppelmarklerScan({
            category,
            maxPages,
            delay: Math.max(delay, 2000), // Optimiert: Nur 2 Sekunden nach Test
            onProgress: (message) => {
              console.log(message);
              wss.clients.forEach(client => {
                if (client.readyState === WebSocket.OPEN) {
                  client.send(JSON.stringify({ type: 'scraperUpdate', message }));
                }
              });
            }
          });
          
          scraperOptions.onProgress(`✅ STEALTH-COMPLETE ${category}: Session erfolgreich!`);
        } catch (error) {
          console.error(`STEALTH Error ${category}:`, error);
          scraperOptions.onProgress(`❌ STEALTH-ERROR ${category}: ${error}`);
        }
      }
      
      scraperOptions.onProgress('🏆 STEALTH SCAN KOMPLETT - Session-Management erfolgreich!');

      res.json({ success: true, message: "Neuer V2 Scraper gestartet" });
    } catch (error) {
      res.status(500).json({ message: "Failed to start scraping" });
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
            
            // Broadcast new listing
            wss.clients.forEach(client => {
              if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({ type: 'newListing', listing }));
              }
            });
          } catch (error) {
            console.error('Error saving 24/7 listing:', error);
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
      continuousScraper.stop247Scraping();
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

  const httpServer = createServer(app);

  // WebSocket server for real-time updates
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  wss.on('connection', (ws) => {
    console.log('WebSocket client connected');
    
    ws.on('close', () => {
      console.log('WebSocket client disconnected');
    });

    // Send initial connection confirmation
    ws.send(JSON.stringify({ type: 'connected', message: 'WebSocket connected' }));
  });



  // Authentication routes with real tracking
  app.get("/api/auth/user", async (req, res) => {
    try {
      // For now, return null if no session exists
      // This will be enhanced with proper session management later
      res.json(null);
    } catch (error) {
      console.error("Get user error:", error);
      res.status(500).json({ error: "Failed to get user" });
    }
  });

  app.post("/api/auth/login", async (req, res) => {
    try {
      const { username, password } = req.body;
      const user = await storage.getUserByUsername(username);
      
      if (user && user.password === password) {
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
      res.json({ success: true, user: { id: user.id, username: user.username, is_admin: user.is_admin } });
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
    } catch (error) {
      console.error("Error creating acquisition:", error);
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

  return httpServer;
}
