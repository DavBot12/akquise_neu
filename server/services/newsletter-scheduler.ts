/**
 * NEWSLETTER SCHEDULER
 *
 * Sends weekly newsletter with top 5 listings every Monday at 8:00 AM
 *
 * Schedule: Every Monday 08:00 Vienna time (Europe/Vienna)
 */

import { db } from '../db';
import { listings } from '../../shared/schema';
import { sql, desc } from 'drizzle-orm';
import { emailService } from './email-service';

class NewsletterScheduler {
  private intervalId: NodeJS.Timeout | null = null;
  private lastSentWeek: number = 0;

  /**
   * Get top 5 listings from the past 7 days, sorted by quality score
   */
  async getTopListingsForNewsletter(): Promise<any[]> {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const topListings = await db
      .select()
      .from(listings)
      .where(sql`
        is_deleted = false
        AND akquise_erledigt = false
        AND quality_score IS NOT NULL
        AND first_seen_at >= ${sevenDaysAgo.toISOString()}
      `)
      .orderBy(desc(listings.quality_score))
      .limit(5);

    return topListings;
  }

  /**
   * Send the weekly newsletter
   */
  async sendWeeklyNewsletter(): Promise<boolean> {
    try {
      if (!emailService.isConfigured()) {
        console.log('[NEWSLETTER] Email service not configured - skipping');
        return false;
      }

      const topListings = await this.getTopListingsForNewsletter();

      if (topListings.length === 0) {
        console.log('[NEWSLETTER] No listings found for newsletter - skipping');
        return false;
      }

      console.log(`[NEWSLETTER] Sending weekly newsletter with ${topListings.length} top listings...`);
      await emailService.sendWeeklyNewsletter(topListings);
      console.log('[NEWSLETTER] ✅ Weekly newsletter sent successfully!');

      return true;
    } catch (error) {
      console.error('[NEWSLETTER] Error sending newsletter:', error);
      return false;
    }
  }

  /**
   * Check if it's time to send the newsletter (Monday 8:00 AM Vienna time)
   */
  private shouldSendNewsletter(): boolean {
    const now = new Date();

    // Convert to Vienna time
    const viennaTime = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Vienna' }));

    const dayOfWeek = viennaTime.getDay(); // 0 = Sunday, 1 = Monday
    const hour = viennaTime.getHours();
    const currentWeek = this.getWeekNumber(viennaTime);

    // Send on Monday between 8:00-8:59 AM, but only once per week
    if (dayOfWeek === 1 && hour === 8 && currentWeek !== this.lastSentWeek) {
      this.lastSentWeek = currentWeek;
      return true;
    }

    return false;
  }

  /**
   * Get ISO week number
   */
  private getWeekNumber(date: Date): number {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  }

  /**
   * Start the scheduler - checks every hour if it's time to send
   */
  start(): void {
    if (this.intervalId) {
      console.log('[NEWSLETTER] Scheduler already running');
      return;
    }

    console.log('[NEWSLETTER] 📅 Weekly newsletter scheduler started');
    console.log('[NEWSLETTER] Schedule: Every Monday at 8:00 AM (Vienna time)');

    // Check every hour
    this.intervalId = setInterval(async () => {
      if (this.shouldSendNewsletter()) {
        await this.sendWeeklyNewsletter();
      }
    }, 60 * 60 * 1000); // Every hour

    // Also check immediately on startup (in case server restarts on Monday morning)
    setTimeout(async () => {
      if (this.shouldSendNewsletter()) {
        await this.sendWeeklyNewsletter();
      }
    }, 5000); // Wait 5 seconds after startup
  }

  /**
   * Stop the scheduler
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      console.log('[NEWSLETTER] Scheduler stopped');
    }
  }

  /**
   * Get scheduler status
   */
  getStatus(): { running: boolean; lastSentWeek: number; nextScheduled: string } {
    const now = new Date();
    const viennaTime = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Vienna' }));

    // Calculate next Monday 8:00 AM
    const nextMonday = new Date(viennaTime);
    nextMonday.setDate(nextMonday.getDate() + ((1 + 7 - nextMonday.getDay()) % 7 || 7));
    nextMonday.setHours(8, 0, 0, 0);

    return {
      running: this.intervalId !== null,
      lastSentWeek: this.lastSentWeek,
      nextScheduled: nextMonday.toLocaleString('de-AT', {
        weekday: 'long',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      }),
    };
  }
}

// Singleton instance
export const newsletterScheduler = new NewsletterScheduler();
