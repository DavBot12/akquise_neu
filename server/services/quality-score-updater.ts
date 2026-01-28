import { storage } from '../storage';
import { calculateQualityScore } from './quality-scorer';
import { mlScorer } from './quality-scorer-ml';

/**
 * Quality Score Updater Service
 *
 * Automatically re-calculates quality scores for all active listings
 * Runs daily to ensure scores reflect listing age and freshness
 * Uses ML-enhanced scoring when available, falls back to default
 */
export class QualityScoreUpdater {
  private intervalHandle: NodeJS.Timeout | null = null;
  private isRunning = false;

  /**
   * Update all active listings' quality scores
   */
  async updateAllScores(): Promise<void> {
    if (this.isRunning) {
      console.log('[QUALITY-UPDATER] Update already running, skipping...');
      return;
    }

    this.isRunning = true;
    const startTime = Date.now();

    try {
      console.log('[QUALITY-UPDATER] 🔄 Starting daily quality score update...');

      // Get ALL listings (including deleted and completed for correct historical data)
      // IMPORTANT: Pass limit: 0 to get ALL listings, not just the default 150!
      const listings = await storage.getListings({ limit: 0 });

      console.log(`[QUALITY-UPDATER] Found ${listings.length} listings to update`);

      let updated = 0;
      let errors = 0;

      for (const listing of listings) {
        try {
          // Re-calculate quality score (using ML if available, otherwise default)
          const qualityResult = await mlScorer.calculateScore(listing);

          // Update in database
          await storage.updateListingQualityScore(listing.id, {
            quality_score: qualityResult.total,
            quality_tier: qualityResult.tier,
            is_gold_find: qualityResult.isGoldFind,
          });

          updated++;
        } catch (error: any) {
          errors++;
          console.error(`[QUALITY-UPDATER] ❌ Error updating listing ${listing.id}:`, error.message);
        }
      }

      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      console.log(
        `[QUALITY-UPDATER] ✅ Update complete! Updated: ${updated}, Errors: ${errors}, Duration: ${duration}s`
      );
    } catch (error: any) {
      console.error('[QUALITY-UPDATER] ❌ Fatal error during update:', error);
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Start daily update schedule
   * Runs at 3:00 AM every day
   */
  startDailySchedule(): void {
    if (this.intervalHandle) {
      console.log('[QUALITY-UPDATER] Schedule already running');
      return;
    }

    console.log('[QUALITY-UPDATER] 📅 Starting daily quality score update schedule (3:00 AM)');

    // Calculate time until next 3:00 AM
    const now = new Date();
    const next3AM = new Date();
    next3AM.setHours(3, 0, 0, 0);

    // If 3 AM already passed today, schedule for tomorrow
    if (now > next3AM) {
      next3AM.setDate(next3AM.getDate() + 1);
    }

    const msUntilNext3AM = next3AM.getTime() - now.getTime();

    console.log(
      `[QUALITY-UPDATER] Next update scheduled for: ${next3AM.toLocaleString('de-DE')}`
    );

    // Schedule first update
    setTimeout(() => {
      this.updateAllScores();

      // Then run every 24 hours
      this.intervalHandle = setInterval(() => {
        this.updateAllScores();
      }, 24 * 60 * 60 * 1000); // 24 hours
    }, msUntilNext3AM);

    // Optional: Run once on startup for testing (comment out in production)
    // this.updateAllScores();
  }

  /**
   * Stop the daily schedule
   */
  stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
      console.log('[QUALITY-UPDATER] 🛑 Daily schedule stopped');
    }
  }
}
