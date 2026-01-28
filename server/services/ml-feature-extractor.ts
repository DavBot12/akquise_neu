import type { Listing } from '@shared/schema';
import { isInAkquiseGebiet } from './geo-filter';

/**
 * ML Features extracted from a listing for training/prediction
 * All features are numeric for ML algorithms
 */
export interface MLFeatures {
  // Temporal features
  days_since_changed: number;
  days_since_published: number;
  days_since_first_seen: number;
  is_gold_find: number; // 1 or 0 (boolean as number)

  // Completeness features
  photo_count: number;
  description_length: number;
  has_phone: number; // 1 or 0
  has_area: number; // 1 or 0
  has_eur_per_m2: number; // 1 or 0

  // Price features
  price_evaluation_unter: number; // 1 if unter_schnitt, else 0
  price_evaluation_im: number; // 1 if im_schnitt, else 0
  price_evaluation_ueber: number; // 1 if ueber_schnitt, else 0
  price_evaluation_unknown: number; // 1 if null/unknown, else 0

  // NEW: Price drop features (motivated seller signals!)
  has_price_drop: number; // 1 if has any price drop, else 0
  total_price_drops: number; // Number of price drops (0, 1, 2, 3+)
  last_drop_percentage: number; // Percentage of last drop (0-100)
  price_drop_severity: number; // 0=none, 1=small(<5%), 2=medium(5-10%), 3=large(>10%)

  // NEW: Price metrics
  price_normalized: number; // Price / 100000 (normalized for ML)
  eur_per_m2_normalized: number; // €/m² / 1000 (normalized)
  area_m2: number; // Area in m² (raw value for ML)

  // Category features (one-hot encoding)
  category_wohnung: number; // 1 if eigentumswohnung, else 0
  category_haus: number; // 1 if haus, else 0
  category_grundstueck: number; // 1 if grundstueck, else 0

  // Region features (one-hot encoding)
  region_wien: number; // 1 if wien, else 0
  region_noe: number; // 1 if niederoesterreich, else 0

  // Source features (one-hot encoding)
  source_willhaben: number; // 1 if willhaben, else 0
  source_derstandard: number; // 1 if derstandard, else 0
  source_immoscout: number; // 1 if immoscout, else 0

  // Location features (distance to Vienna)
  location_wien: number; // 1 if Wien, else 0
  location_whitelist: number; // 1 if Whitelist (Mödling, Klosterneuburg), else 0
  location_blacklist: number; // 1 if Blacklist (>30 min away), else 0
  location_other_noe: number; // 1 if other NÖ (not blacklisted), else 0

  // NEW: Vienna district features (for Wien only)
  vienna_district: number; // 1-23 for Wien, 0 for other regions
  is_inner_district: number; // 1 if district 1-9, else 0 (premium areas)
  is_outer_district: number; // 1 if district 10-23, else 0

  // Original scores (for comparison/blending)
  freshness_score: number;
  completeness_score: number;
  price_value_score: number;
  location_score: number;
  original_total: number;
}

/**
 * Extract numeric features from a listing for ML
 */
export function extractFeatures(listing: Partial<Listing>): MLFeatures {
  const now = new Date();

  // Temporal features
  const days_since_changed = listing.last_changed_at
    ? Math.floor((now.getTime() - new Date(listing.last_changed_at).getTime()) / (1000 * 60 * 60 * 24))
    : 999; // Large number if no data

  const days_since_published = listing.published_at || listing.first_seen_at
    ? Math.floor((now.getTime() - new Date(listing.published_at || listing.first_seen_at!).getTime()) / (1000 * 60 * 60 * 24))
    : 999;

  const days_since_first_seen = listing.first_seen_at
    ? Math.floor((now.getTime() - new Date(listing.first_seen_at).getTime()) / (1000 * 60 * 60 * 24))
    : 999;

  const is_gold_find = listing.is_gold_find ? 1 : 0;

  // Completeness features
  const photo_count = listing.images?.length || 0;
  const description_length = listing.description?.length || 0;
  const has_phone = listing.phone_number && listing.phone_number.trim().length > 0 ? 1 : 0;
  const has_area = listing.area && parseFloat(listing.area.toString()) > 0 ? 1 : 0;
  const has_eur_per_m2 = listing.eur_per_m2 && parseFloat(listing.eur_per_m2.toString()) > 0 ? 1 : 0;

  // Price evaluation (one-hot encoding)
  const price_evaluation_unter = listing.price_evaluation === 'unter_schnitt' ? 1 : 0;
  const price_evaluation_im = listing.price_evaluation === 'im_schnitt' ? 1 : 0;
  const price_evaluation_ueber = listing.price_evaluation === 'ueber_schnitt' ? 1 : 0;
  const price_evaluation_unknown = !listing.price_evaluation ? 1 : 0;

  // Price drop features (motivated seller!)
  const totalDrops = listing.total_price_drops || 0;
  const lastDropPct = listing.last_price_drop_percentage
    ? Math.abs(parseFloat(listing.last_price_drop_percentage.toString()))
    : 0;
  const has_price_drop = totalDrops > 0 && (listing.last_price_drop ?? 0) < 0 ? 1 : 0;
  const total_price_drops = Math.min(totalDrops, 5); // Cap at 5 for ML
  const last_drop_percentage = Math.min(lastDropPct, 30); // Cap at 30% for ML
  let price_drop_severity = 0;
  if (has_price_drop) {
    if (lastDropPct >= 10) price_drop_severity = 3; // Large drop
    else if (lastDropPct >= 5) price_drop_severity = 2; // Medium drop
    else price_drop_severity = 1; // Small drop
  }

  // Price metrics (normalized for ML)
  const rawPrice = listing.price ? parseFloat(listing.price.toString()) : 0;
  const price_normalized = rawPrice / 100000; // Normalize: 500k -> 5.0
  const rawEurPerM2 = listing.eur_per_m2 ? parseFloat(listing.eur_per_m2.toString()) : 0;
  const eur_per_m2_normalized = rawEurPerM2 / 1000; // Normalize: 5000 -> 5.0
  const area_m2 = listing.area ? parseFloat(listing.area.toString()) : 0;

  // Category (one-hot encoding)
  const category_wohnung = listing.category === 'eigentumswohnung' ? 1 : 0;
  const category_haus = listing.category === 'haus' ? 1 : 0;
  const category_grundstueck = listing.category === 'grundstueck' ? 1 : 0;

  // Region (one-hot encoding)
  const region_wien = listing.region === 'wien' ? 1 : 0;
  const region_noe = listing.region === 'niederoesterreich' ? 1 : 0;

  // Source (one-hot encoding)
  const source_willhaben = listing.source === 'willhaben' ? 1 : 0;
  const source_derstandard = listing.source === 'derstandard' ? 1 : 0;
  const source_immoscout = listing.source === 'immoscout' ? 1 : 0;

  // Location features (distance to Vienna)
  let location_wien = 0;
  let location_whitelist = 0;
  let location_blacklist = 0;
  let location_other_noe = 0;

  // Vienna district features
  let vienna_district = 0;
  let is_inner_district = 0;
  let is_outer_district = 0;

  if (listing.location && listing.region) {
    const geoResult = isInAkquiseGebiet(listing.location, listing.region);

    if (listing.region === 'wien') {
      location_wien = 1;

      // Extract Vienna district from location string
      // Patterns: "1010 Wien", "Wien, 10. Bezirk", "1150 Wien, Rudolfsheim"
      const locationStr = listing.location.toLowerCase();

      // Try PLZ pattern first (1XXX Wien)
      const plzMatch = locationStr.match(/\b1(\d{2})0\b/);
      if (plzMatch) {
        vienna_district = parseInt(plzMatch[1]);
      } else {
        // Try "X. Bezirk" pattern
        const bezirkMatch = locationStr.match(/(\d{1,2})\.\s*bezirk/i);
        if (bezirkMatch) {
          vienna_district = parseInt(bezirkMatch[1]);
        }
      }

      // Classify as inner (1-9) or outer (10-23) district
      if (vienna_district >= 1 && vienna_district <= 9) {
        is_inner_district = 1;
      } else if (vienna_district >= 10 && vienna_district <= 23) {
        is_outer_district = 1;
      }
    } else if (geoResult.allowed && geoResult.reason.includes('Whitelist')) {
      location_whitelist = 1;
    } else if (!geoResult.allowed && geoResult.reason.includes('blacklisted')) {
      location_blacklist = 1;
    } else if (geoResult.allowed && listing.region === 'niederoesterreich') {
      location_other_noe = 1;
    }
  }

  // Original scores (if available, otherwise 0)
  const freshness_score = 0; // Will be calculated if needed
  const completeness_score = 0;
  const price_value_score = 0;
  const location_score = 0;
  const original_total = listing.quality_score || 0;

  return {
    days_since_changed,
    days_since_published,
    days_since_first_seen,
    is_gold_find,
    photo_count,
    description_length,
    has_phone,
    has_area,
    has_eur_per_m2,
    price_evaluation_unter,
    price_evaluation_im,
    price_evaluation_ueber,
    price_evaluation_unknown,
    // Price drop features
    has_price_drop,
    total_price_drops,
    last_drop_percentage,
    price_drop_severity,
    // Price metrics
    price_normalized,
    eur_per_m2_normalized,
    area_m2,
    // Category
    category_wohnung,
    category_haus,
    category_grundstueck,
    region_wien,
    region_noe,
    source_willhaben,
    source_derstandard,
    source_immoscout,
    location_wien,
    location_whitelist,
    location_blacklist,
    location_other_noe,
    // Vienna district
    vienna_district,
    is_inner_district,
    is_outer_district,
    // Original scores
    freshness_score,
    completeness_score,
    price_value_score,
    location_score,
    original_total,
  };
}

/**
 * Convert MLFeatures object to numeric array for ML algorithms
 * Order matters - must be consistent across training and prediction
 */
export function featuresToArray(features: MLFeatures): number[] {
  return [
    features.days_since_changed,
    features.days_since_published,
    features.days_since_first_seen,
    features.is_gold_find,
    features.photo_count,
    features.description_length,
    features.has_phone,
    features.has_area,
    features.has_eur_per_m2,
    features.price_evaluation_unter,
    features.price_evaluation_im,
    features.price_evaluation_ueber,
    features.price_evaluation_unknown,
    // Price drop features
    features.has_price_drop,
    features.total_price_drops,
    features.last_drop_percentage,
    features.price_drop_severity,
    // Price metrics
    features.price_normalized,
    features.eur_per_m2_normalized,
    features.area_m2,
    // Category
    features.category_wohnung,
    features.category_haus,
    features.category_grundstueck,
    features.region_wien,
    features.region_noe,
    features.source_willhaben,
    features.source_derstandard,
    features.source_immoscout,
    features.location_wien,
    features.location_whitelist,
    features.location_blacklist,
    features.location_other_noe,
    // Vienna district
    features.vienna_district,
    features.is_inner_district,
    features.is_outer_district,
    // Original scores
    features.freshness_score,
    features.completeness_score,
    features.price_value_score,
    features.location_score,
    features.original_total,
  ];
}

/**
 * Get feature names for debugging/logging
 */
export function getFeatureNames(): string[] {
  return [
    'days_since_changed',
    'days_since_published',
    'days_since_first_seen',
    'is_gold_find',
    'photo_count',
    'description_length',
    'has_phone',
    'has_area',
    'has_eur_per_m2',
    'price_evaluation_unter',
    'price_evaluation_im',
    'price_evaluation_ueber',
    'price_evaluation_unknown',
    // Price drop features
    'has_price_drop',
    'total_price_drops',
    'last_drop_percentage',
    'price_drop_severity',
    // Price metrics
    'price_normalized',
    'eur_per_m2_normalized',
    'area_m2',
    // Category
    'category_wohnung',
    'category_haus',
    'category_grundstueck',
    'region_wien',
    'region_noe',
    'source_willhaben',
    'source_derstandard',
    'source_immoscout',
    'location_wien',
    'location_whitelist',
    'location_blacklist',
    'location_other_noe',
    // Vienna district
    'vienna_district',
    'is_inner_district',
    'is_outer_district',
    // Original scores
    'freshness_score',
    'completeness_score',
    'price_value_score',
    'location_score',
    'original_total',
  ];
}
