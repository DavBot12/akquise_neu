import { storage } from '../storage';
import type { Listing, InsertPriceHistory } from '../../shared/schema';

/**
 * PRICE DROP TRACKER
 *
 * Detects price changes when listings are updated
 * Automatically tracks price history and identifies motivated sellers
 *
 * Key Features:
 * - Detects price drops & increases
 * - Stores full price history
 * - Updates listing with latest drop info (for quick UI display)
 * - Identifies desperate sellers (multiple drops, big drops)
 */

export interface PriceComparisonResult {
  hasChanged: boolean;
  oldPrice: number;
  newPrice: number;
  priceDrop: number; // negative = price dropped, positive = increased
  changePercentage: number;
  isSignificantDrop: boolean; // > 5% drop
  isMajorDrop: boolean; // > 10% drop
}

/**
 * Compare old and new listing to detect price changes
 */
export function detectPriceChange(
  oldListing: Pick<Listing, 'price' | 'area' | 'eur_per_m2'>,
  newListing: Pick<Listing, 'price' | 'area' | 'eur_per_m2'>
): PriceComparisonResult {
  const oldPrice = oldListing.price;
  const newPrice = newListing.price;

  const priceDrop = newPrice - oldPrice; // negative = drop
  const changePercentage = ((priceDrop / oldPrice) * 100);

  return {
    hasChanged: oldPrice !== newPrice,
    oldPrice,
    newPrice,
    priceDrop,
    changePercentage,
    isSignificantDrop: changePercentage <= -5, // ≤ -5%
    isMajorDrop: changePercentage <= -10, // ≤ -10%
  };
}

/**
 * Track price change in database
 * - Stores price history entry
 * - Updates listing with latest drop info
 */
export async function trackPriceChange(
  listingId: number,
  oldListing: Pick<Listing, 'price' | 'area' | 'eur_per_m2'>,
  newListing: Pick<Listing, 'price' | 'area' | 'eur_per_m2'>
): Promise<void> {
  const comparison = detectPriceChange(oldListing, newListing);

  if (!comparison.hasChanged) {
    return; // No price change
  }

  // Create price history entry
  const priceHistory: InsertPriceHistory = {
    listing_id: listingId,
    old_price: comparison.oldPrice,
    new_price: comparison.newPrice,
    price_change: comparison.priceDrop,
    change_percentage: comparison.changePercentage.toFixed(2),
    old_area: oldListing.area ? oldListing.area.toString() : null,
    new_area: newListing.area ? newListing.area.toString() : null,
    old_eur_per_m2: oldListing.eur_per_m2 ? oldListing.eur_per_m2.toString() : null,
    new_eur_per_m2: newListing.eur_per_m2 ? newListing.eur_per_m2.toString() : null,
  };

  await storage.createPriceHistory(priceHistory);

  // Update listing with latest price drop info (only if price DROPPED, not increased)
  if (comparison.priceDrop < 0) {
    const priceDropCount = await storage.getPriceDropCount(listingId);

    await storage.updateListingPriceDropInfo(listingId, {
      last_price_drop: comparison.priceDrop,
      last_price_drop_percentage: comparison.changePercentage.toFixed(2),
      last_price_drop_date: new Date(),
      total_price_drops: priceDropCount + 1,
    });

    console.log(
      `[PRICE-TRACKER] 💰 Price drop detected! Listing ${listingId}: ${comparison.oldPrice}€ → ${comparison.newPrice}€ (${comparison.changePercentage.toFixed(1)}%)`
    );
  } else {
    console.log(
      `[PRICE-TRACKER] ⬆️ Price increase detected! Listing ${listingId}: ${comparison.oldPrice}€ → ${comparison.newPrice}€ (+${comparison.changePercentage.toFixed(1)}%)`
    );
  }
}

/**
 * Get price history for a listing
 */
export async function getPriceHistory(listingId: number): Promise<any[]> {
  return storage.getPriceHistory(listingId);
}

/**
 * Get all listings with recent price drops (last 7 days)
 */
export async function getRecentPriceDrops(days: number = 7): Promise<Listing[]> {
  return storage.getListingsWithRecentPriceDrops(days);
}

/**
 * Analyze if seller is desperate (multiple drops or big single drop)
 */
export function isDesperateSeller(listing: Partial<Listing>): {
  isDesperate: boolean;
  reason: string;
  severity: 'low' | 'medium' | 'high';
} {
  const totalDrops = listing.total_price_drops || 0;
  const lastDropPercentage = listing.last_price_drop_percentage
    ? parseFloat(listing.last_price_drop_percentage.toString())
    : 0;

  // High severity: 3+ price drops OR single drop > 15%
  if (totalDrops >= 3 || lastDropPercentage <= -15) {
    return {
      isDesperate: true,
      reason: totalDrops >= 3 ? `${totalDrops} Preissenkungen` : `${Math.abs(lastDropPercentage).toFixed(0)}% Preissenkung`,
      severity: 'high',
    };
  }

  // Medium severity: 2 price drops OR single drop 10-15%
  if (totalDrops === 2 || (lastDropPercentage <= -10 && lastDropPercentage > -15)) {
    return {
      isDesperate: true,
      reason: totalDrops === 2 ? '2 Preissenkungen' : `${Math.abs(lastDropPercentage).toFixed(0)}% Preissenkung`,
      severity: 'medium',
    };
  }

  // Low severity: 1 price drop 5-10%
  if (totalDrops === 1 && lastDropPercentage <= -5) {
    return {
      isDesperate: true,
      reason: `${Math.abs(lastDropPercentage).toFixed(0)}% Preissenkung`,
      severity: 'low',
    };
  }

  return {
    isDesperate: false,
    reason: '',
    severity: 'low',
  };
}
