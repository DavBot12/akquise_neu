import type { Express } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { storage } from "./storage";
import { insertListingSchema, insertContactSchema, insertListingContactSchema } from "@shared/schema";
import { ScraperService } from "./services/scraper";
import { scraperV2Service } from "./services/scraper-v2";
import { scraperHttpService } from "./services/scraper-http";
import { PriceEvaluator } from "./services/priceEvaluator";

export async function registerRoutes(app: Express): Promise<Server> {
  const scraperService = new ScraperService();
  const priceEvaluator = new PriceEvaluator();

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

      // Try Playwright first, fallback to HTTP scraper
      try {
        await scraperV2Service.startScraping(scraperOptions);
      } catch (playwrightError) {
        scraperOptions.onProgress('[FALLBACK] Playwright fehlgeschlagen, nutze HTTP-Scraper...');
        console.log('Playwright failed, falling back to HTTP scraper:', playwrightError);
        await scraperHttpService.startScraping(scraperOptions);
      }

      res.json({ success: true, message: "Neuer V2 Scraper gestartet" });
    } catch (error) {
      res.status(500).json({ message: "Failed to start scraping" });
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

  return httpServer;
}
