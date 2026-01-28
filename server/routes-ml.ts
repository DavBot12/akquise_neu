import { Express, Request, Response } from 'express';
import { storage } from './storage';
import { db } from './db';
import { user_sessions } from '@shared/schema';
import { eq } from 'drizzle-orm';
import {
  createFeedback,
  getFeedbackCount,
  getActiveModel,
  getAllModels,
  deactivateAllModels,
  clearModelCache,
  getOutcomeFeedbackStats,
  getTotalTrainingSamples,
} from './storage-ml';
import { autoTrain } from './services/ml-trainer';
import { extractFeatures } from './services/ml-feature-extractor';

/**
 * Helper function to get authenticated user from session
 */
async function getAuthenticatedUser(req: Request): Promise<{ id: number; username: string; is_admin: boolean } | null> {
  const sessionId = req.headers['x-session-id'];

  if (!sessionId) {
    return null;
  }

  // Validate session exists and is active
  const [session] = await db
    .select()
    .from(user_sessions)
    .where(eq(user_sessions.id, parseInt(sessionId as string)));

  if (!session || session.logout_time) {
    return null;
  }

  // Get user data
  const user = await storage.getUser(session.user_id);
  if (!user) {
    return null;
  }

  return {
    id: user.id,
    username: user.username,
    is_admin: user.is_admin || false,
  };
}

/**
 * ML API Routes
 * Endpoints for machine learning quality score feedback and training
 */

export function registerMLRoutes(app: Express): void {
  /**
   * POST /api/ml/feedback
   * Submit user feedback on a quality score
   *
   * Body: {
   *   listing_id: number,
   *   system_score: number,
   *   user_score: number
   * }
   */
  app.post('/api/ml/feedback', async (req: Request, res: Response) => {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { listing_id, system_score, user_score } = req.body;

    if (!listing_id || system_score == null || user_score == null) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Validate scores
    if (user_score < 0 || user_score > 150) {
      return res.status(400).json({ error: 'user_score must be between 0 and 150' });
    }

    // Get listing to extract features
    const listing = await storage.getListingById(listing_id);

    if (!listing) {
      return res.status(404).json({ error: 'Listing not found' });
    }

    // Extract features for ML training
    const features = extractFeatures(listing);

    // Calculate delta
    const score_delta = user_score - system_score;

    // Save feedback
    const feedback = await createFeedback({
      listing_id,
      user_id: user.id,
      system_score,
      user_score,
      score_delta,
      features,
    });

    console.log(
      `[ML-FEEDBACK] User ${user.username} adjusted listing ${listing_id}: ${system_score} → ${user_score} (${score_delta >= 0 ? '+' : ''}${score_delta})`
    );

    // Check if we should trigger retraining (every 10 feedbacks) - use TOTAL count
    const trainingSamples = await getTotalTrainingSamples();
    const totalFeedback = trainingSamples.total;
    if (totalFeedback % 10 === 0 && totalFeedback >= 5) {
      console.log(`[ML-FEEDBACK] Reached ${totalFeedback} total feedbacks - triggering auto-train...`);
      // Train asynchronously (don't block response)
      autoTrain().catch(err => {
        console.error('[ML-FEEDBACK] Auto-train failed:', err);
      });
    }

    res.json({
      success: true,
      feedback,
      total_feedback: totalFeedback,
      should_retrain: totalFeedback >= 5,
    });
  } catch (error: any) {
    console.error('[ML-FEEDBACK] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/ml/stats
 * Get ML system statistics
 *
 * Returns:
 * {
 *   total_feedback: number,
 *   active_model: {
 *     version: string,
 *     algorithm: string,
 *     mae: number,
 *     training_samples: number
 *   } | null
 * }
 */
app.get('/api/ml/stats', async (req: Request, res: Response) => {
  try {
    const trainingSamples = await getTotalTrainingSamples();
    const outcomeStats = await getOutcomeFeedbackStats();
    const activeModel = await getActiveModel();

    res.json({
      // Quality feedback (user score adjustments)
      quality_feedback: trainingSamples.quality_feedback,
      // Outcome feedback (akquise success, deletions)
      outcome_feedback: {
        total: trainingSamples.outcome_feedback,
        by_type: outcomeStats.by_type,
      },
      // Combined total
      total_feedback: trainingSamples.total,
      active_model: activeModel
        ? {
            version: activeModel.model_version,
            algorithm: activeModel.algorithm,
            mae: activeModel.mae,
            rmse: activeModel.rmse,
            r_squared: activeModel.r_squared,
            training_samples: activeModel.training_samples,
            trained_at: activeModel.trained_at,
          }
        : null,
      ready_for_training: trainingSamples.total >= 5,
      phase: trainingSamples.total < 5 ? 1 : trainingSamples.total < 50 ? 2 : 3,
    });
  } catch (error: any) {
    console.error('[ML-STATS] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/ml/train
 * Force immediate retraining (admin only)
 */
app.post('/api/ml/train', async (req: Request, res: Response) => {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user || !user.is_admin) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    // Use TOTAL feedback count (quality + outcome)
    const trainingSamples = await getTotalTrainingSamples();
    if (trainingSamples.total < 5) {
      return res.status(400).json({ error: `Not enough feedback samples (need at least 5, have ${trainingSamples.total})` });
    }

    console.log(`[ML-TRAIN] Admin ${user.username} triggered manual training...`);

    const result = await autoTrain();

    // Clear model cache to force reload
    clearModelCache();

    res.json({
      success: result.success,
      algorithm: result.algorithm,
      model_version: result.model_version,
      mae: result.mae,
      training_samples: result.training_samples,
    });
  } catch (error: any) {
    console.error('[ML-TRAIN] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/ml/disable
 * Kill switch - deactivate all ML models (admin only)
 */
app.post('/api/ml/disable', async (req: Request, res: Response) => {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user || !user.is_admin) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    console.log(`[ML-DISABLE] Admin ${user.username} deactivated all ML models`);

    await deactivateAllModels();

    res.json({
      success: true,
      message: 'All ML models deactivated. System will use default quality scorer.',
    });
  } catch (error: any) {
    console.error('[ML-DISABLE] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/ml/models
 * Get all trained models (admin only)
 */
app.get('/api/ml/models', async (req: Request, res: Response) => {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user || !user.is_admin) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const models = await getAllModels();

    res.json({
      models: models.map(m => ({
        version: m.model_version,
        algorithm: m.algorithm,
        mae: m.mae,
        rmse: m.rmse,
        r_squared: m.r_squared,
        training_samples: m.training_samples,
        trained_at: m.trained_at,
        is_active: m.is_active,
      })),
    });
  } catch (error: any) {
    console.error('[ML-MODELS] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

  /**
   * POST /api/quality-scores/recalculate
   * Recalculate all quality scores manually (admin only)
   */
  app.post('/api/quality-scores/recalculate', async (req: Request, res: Response) => {
    try {
      const user = await getAuthenticatedUser(req);
      if (!user || !user.is_admin) {
        return res.status(403).json({ error: 'Admin access required' });
      }

      console.log(`[QUALITY-RECALC] Admin ${user.username} triggered manual recalculation...`);

      // Import QualityScoreUpdater
      const { QualityScoreUpdater } = await import('./services/quality-score-updater');
      const updater = new QualityScoreUpdater();

      // Run update in background (don't block response)
      updater.updateAllScores().then(() => {
        console.log('[QUALITY-RECALC] Manual recalculation completed');
      }).catch((error: any) => {
        console.error('[QUALITY-RECALC] Error during recalculation:', error);
      });

      res.json({
        success: true,
        message: 'Quality score recalculation started in background',
      });
    } catch (error: any) {
      console.error('[QUALITY-RECALC] Error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  console.log('[ML-ROUTES] ML API routes registered');
}
