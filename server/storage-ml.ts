import { db } from './db';
import { quality_feedback, ml_model_weights, outcome_feedback, listings, users } from '@shared/schema';
import type { InsertQualityFeedback, QualityFeedback, InsertMlModelWeights, MlModelWeights, InsertOutcomeFeedback, OutcomeFeedback } from '@shared/schema';
import { eq, and, desc, sql } from 'drizzle-orm';

/**
 * Storage layer for ML operations
 */

// In-memory cache for active model (5 minute expiry)
let activeModelCache: { model: MlModelWeights | null; timestamp: number } | null = null;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

/**
 * Save user feedback on a quality score
 */
export async function createFeedback(data: InsertQualityFeedback): Promise<QualityFeedback> {
  const [feedback] = await db
    .insert(quality_feedback)
    .values(data)
    .onConflictDoUpdate({
      target: [quality_feedback.user_id, quality_feedback.listing_id],
      set: {
        system_score: data.system_score,
        user_score: data.user_score,
        score_delta: data.score_delta,
        features: data.features,
        created_at: new Date(),
      },
    })
    .returning();

  return feedback;
}

/**
 * Get total number of feedback samples
 */
export async function getFeedbackCount(): Promise<number> {
  const result = await db
    .select()
    .from(quality_feedback);

  return result.length;
}

/**
 * Get all feedback for training
 */
export async function getAllFeedback(): Promise<QualityFeedback[]> {
  return await db
    .select()
    .from(quality_feedback)
    .orderBy(desc(quality_feedback.created_at));
}

/**
 * Get feedback for a specific listing
 */
export async function getFeedbackForListing(listingId: number): Promise<QualityFeedback[]> {
  return await db
    .select()
    .from(quality_feedback)
    .where(eq(quality_feedback.listing_id, listingId))
    .orderBy(desc(quality_feedback.created_at));
}

/**
 * Save a trained model
 */
export async function saveModel(data: InsertMlModelWeights): Promise<MlModelWeights> {
  // If this model should be active, deactivate all others first
  if (data.is_active) {
    await db
      .update(ml_model_weights)
      .set({ is_active: false })
      .where(eq(ml_model_weights.is_active, true));

    // Clear cache
    activeModelCache = null;
  }

  const [model] = await db
    .insert(ml_model_weights)
    .values(data)
    .onConflictDoUpdate({
      target: ml_model_weights.model_version,
      set: {
        algorithm: data.algorithm,
        weights: data.weights,
        training_samples: data.training_samples,
        mae: data.mae,
        rmse: data.rmse,
        r_squared: data.r_squared,
        trained_at: new Date(),
        is_active: data.is_active,
        config: data.config,
      },
    })
    .returning();

  return model;
}

/**
 * Get the currently active model (with caching)
 */
export async function getActiveModel(): Promise<MlModelWeights | null> {
  // Check cache
  if (activeModelCache) {
    const age = Date.now() - activeModelCache.timestamp;
    if (age < CACHE_DURATION) {
      return activeModelCache.model;
    }
  }

  // Fetch from database
  const models = await db
    .select()
    .from(ml_model_weights)
    .where(eq(ml_model_weights.is_active, true))
    .orderBy(desc(ml_model_weights.trained_at))
    .limit(1);

  const model = models[0] || null;

  // Update cache
  activeModelCache = {
    model,
    timestamp: Date.now(),
  };

  return model;
}

/**
 * Get all models ordered by training date
 */
export async function getAllModels(): Promise<MlModelWeights[]> {
  return await db
    .select()
    .from(ml_model_weights)
    .orderBy(desc(ml_model_weights.trained_at));
}

/**
 * Get a specific model by version
 */
export async function getModelByVersion(version: string): Promise<MlModelWeights | null> {
  const models = await db
    .select()
    .from(ml_model_weights)
    .where(eq(ml_model_weights.model_version, version))
    .limit(1);

  return models[0] || null;
}

/**
 * Deactivate all models (kill switch)
 */
export async function deactivateAllModels(): Promise<void> {
  await db
    .update(ml_model_weights)
    .set({ is_active: false })
    .where(eq(ml_model_weights.is_active, true));

  // Clear cache
  activeModelCache = null;
}

/**
 * Activate a specific model by version
 */
export async function activateModel(version: string): Promise<void> {
  // Deactivate all first
  await deactivateAllModels();

  // Activate the target model
  await db
    .update(ml_model_weights)
    .set({ is_active: true })
    .where(eq(ml_model_weights.model_version, version));

  // Clear cache
  activeModelCache = null;
}

/**
 * Clear the active model cache (useful after updates)
 */
export function clearModelCache(): void {
  activeModelCache = null;
}

// ==========================================
// OUTCOME FEEDBACK (Real-world results for ML)
// ==========================================

/**
 * Map outcome type to score adjustment
 */
export function getScoreAdjustment(outcomeType: InsertOutcomeFeedback['outcome_type']): number {
  const adjustments: Record<string, number> = {
    'akquise_success': 50,       // Very positive - successful acquisition
    'akquise_completed': 20,     // Positive - marked as done
    'deleted_spam': -50,         // Very negative - spam/fake
    'deleted_not_relevant': -30, // Negative - not interesting
    'deleted_sold': 0,           // Neutral - already sold (not our fault)
    'deleted_other': -10,        // Slight negative - other reasons
  };
  return adjustments[outcomeType] ?? 0;
}

/**
 * Create outcome feedback (from akquise/delete actions)
 */
export async function createOutcomeFeedback(data: InsertOutcomeFeedback): Promise<OutcomeFeedback> {
  const [feedback] = await db
    .insert(outcome_feedback)
    .values(data)
    .returning();

  return feedback;
}

/**
 * Get total outcome feedback count
 */
export async function getOutcomeFeedbackCount(): Promise<number> {
  const result = await db
    .select()
    .from(outcome_feedback);

  return result.length;
}

/**
 * Get all outcome feedback for training
 */
export async function getAllOutcomeFeedback(): Promise<OutcomeFeedback[]> {
  return await db
    .select()
    .from(outcome_feedback)
    .orderBy(desc(outcome_feedback.created_at));
}

/**
 * Get outcome feedback stats by type
 */
export async function getOutcomeFeedbackStats(): Promise<{
  total: number;
  by_type: Record<string, number>;
}> {
  const all = await getAllOutcomeFeedback();

  const by_type: Record<string, number> = {};
  for (const fb of all) {
    by_type[fb.outcome_type] = (by_type[fb.outcome_type] || 0) + 1;
  }

  return {
    total: all.length,
    by_type,
  };
}

/**
 * Get combined feedback count (quality + outcome) for training decisions
 */
export async function getTotalTrainingSamples(): Promise<{
  quality_feedback: number;
  outcome_feedback: number;
  total: number;
}> {
  const qfCount = await getFeedbackCount();
  const ofCount = await getOutcomeFeedbackCount();

  return {
    quality_feedback: qfCount,
    outcome_feedback: ofCount,
    total: qfCount + ofCount,
  };
}
