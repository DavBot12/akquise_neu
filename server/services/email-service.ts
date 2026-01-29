/**
 * EMAIL SERVICE - Microsoft 365 Graph API
 *
 * Sends email alerts for:
 * - 🏆 Gold Find: Old listing with fresh update (motivated seller)
 * - 📉 Price Drop: Significant price reduction (>10%)
 * - ⭐ Top Listings: New listings with excellent quality score
 * - 📊 Weekly Newsletter: Top 5 listings of the week
 *
 * Setup:
 * 1. Create Azure AD App Registration
 * 2. Add Mail.Send permission (Application)
 * 3. Grant admin consent
 * 4. Set environment variables:
 *    - MS_GRAPH_TENANT_ID
 *    - MS_GRAPH_CLIENT_ID
 *    - MS_GRAPH_CLIENT_SECRET
 *    - MS_GRAPH_SENDER_EMAIL (the mailbox to send from)
 *    - ALERT_RECIPIENT_EMAILS (comma-separated)
 *    - PORTAL_BASE_URL (optional, defaults to localhost)
 */

import type { Listing } from '../../shared/schema';

interface GraphTokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
}

// SIRA CI Colors
const SIRA_COLORS = {
  headerBg: '#0f172a',        // Dark navy (like Pipeline Report)
  headerText: '#ffffff',
  accentBlue: '#3b82f6',      // Bright blue
  accentGreen: '#22c55e',     // Success green
  accentGold: '#f59e0b',      // Gold/amber
  textPrimary: '#1e293b',
  textSecondary: '#64748b',
  borderLight: '#e2e8f0',
  cardBg: '#ffffff',
  bodyBg: '#f8fafc',
};

class EmailService {
  private accessToken: string | null = null;
  private tokenExpiry: Date | null = null;

  private get tenantId(): string {
    return process.env.MS_GRAPH_TENANT_ID || '';
  }

  private get clientId(): string {
    return process.env.MS_GRAPH_CLIENT_ID || '';
  }

  private get clientSecret(): string {
    return process.env.MS_GRAPH_CLIENT_SECRET || '';
  }

  private get senderEmail(): string {
    return process.env.MS_GRAPH_SENDER_EMAIL || '';
  }

  private get recipientEmails(): string[] {
    const emails = process.env.ALERT_RECIPIENT_EMAILS || '';
    return emails.split(',').map(e => e.trim()).filter(e => e.length > 0);
  }

  private get portalBaseUrl(): string {
    return process.env.PORTAL_BASE_URL || 'https://akquise.sira-group.at';
  }

  /**
   * Get portal URL for a listing
   */
  private getPortalUrl(listingId?: number): string {
    if (listingId) {
      return `${this.portalBaseUrl}/?listing=${listingId}`;
    }
    return this.portalBaseUrl;
  }

  /**
   * Check if email service is configured
   */
  isConfigured(): boolean {
    return !!(
      this.tenantId &&
      this.clientId &&
      this.clientSecret &&
      this.senderEmail &&
      this.recipientEmails.length > 0
    );
  }

  /**
   * Get access token using client credentials flow
   */
  private async getAccessToken(): Promise<string> {
    if (this.accessToken && this.tokenExpiry && new Date() < this.tokenExpiry) {
      return this.accessToken;
    }

    const tokenUrl = `https://login.microsoftonline.com/${this.tenantId}/oauth2/v2.0/token`;

    const params = new URLSearchParams({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
    });

    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to get access token: ${error}`);
    }

    const data: GraphTokenResponse = await response.json();

    this.accessToken = data.access_token;
    this.tokenExpiry = new Date(Date.now() + (data.expires_in - 300) * 1000);

    return this.accessToken;
  }

  /**
   * Send email via Microsoft Graph API
   */
  private async sendEmail(subject: string, htmlBody: string): Promise<void> {
    if (!this.isConfigured()) {
      console.log('[EMAIL] Service not configured - skipping email');
      return;
    }

    const token = await this.getAccessToken();
    const graphUrl = `https://graph.microsoft.com/v1.0/users/${this.senderEmail}/sendMail`;

    const emailPayload = {
      message: {
        subject,
        body: {
          contentType: 'HTML',
          content: htmlBody,
        },
        toRecipients: this.recipientEmails.map(email => ({
          emailAddress: { address: email },
        })),
      },
      saveToSentItems: true,
    };

    const response = await fetch(graphUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(emailPayload),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to send email: ${error}`);
    }

    console.log(`[EMAIL] ✅ Sent: ${subject}`);
  }

  /**
   * Format price in Euro
   */
  private formatPrice(price: number): string {
    return new Intl.NumberFormat('de-AT', {
      style: 'currency',
      currency: 'EUR',
      maximumFractionDigits: 0,
    }).format(price);
  }

  /**
   * Base email wrapper with SIRA CI
   */
  private wrapEmail(title: string, subtitle: string, content: string): string {
    return `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; background: ${SIRA_COLORS.bodyBg};">
        <!-- Header -->
        <div style="background: ${SIRA_COLORS.headerBg}; padding: 32px 24px; border-radius: 8px 8px 0 0;">
          <h1 style="color: ${SIRA_COLORS.headerText}; margin: 0; font-size: 24px; font-weight: 700; letter-spacing: 0.5px; text-transform: uppercase;">
            ${title}
          </h1>
          <p style="color: #94a3b8; margin: 8px 0 0 0; font-size: 14px;">${subtitle}</p>
        </div>

        <!-- Content -->
        <div style="background: ${SIRA_COLORS.cardBg}; padding: 24px; border: 1px solid ${SIRA_COLORS.borderLight}; border-top: none;">
          ${content}
        </div>

        <!-- Footer -->
        <div style="background: ${SIRA_COLORS.headerBg}; padding: 16px 24px; border-radius: 0 0 8px 8px;">
          <p style="color: #64748b; margin: 0; font-size: 12px;">
            SIRA Akquise Tool • Automatische Benachrichtigung
          </p>
        </div>
      </div>
    `;
  }

  /**
   * Create a metric card (like Pipeline Report KPIs)
   */
  private metricCard(label: string, value: string, subtext?: string, highlight?: boolean): string {
    return `
      <div style="background: ${SIRA_COLORS.cardBg}; border: 1px solid ${SIRA_COLORS.borderLight}; border-radius: 8px; padding: 20px; margin-bottom: 12px;">
        <p style="color: ${SIRA_COLORS.textSecondary}; margin: 0 0 4px 0; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600;">
          ${label}
        </p>
        <p style="color: ${highlight ? SIRA_COLORS.accentBlue : SIRA_COLORS.textPrimary}; margin: 0; font-size: 28px; font-weight: 700;">
          ${value}
        </p>
        ${subtext ? `<p style="color: ${SIRA_COLORS.accentGreen}; margin: 4px 0 0 0; font-size: 13px;">${subtext}</p>` : ''}
      </div>
    `;
  }

  /**
   * Create a listing row
   */
  private listingRow(listing: Partial<Listing>, showRank?: number): string {
    const portalUrl = this.getPortalUrl(listing.id);

    return `
      <div style="background: ${SIRA_COLORS.cardBg}; border: 1px solid ${SIRA_COLORS.borderLight}; border-radius: 8px; padding: 16px; margin-bottom: 12px;">
        <div style="display: flex; align-items: flex-start;">
          ${showRank ? `
            <div style="background: ${SIRA_COLORS.headerBg}; color: white; width: 32px; height: 32px; border-radius: 6px; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 14px; margin-right: 12px; flex-shrink: 0;">
              ${showRank}
            </div>
          ` : ''}
          <div style="flex: 1; min-width: 0;">
            <p style="color: ${SIRA_COLORS.textPrimary}; margin: 0 0 8px 0; font-size: 15px; font-weight: 600; line-height: 1.3;">
              ${listing.title?.substring(0, 70)}${(listing.title?.length || 0) > 70 ? '...' : ''}
            </p>
            <div style="margin-bottom: 8px;">
              <span style="color: ${SIRA_COLORS.accentBlue}; font-size: 18px; font-weight: 700;">${this.formatPrice(listing.price || 0)}</span>
              <span style="color: ${SIRA_COLORS.textSecondary}; font-size: 13px; margin-left: 8px;">${listing.area || '–'} m²</span>
              ${listing.quality_score ? `<span style="background: ${this.getScoreColor(listing.quality_score)}; color: white; padding: 2px 8px; border-radius: 4px; font-size: 12px; font-weight: 600; margin-left: 8px;">Score ${listing.quality_score}</span>` : ''}
            </div>
            <p style="color: ${SIRA_COLORS.textSecondary}; margin: 0 0 12px 0; font-size: 13px;">
              📍 ${listing.location || 'Standort nicht angegeben'}
            </p>
            <a href="${portalUrl}" style="display: inline-block; background: ${SIRA_COLORS.headerBg}; color: white; padding: 10px 20px; text-decoration: none; border-radius: 6px; font-size: 13px; font-weight: 600;">
              Im Portal öffnen →
            </a>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Send Gold Find Alert
   */
  async sendGoldFindAlert(listing: Partial<Listing>): Promise<void> {
    const subject = `Gold Find: ${listing.title?.substring(0, 50)}`;

    const content = `
      <div style="text-align: center; margin-bottom: 24px;">
        <div style="background: linear-gradient(135deg, #fbbf24, #f59e0b); width: 64px; height: 64px; border-radius: 50%; margin: 0 auto 16px; display: flex; align-items: center; justify-content: center;">
          <span style="font-size: 32px;">🏆</span>
        </div>
        <p style="color: ${SIRA_COLORS.textSecondary}; margin: 0; font-size: 14px;">
          Altes Inserat mit frischem Update – motivierter Verkäufer!
        </p>
      </div>

      ${this.metricCard('Preis', this.formatPrice(listing.price || 0), undefined, true)}

      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 16px;">
        ${this.metricCard('Fläche', `${listing.area || '–'} m²`)}
        ${this.metricCard('€/m²', listing.eur_per_m2 ? this.formatPrice(Number(listing.eur_per_m2)) : '–')}
      </div>

      ${this.metricCard('Standort', listing.location || 'Nicht angegeben')}

      ${listing.phone_number ? this.metricCard('Telefon', listing.phone_number) : ''}

      <div style="margin-top: 24px; text-align: center;">
        <a href="${this.getPortalUrl(listing.id)}" style="display: inline-block; background: ${SIRA_COLORS.headerBg}; color: white; padding: 14px 32px; text-decoration: none; border-radius: 8px; font-size: 15px; font-weight: 600;">
          Im Portal öffnen →
        </a>
      </div>
    `;

    await this.sendEmail(subject, this.wrapEmail('GOLD FIND', 'Neues Top-Objekt entdeckt', content));
  }

  /**
   * Send Price Drop Alert
   */
  async sendPriceDropAlert(
    listing: Partial<Listing>,
    oldPrice: number,
    dropPercentage: number
  ): Promise<void> {
    const subject = `Preissenkung ${Math.round(dropPercentage)}%: ${listing.title?.substring(0, 40)}`;
    const savings = oldPrice - (listing.price || 0);

    const content = `
      <div style="text-align: center; margin-bottom: 24px;">
        <div style="background: linear-gradient(135deg, #22c55e, #16a34a); width: 64px; height: 64px; border-radius: 50%; margin: 0 auto 16px; display: flex; align-items: center; justify-content: center;">
          <span style="font-size: 32px;">📉</span>
        </div>
        <p style="color: ${SIRA_COLORS.textSecondary}; margin: 0; font-size: 14px;">
          Verkäufer hat den Preis gesenkt – jetzt zuschlagen!
        </p>
      </div>

      <!-- Price Change Card -->
      <div style="background: ${SIRA_COLORS.cardBg}; border: 2px solid ${SIRA_COLORS.accentGreen}; border-radius: 8px; padding: 24px; margin-bottom: 16px; text-align: center;">
        <div style="margin-bottom: 12px;">
          <span style="color: ${SIRA_COLORS.textSecondary}; text-decoration: line-through; font-size: 18px;">${this.formatPrice(oldPrice)}</span>
          <span style="color: ${SIRA_COLORS.textSecondary}; margin: 0 12px;">→</span>
          <span style="color: ${SIRA_COLORS.accentGreen}; font-size: 28px; font-weight: 700;">${this.formatPrice(listing.price || 0)}</span>
        </div>
        <div style="background: ${SIRA_COLORS.accentGreen}; color: white; display: inline-block; padding: 6px 16px; border-radius: 20px; font-weight: 600;">
          -${Math.round(dropPercentage)}% (${this.formatPrice(savings)} gespart)
        </div>
      </div>

      ${this.metricCard('Standort', listing.location || 'Nicht angegeben')}
      ${this.metricCard('Fläche', `${listing.area || '–'} m²`)}
      ${listing.phone_number ? this.metricCard('Telefon', listing.phone_number) : ''}

      <div style="margin-top: 24px; text-align: center;">
        <a href="${this.getPortalUrl(listing.id)}" style="display: inline-block; background: ${SIRA_COLORS.headerBg}; color: white; padding: 14px 32px; text-decoration: none; border-radius: 8px; font-size: 15px; font-weight: 600;">
          Im Portal öffnen →
        </a>
      </div>
    `;

    await this.sendEmail(subject, this.wrapEmail('PREISSENKUNG', `${Math.round(dropPercentage)}% günstiger`, content));
  }

  /**
   * Send Top Listing Alert (Quality Score >= 90)
   */
  async sendTopListingAlert(listing: Partial<Listing>): Promise<void> {
    const subject = `Top Listing (Score ${listing.quality_score}): ${listing.title?.substring(0, 40)}`;

    const content = `
      <div style="text-align: center; margin-bottom: 24px;">
        <div style="background: linear-gradient(135deg, #3b82f6, #2563eb); width: 64px; height: 64px; border-radius: 50%; margin: 0 auto 16px; display: flex; align-items: center; justify-content: center;">
          <span style="font-size: 32px;">⭐</span>
        </div>
        <p style="color: ${SIRA_COLORS.textSecondary}; margin: 0; font-size: 14px;">
          Hervorragendes Objekt mit Quality Score ${listing.quality_score}
        </p>
      </div>

      ${this.metricCard('Preis', this.formatPrice(listing.price || 0), undefined, true)}

      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 16px;">
        ${this.metricCard('Fläche', `${listing.area || '–'} m²`)}
        ${this.metricCard('Quality Score', `${listing.quality_score}`, listing.quality_tier || '')}
      </div>

      ${this.metricCard('Standort', listing.location || 'Nicht angegeben')}
      ${listing.phone_number ? this.metricCard('Telefon', listing.phone_number) : ''}

      <div style="margin-top: 24px; text-align: center;">
        <a href="${this.getPortalUrl(listing.id)}" style="display: inline-block; background: ${SIRA_COLORS.headerBg}; color: white; padding: 14px 32px; text-decoration: none; border-radius: 8px; font-size: 15px; font-weight: 600;">
          Im Portal öffnen →
        </a>
      </div>
    `;

    await this.sendEmail(subject, this.wrapEmail('TOP LISTING', 'Neues Premium-Objekt', content));
  }

  /**
   * Send Weekly Newsletter with Top 5 Listings
   */
  async sendWeeklyNewsletter(topListings: Partial<Listing>[]): Promise<void> {
    const now = new Date();
    const weekNumber = this.getWeekNumber(now);
    const subject = `Wöchentlicher Report KW${weekNumber}: Top 5 Objekte`;

    const listingRows = topListings.slice(0, 5).map((listing, index) =>
      this.listingRow(listing, index + 1)
    ).join('');

    const content = `
      <h2 style="color: ${SIRA_COLORS.textPrimary}; margin: 0 0 20px 0; font-size: 16px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">
        Top 5 Objekte dieser Woche
      </h2>

      ${listingRows || `<p style="color: ${SIRA_COLORS.textSecondary};">Keine neuen Top-Objekte diese Woche.</p>`}

      <div style="margin-top: 24px; padding-top: 20px; border-top: 1px solid ${SIRA_COLORS.borderLight}; text-align: center;">
        <a href="${this.portalBaseUrl}" style="display: inline-block; background: ${SIRA_COLORS.headerBg}; color: white; padding: 14px 32px; text-decoration: none; border-radius: 8px; font-size: 15px; font-weight: 600;">
          Alle Objekte im Portal ansehen →
        </a>
      </div>
    `;

    const dateStr = now.toLocaleDateString('de-AT', { day: '2-digit', month: 'long', year: 'numeric' });
    await this.sendEmail(subject, this.wrapEmail('WÖCHENTLICHER AKQUISE-REPORT', `Kalenderwoche ${weekNumber} • ${dateStr}`, content));
  }

  /**
   * Get week number of the year
   */
  private getWeekNumber(date: Date): number {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  }

  /**
   * Get color based on quality score
   */
  private getScoreColor(score: number): string {
    if (score >= 90) return SIRA_COLORS.accentGreen;
    if (score >= 70) return SIRA_COLORS.accentGold;
    if (score >= 50) return '#f97316';
    return '#ef4444';
  }
}

// Singleton instance
export const emailService = new EmailService();
