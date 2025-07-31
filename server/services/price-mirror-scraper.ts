import axios from 'axios';
import { db } from '../db';
import { price_mirror_data } from '@shared/schema';
import { sql } from 'drizzle-orm';

export class PriceMirrorScraperService {
  private isRunning = false;

  async startDailyPriceMirrorScrape(): Promise<void> {
    if (this.isRunning) {
      console.log("Preisspiegel-Scraper läuft bereits");
      return;
    }

    this.isRunning = true;
    console.log("🏠 PREISSPIEGEL-SCRAPER GESTARTET - Täglich um 3:00 Uhr");

    try {
      const categories = [
        'eigentumswohnung',
        'haus',
        'grundstuecke'
      ];

      const regions = [
        'wien',
        'niederoesterreich',
        'oberoesterreich',
        'salzburg',
        'tirol',
        'vorarlberg',
        'kaernten',
        'steiermark',
        'burgenland'
      ];

      for (const category of categories) {
        for (const region of regions) {
          await this.scrapePriceMirrorData(category, region);
          // 3 Sekunden Pause zwischen Requests
          await new Promise(resolve => setTimeout(resolve, 3000));
        }
      }

      console.log("✅ PREISSPIEGEL-SCRAPER ERFOLGREICH ABGESCHLOSSEN");
    } catch (error) {
      console.error("❌ PREISSPIEGEL-SCRAPER FEHLER:", error);
    } finally {
      this.isRunning = false;
    }
  }

  private async scrapePriceMirrorData(category: string, region: string): Promise<void> {
    try {
      // Willhaben URL ohne PRIVAT Filter für Marktdaten
      const baseUrl = `https://www.willhaben.at/iad/immobilien/${category}/${region}`;
      const params = new URLSearchParams({
        'rows': '100',
        'page': '1'
      });

      const url = `${baseUrl}?${params}`;
      console.log(`📊 PREISSPIEGEL: Scraping ${category} in ${region}`);

      const response = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'de-AT,de;q=0.9,en;q=0.8',
          'Accept-Encoding': 'gzip, deflate, br',
          'Connection': 'keep-alive',
          'Upgrade-Insecure-Requests': '1'
        },
        timeout: 15000
      });

      // Extrahiere Preise aus HTML
      const prices = this.extractPricesFromHTML(response.data);
      const areas = this.extractAreasFromHTML(response.data);

      if (prices.length > 0) {
        // Berechne Durchschnittspreis
        const validPrices = prices.filter(p => p > 0 && p < 10000000); // Filter unrealistische Preise
        const validAreas = areas.filter(a => a > 0 && a < 1000); // Filter unrealistische Flächen
        
        if (validPrices.length > 0) {
          const avgPrice = Math.round(validPrices.reduce((sum, p) => sum + p, 0) / validPrices.length);
          const avgArea = validAreas.length > 0 ? Math.round(validAreas.reduce((sum, a) => sum + a, 0) / validAreas.length) : null;
          const pricePerSqm = avgArea ? Math.round(avgPrice / avgArea) : null;

          // Speichere in price_mirror_data Tabelle
          await this.savePriceMirrorData({
            category,
            region,
            average_price: avgPrice,
            average_area: avgArea,
            price_per_sqm: pricePerSqm,
            sample_size: validPrices.length,
            scraped_at: new Date()
          });

          console.log(`💰 ${category}/${region}: €${avgPrice.toLocaleString()} (${validPrices.length} Objekte)`);
        }
      }

    } catch (error) {
      console.error(`❌ Fehler beim Scraping ${category}/${region}:`, error);
    }
  }

  private extractPricesFromHTML(html: string): number[] {
    const prices: number[] = [];
    
    // Verschiedene Preispatterns für Willhaben
    const pricePatterns = [
      /€\s*([\d,.]+)/g,
      /(\d{1,3}(?:[.,]\d{3})*)\s*€/g,
      /preis[^>]*>.*?€\s*([\d,.]+)/gi,
      /data-price[^>]*>([\d,.]+)/gi
    ];

    pricePatterns.forEach(pattern => {
      let match;
      while ((match = pattern.exec(html)) !== null) {
        const priceStr = match[1].replace(/[.,]/g, '');
        const price = parseInt(priceStr);
        if (price > 10000 && price < 10000000) { // Realistischer Preisbereich
          prices.push(price);
        }
      }
    });

    return Array.from(new Set(prices)); // Entferne Duplikate
  }

  private extractAreasFromHTML(html: string): number[] {
    const areas: number[] = [];
    
    // Flächenpatterns
    const areaPatterns = [
      /(\d+(?:[.,]\d+)?)\s*m²/g,
      /(\d+(?:[.,]\d+)?)\s*qm/gi,
      /fläche[^>]*>.*?(\d+(?:[.,]\d+)?)\s*m²/gi
    ];

    areaPatterns.forEach(pattern => {
      let match;
      while ((match = pattern.exec(html)) !== null) {
        const areaStr = match[1].replace(',', '.');
        const area = parseFloat(areaStr);
        if (area > 10 && area < 1000) { // Realistischer Flächenbereich
          areas.push(area);
        }
      }
    });

    return Array.from(new Set(areas)); // Entferne Duplikate
  }

  private async savePriceMirrorData(data: any): Promise<void> {
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

  // Täglicher Cron-Job um 3:00 Uhr
  startDailySchedule(): void {
    const scheduleDaily = () => {
      const now = new Date();
      const targetTime = new Date();
      targetTime.setHours(3, 0, 0, 0); // 3:00 Uhr

      if (now > targetTime) {
        targetTime.setDate(targetTime.getDate() + 1); // Nächster Tag
      }

      const timeUntilTarget = targetTime.getTime() - now.getTime();
      
      setTimeout(async () => {
        await this.startDailyPriceMirrorScrape();
        scheduleDaily(); // Plane nächsten Tag
      }, timeUntilTarget);

      console.log(`⏰ Nächster Preisspiegel-Scrape um ${targetTime.toLocaleString()}`);
    };

    scheduleDaily();
  }

  getStatus(): { isRunning: boolean } {
    return { isRunning: this.isRunning };
  }
}