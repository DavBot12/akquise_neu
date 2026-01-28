import type { Listing } from '@shared/schema';
import { isInAkquiseGebiet } from './geo-filter';

export interface QualityScoreResult {
  total: number;        // -20 to 160+ (can go negative without phone!)
  breakdown: {
    freshness: number;     // 0-30 base + up to 20 bonus
    completeness: number;  // -10 to 45 (phone penalty/bonus!)
    priceValue: number;    // 0-30
    location: number;      // -10 to +10 (Entfernung zu Wien)
    priceDropBonus: number; // 0-25 (Bonus für Preissenkungen)
  };
  tier: 'excellent' | 'good' | 'medium' | 'low';
  isGoldFind: boolean;
}

/**
 * Calculate quality score for a listing (-20 to 160+)
 *
 * Scoring breakdown:
 * - Freshness: 0-30 base + up to 20 Gold Find bonus = 0-50
 * - Completeness: -10 to 45 (PHONE: +10 if present, -10 if missing! Photos/Desc: 0-30, Details: 0-5)
 * - Price Value: 0-30 (price evaluation)
 * - Location: -10 to +10 (Entfernung zu Wien: <30 min = gut, >30 min = Abzug)
 * - Price Drop Bonus: 0-25 (Bonus für Preissenkungen - motivierter Verkäufer!)
 */
export function calculateQualityScore(listing: Partial<Listing>): QualityScoreResult {
  const freshnessScore = calculateFreshnessScore(listing);
  const completenessScore = calculateCompletenessScore(listing);
  const priceValueScore = calculatePriceValueScore(listing);
  const locationScore = calculateLocationScore(listing);
  const priceDropBonus = calculatePriceDropBonus(listing);

  const total = freshnessScore.points + completenessScore + priceValueScore + locationScore + priceDropBonus;
  const tier = getScoreTier(total);

  return {
    total,
    breakdown: {
      freshness: freshnessScore.points,
      completeness: completenessScore,
      priceValue: priceValueScore,
      location: locationScore,
      priceDropBonus: priceDropBonus,
    },
    tier,
    isGoldFind: freshnessScore.isGoldFind,
  };
}

/**
 * Freshness Score (0-30 base + up to 20 bonus)
 *
 * - last_changed_at: 0-20 points (how recently updated)
 * - published_at/first_seen_at: 0-10 points (how new the listing is)
 * - Gold Find Bonus: +20 points if old listing but fresh update
 */
function calculateFreshnessScore(listing: Partial<Listing>): { points: number; isGoldFind: boolean } {
  const now = new Date();
  let points = 0;
  let isGoldFind = false;

  // Last changed score (20 points max)
  if (listing.last_changed_at) {
    const lastChangedDate = new Date(listing.last_changed_at);
    const daysSinceChanged = Math.floor((now.getTime() - lastChangedDate.getTime()) / (1000 * 60 * 60 * 24));

    if (daysSinceChanged <= 1) {
      points += 20; // Today/Yesterday
    } else if (daysSinceChanged <= 7) {
      points += 15; // Last week
    } else if (daysSinceChanged <= 14) {
      points += 10; // Last 2 weeks
    } else if (daysSinceChanged <= 30) {
      points += 5;  // Last month
    }
    // else: 0 points for >30 days or null
  }

  // Published/First seen score (10 points max)
  const publishedOrFirstSeen = listing.published_at || listing.first_seen_at;
  if (publishedOrFirstSeen) {
    const publishedDate = new Date(publishedOrFirstSeen);
    const daysSincePublished = Math.floor((now.getTime() - publishedDate.getTime()) / (1000 * 60 * 60 * 24));

    if (daysSincePublished <= 7) {
      points += 10; // Brand new (0-7 days)
    } else if (daysSincePublished <= 14) {
      points += 7;  // Very recent (8-14 days)
    } else if (daysSincePublished <= 30) {
      points += 4;  // Recent (15-30 days)
    } else if (daysSincePublished <= 60) {
      points += 2;  // Moderate (31-60 days)
    }
    // else: 0 points for >60 days
  }

  // 🏆 GOLD FIND BONUS (+20 points)
  // Old listing (>30 days) BUT fresh update (<3 days) = motivated seller, likely price drop!
  if (publishedOrFirstSeen && listing.last_changed_at) {
    const publishedDate = new Date(publishedOrFirstSeen);
    const lastChangedDate = new Date(listing.last_changed_at);

    const daysSincePublished = Math.floor((now.getTime() - publishedDate.getTime()) / (1000 * 60 * 60 * 24));
    const daysSinceChanged = Math.floor((now.getTime() - lastChangedDate.getTime()) / (1000 * 60 * 60 * 24));

    if (daysSincePublished > 30 && daysSinceChanged < 3) {
      points += 20;
      isGoldFind = true;
    }
  }

  return { points, isGoldFind };
}

/**
 * Completeness Score (0-40 points base, but phone can swing it -10 to +10)
 *
 * - Photos: 0-15 points (more photos = better)
 * - Description: 0-15 points (longer description = better)
 * - Phone: -10 (no phone) to +10 (has phone) - CRITICAL for Akquise!
 * - Details: 0-5 points (area + eur_per_m2)
 */
function calculateCompletenessScore(listing: Partial<Listing>): number {
  let points = 0;

  // Photos (15 points max)
  const photoCount = listing.images?.length || 0;
  if (photoCount >= 10) {
    points += 15;
  } else if (photoCount >= 7) {
    points += 12;
  } else if (photoCount >= 4) {
    points += 8;
  } else if (photoCount >= 2) {
    points += 4;
  }
  // else: 0 points for 0-1 photos

  // Description (15 points max)
  const descLength = listing.description?.length || 0;
  if (descLength >= 500) {
    points += 15; // Long, detailed description
  } else if (descLength >= 300) {
    points += 10; // Good description
  } else if (descLength >= 150) {
    points += 5;  // Basic description
  }
  // else: 0 points for <150 chars

  // ⚠️ PHONE NUMBER - CRITICAL! (ranges from -10 to +10)
  // No phone = USELESS for Akquise → massive penalty
  if (listing.phone_number && listing.phone_number.trim().length > 0) {
    points += 10; // +10: Phone available - can call immediately!
  } else {
    points -= 10; // -10: No phone - can't do Akquise!
  }

  // Other details (5 points max)
  if (listing.area && parseFloat(listing.area.toString()) > 0) {
    points += 3; // Area provided
  }
  if (listing.eur_per_m2 && parseFloat(listing.eur_per_m2.toString()) > 0) {
    points += 2; // Price per m² calculated
  }

  return points;
}

/**
 * Price Value Score (0-30 points)
 *
 * Based on price_evaluation:
 * - unter_schnitt (below average): 30 points - BEST DEALS!
 * - im_schnitt (average): 15 points
 * - ueber_schnitt (above average): 5 points
 * - null/unknown: 10 points (neutral)
 */
function calculatePriceValueScore(listing: Partial<Listing>): number {
  switch (listing.price_evaluation) {
    case 'unter_schnitt':
      return 30; // Great deal!
    case 'im_schnitt':
      return 15; // Fair price
    case 'ueber_schnitt':
      return 5;  // Expensive
    default:
      return 10; // No evaluation = neutral
  }
}

/**
 * Price Drop Bonus (0-25 points)
 *
 * MOTIVIERTER VERKÄUFER! Preissenkungen = höhere Abschlusswahrscheinlichkeit
 *
 * - 1 Preissenkung (5-10%): +10 points
 * - 1 Preissenkung (>10%): +15 points - Großer Drop!
 * - 2+ Preissenkungen: +20 points - Verzweifelter Verkäufer!
 * - 3+ Preissenkungen ODER >15% Drop: +25 points - SUPER HOT!
 */
function calculatePriceDropBonus(listing: Partial<Listing>): number {
  const totalDrops = listing.total_price_drops || 0;
  const lastDropPercentage = listing.last_price_drop_percentage
    ? Math.abs(parseFloat(listing.last_price_drop_percentage.toString()))
    : 0;

  // Keine Preissenkung
  if (totalDrops === 0 || !listing.last_price_drop || listing.last_price_drop >= 0) {
    return 0;
  }

  // 3+ Drops ODER >15% Drop = SUPER HOT
  if (totalDrops >= 3 || lastDropPercentage >= 15) {
    return 25;
  }

  // 2 Drops = Verzweifelter Verkäufer
  if (totalDrops >= 2) {
    return 20;
  }

  // 1 Drop >10% = Großer Drop
  if (lastDropPercentage >= 10) {
    return 15;
  }

  // 1 Drop 5-10% = Moderater Drop
  if (lastDropPercentage >= 5) {
    return 10;
  }

  // Kleiner Drop (<5%)
  return 5;
}

/**
 * Location Score (-10 to +10 points)
 *
 * Basiert auf Entfernung zu Wien (<30 min Autofahrt):
 * - Wien (alle Bezirke): +10 points - OPTIMAL!
 * - Whitelist (Mödling, Klosterneuburg): +10 points - OPTIMAL!
 * - Blacklist (Baden, Wr. Neustadt, Gänserndorf): -10 points - ZU WEIT!
 * - Sonstiges NÖ (nicht blacklisted): +5 points - NEUTRAL
 */
function calculateLocationScore(listing: Partial<Listing>): number {
  // Wenn keine Location-Daten vorhanden, neutral bewerten
  if (!listing.location || !listing.region) {
    return 0;
  }

  // Prüfe Akquise-Gebiet
  const geoResult = isInAkquiseGebiet(listing.location, listing.region);

  // Wien = IMMER gut
  if (listing.region === 'wien') {
    return 10;
  }

  // Whitelist (Mödling, Klosterneuburg) = OPTIMAL
  if (geoResult.allowed && geoResult.reason.includes('Whitelist')) {
    return 10;
  }

  // Blacklist (>30 min von Wien) = ABZUG!
  if (!geoResult.allowed && geoResult.reason.includes('blacklisted')) {
    return -10;
  }

  // Sonstiges NÖ (nicht explizit blacklisted) = NEUTRAL
  if (geoResult.allowed && listing.region === 'niederoesterreich') {
    return 5;
  }

  // Default: Neutral
  return 0;
}

/**
 * Get color tier based on total score
 *
 * - excellent (green): 80-160+
 * - good (yellow): 60-79
 * - medium (orange): 40-59
 * - low (red): 0-39
 */
function getScoreTier(score: number): 'excellent' | 'good' | 'medium' | 'low' {
  if (score >= 80) return 'excellent';
  if (score >= 60) return 'good';
  if (score >= 40) return 'medium';
  return 'low';
}
