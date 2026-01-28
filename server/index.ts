import 'dotenv/config';
import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { QualityScoreUpdater } from "./services/quality-score-updater";
import { fixLastChangedAt } from "./migrations/fix-last-changed-at";
// import { PriceMirrorScraperService } from "./services/price-mirror-scraper"; // DISABLED: Focus on scraper first

// Simple log function (extracted from vite.ts to avoid import issues in production)
function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
  console.log(`${formattedTime} [${source}] ${message}`);
}

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  // 🔧 RUN ONE-TIME MIGRATION: Fix last_changed_at for existing listings
  try {
    await fixLastChangedAt();
  } catch (error) {
    log('Warning: Migration failed (this is OK if already run)', 'migration');
  }

  const server = await registerRoutes(app);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    throw err;
  });

  // Only setup vite in development for local development
  // In production, frontend is served by separate Nginx container
  if (app.get("env") === "development") {
    try {
      const { setupVite } = await import("./vite.js");
      await setupVite(app, server);
    } catch (error) {
      log("Warning: Could not load vite module (expected in production)");
    }
  } else {
    // In production (Docker), backend only serves API
    // Frontend is served by separate Nginx container
    log("Production mode: Backend serving API only (Frontend in separate container)");
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || '5000', 10);
  server.listen({
    port,
    host: "0.0.0.0",
  }, () => {
    log(`serving on port ${port}`);

    // Start quality score updater (daily at 3:00 AM)
    const qualityUpdater = new QualityScoreUpdater();
    qualityUpdater.startDailySchedule();

    // DISABLED: Price mirror - will be improved later with per-district pricing
    // const priceMirrorService = new PriceMirrorScraperService();
    // priceMirrorService.startDailySchedule();
  });
})();
