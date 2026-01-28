import { db } from '../db';
import { listings } from '../../shared/schema';
import { eq, and, sql, ne, isNull } from 'drizzle-orm';
import type { Listing } from '../../shared/schema';

/**
 * DUPLICATE DETECTOR
 *
 * Finds listings that are likely the same property on different portals.
 *
 * Detection criteria:
 * 1. Same or very similar location (normalized address)
 * 2. Price within 10% range
 * 3. Area within 10% range (if both have area)
 * 4. Same category and region
 *
 * When duplicates are found:
 * - Oldest listing becomes the primary
 * - All listings share the same duplicate_group_id
 * - duplicate_sources is updated to show all portals
 */

interface DuplicateCandidate {
  id: number;
  title: string;
  location: string;
  price: number;
  area: string | null;
  source: string;
  category: string;
  region: string;
  first_seen_at: Date;
  duplicate_group_id: number | null;
}

/**
 * Normalize location for comparison
 * - Lowercase
 * - Remove common suffixes
 * - Remove punctuation
 */
function normalizeLocation(location: string): string {
  return location
    .toLowerCase()
    .replace(/,?\s*(wien|österreich|austria)/gi, '')
    .replace(/\d{4}\s*/g, '') // Remove PLZ
    .replace(/[.,\-\/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Check if two prices are within tolerance (10%)
 */
function pricesMatch(price1: number, price2: number, tolerance = 0.1): boolean {
  if (price1 === 0 || price2 === 0) return false; // Can't compare "Preis auf Anfrage"
  const diff = Math.abs(price1 - price2);
  const avg = (price1 + price2) / 2;
  return diff / avg <= tolerance;
}

/**
 * Check if two areas are within tolerance (10%)
 */
function areasMatch(area1: string | null, area2: string | null, tolerance = 0.1): boolean {
  if (!area1 || !area2) return true; // If either is missing, don't disqualify
  const a1 = parseFloat(area1);
  const a2 = parseFloat(area2);
  if (isNaN(a1) || isNaN(a2)) return true;
  const diff = Math.abs(a1 - a2);
  const avg = (a1 + a2) / 2;
  return diff / avg <= tolerance;
}

/**
 * Calculate similarity score between two locations
 * Returns 0-1 (1 = exact match)
 */
function locationSimilarity(loc1: string, loc2: string): number {
  const norm1 = normalizeLocation(loc1);
  const norm2 = normalizeLocation(loc2);

  // Exact match after normalization
  if (norm1 === norm2) return 1;

  // Check if one contains the other (street address match)
  if (norm1.includes(norm2) || norm2.includes(norm1)) return 0.9;

  // Word overlap
  const words1 = new Set(norm1.split(' ').filter(w => w.length > 2));
  const words2 = new Set(norm2.split(' ').filter(w => w.length > 2));

  if (words1.size === 0 || words2.size === 0) return 0;

  let overlap = 0;
  words1.forEach(w => {
    if (words2.has(w)) overlap++;
  });

  return overlap / Math.max(words1.size, words2.size);
}

/**
 * Find potential duplicates for a listing
 */
export async function findDuplicates(listingId: number): Promise<DuplicateCandidate[]> {
  // Get the listing
  const [listing] = await db
    .select()
    .from(listings)
    .where(eq(listings.id, listingId));

  if (!listing) return [];

  // Find candidates: same category + region, different source, not deleted
  const candidates = await db
    .select({
      id: listings.id,
      title: listings.title,
      location: listings.location,
      price: listings.price,
      area: listings.area,
      source: listings.source,
      category: listings.category,
      region: listings.region,
      first_seen_at: listings.first_seen_at,
      duplicate_group_id: listings.duplicate_group_id,
    })
    .from(listings)
    .where(and(
      eq(listings.category, listing.category),
      eq(listings.region, listing.region),
      ne(listings.id, listingId),
      ne(listings.source, listing.source), // Different portal
      eq(listings.is_deleted, false)
    ));

  // Filter by price, area, and location similarity
  const matches = candidates.filter(candidate => {
    // Price must be within 10%
    if (!pricesMatch(listing.price, candidate.price)) return false;

    // Area must be within 10% (if both have it)
    if (!areasMatch(listing.area, candidate.area)) return false;

    // Location must be similar
    const similarity = locationSimilarity(listing.location, candidate.location);
    if (similarity < 0.7) return false;

    return true;
  });

  return matches;
}

/**
 * Group duplicate listings together
 */
export async function groupDuplicates(listingIds: number[]): Promise<void> {
  if (listingIds.length < 2) return;

  // Get all listings
  const listingsData = await db
    .select()
    .from(listings)
    .where(sql`${listings.id} IN (${sql.join(listingIds.map(id => sql`${id}`), sql`, `)})`);

  if (listingsData.length < 2) return;

  // Sort by first_seen_at - oldest becomes primary
  listingsData.sort((a, b) =>
    new Date(a.first_seen_at).getTime() - new Date(b.first_seen_at).getTime()
  );

  const primaryListing = listingsData[0];

  // Use primary listing's ID as group ID (or existing group ID if any)
  const groupId = listingsData.find(l => l.duplicate_group_id)?.duplicate_group_id || primaryListing.id;

  // Collect all sources
  const allSources = Array.from(new Set(listingsData.map(l => l.source)));

  // Update all listings in the group
  for (let i = 0; i < listingsData.length; i++) {
    const listing = listingsData[i];
    const isPrimary = i === 0;

    await db
      .update(listings)
      .set({
        duplicate_group_id: groupId,
        is_primary_listing: isPrimary,
        duplicate_sources: allSources,
      })
      .where(eq(listings.id, listing.id));
  }

  console.log(`[DUPLICATE-DETECTOR] Grouped ${listingsData.length} listings (group ${groupId}): ${allSources.join(', ')}`);
}

/**
 * Ungroup a listing from its duplicate group
 */
export async function ungroupListing(listingId: number): Promise<void> {
  await db
    .update(listings)
    .set({
      duplicate_group_id: null,
      is_primary_listing: true,
      duplicate_sources: null,
    })
    .where(eq(listings.id, listingId));
}

/**
 * Get all listings in a duplicate group
 */
export async function getDuplicateGroup(groupId: number): Promise<Listing[]> {
  return db
    .select()
    .from(listings)
    .where(eq(listings.duplicate_group_id, groupId));
}

/**
 * Auto-detect and group duplicates for a new listing
 * Call this after inserting a new listing
 */
export async function autoDetectAndGroup(listingId: number): Promise<boolean> {
  const duplicates = await findDuplicates(listingId);

  if (duplicates.length === 0) return false;

  // If any duplicate already has a group, use that
  const existingGroup = duplicates.find(d => d.duplicate_group_id);

  if (existingGroup) {
    // Add to existing group
    const groupMembers = await getDuplicateGroup(existingGroup.duplicate_group_id!);
    const allIds = [...groupMembers.map(m => m.id), listingId];
    await groupDuplicates(allIds);
  } else {
    // Create new group with first match
    await groupDuplicates([listingId, duplicates[0].id]);
  }

  return true;
}

/**
 * Scan all listings for duplicates (batch operation)
 */
export async function scanAllForDuplicates(): Promise<{
  groupsCreated: number;
  listingsGrouped: number;
}> {
  let groupsCreated = 0;
  let listingsGrouped = 0;

  // Get all ungrouped listings
  const ungrouped = await db
    .select()
    .from(listings)
    .where(and(
      isNull(listings.duplicate_group_id),
      eq(listings.is_deleted, false)
    ));

  console.log(`[DUPLICATE-DETECTOR] Scanning ${ungrouped.length} ungrouped listings...`);

  for (const listing of ungrouped) {
    // Skip if it got grouped in the meantime
    const current = await db
      .select({ duplicate_group_id: listings.duplicate_group_id })
      .from(listings)
      .where(eq(listings.id, listing.id));

    if (current[0]?.duplicate_group_id) continue;

    const wasGrouped = await autoDetectAndGroup(listing.id);
    if (wasGrouped) {
      groupsCreated++;
      listingsGrouped++;
    }
  }

  console.log(`[DUPLICATE-DETECTOR] Created ${groupsCreated} groups, grouped ${listingsGrouped} listings`);

  return { groupsCreated, listingsGrouped };
}
