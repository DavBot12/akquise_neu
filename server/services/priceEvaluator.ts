import { storage } from '../storage';

export class PriceEvaluator {
  private regionalAverages: { [key: string]: number } = {};
  private lastUpdate: Date = new Date(0);

  async evaluateListing(eurPerM2: number, region: string): Promise<'unter_schnitt' | 'im_schnitt' | 'ueber_schnitt'> {
    await this.updateRegionalAverages();
    
    const average = this.regionalAverages[region];
    if (!average || average === 0) {
      return 'im_schnitt'; // Default if no data
    }

    const ratio = eurPerM2 / average;
    
    if (ratio < 0.9) {
      return 'unter_schnitt';
    } else if (ratio > 1.1) {
      return 'ueber_schnitt';
    } else {
      return 'im_schnitt';
    }
  }

  private async updateRegionalAverages(): Promise<void> {
    // Update averages every hour
    const now = new Date();
    if (now.getTime() - this.lastUpdate.getTime() < 3600000) {
      return;
    }

    try {
      this.regionalAverages = await storage.getRegionalAverages();
      this.lastUpdate = now;
    } catch (error) {
      console.error('Failed to update regional averages:', error);
    }
  }

  getRegionalAverages(): { [key: string]: number } {
    return { ...this.regionalAverages };
  }
}
