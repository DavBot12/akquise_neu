import { SimpleLinearRegression } from 'ml-regression-simple-linear';
import { extractFeatures, featuresToArray, type MLFeatures } from './ml-feature-extractor';
import { getAllFeedback, getFeedbackCount, saveModel, getAllOutcomeFeedback, getTotalTrainingSamples } from '../storage-ml';
import type { QualityFeedback, OutcomeFeedback } from '@shared/schema';

/**
 * Training sample - unified format for quality and outcome feedback
 */
interface TrainingSample {
  features: MLFeatures;
  system_score: number;
  user_score: number;  // For outcome feedback: original_score + score_adjustment
  score_delta: number;
  source: 'quality_feedback' | 'outcome_feedback';
  outcome_type?: string;  // For outcome feedback: deleted_spam, akquise_success, etc.
}

/**
 * Convert quality feedback to training samples
 */
function qualityFeedbackToSamples(feedbacks: QualityFeedback[]): TrainingSample[] {
  return feedbacks.map(f => ({
    features: f.features as MLFeatures,
    system_score: f.system_score,
    user_score: f.user_score,
    score_delta: f.score_delta,
    source: 'quality_feedback' as const,
  }));
}

/**
 * Convert outcome feedback to training samples
 *
 * Outcome feedback tells us:
 * - akquise_success: This listing was GREAT → score should be HIGHER
 * - deleted_spam: This listing was BAD → score should be LOWER
 * etc.
 */
function outcomeFeedbackToSamples(feedbacks: OutcomeFeedback[]): TrainingSample[] {
  return feedbacks.map(f => {
    const targetScore = f.original_score + f.score_adjustment;
    // Clamp to valid range
    const clampedTarget = Math.max(0, Math.min(150, targetScore));

    return {
      features: f.features as MLFeatures,
      system_score: f.original_score,
      user_score: clampedTarget,
      score_delta: f.score_adjustment,
      source: 'outcome_feedback' as const,
      outcome_type: f.outcome_type,
    };
  });
}

/**
 * Get all training samples (quality + outcome feedback combined)
 */
async function getAllTrainingSamples(): Promise<TrainingSample[]> {
  const [qualityFeedbacks, outcomeFeedbacks] = await Promise.all([
    getAllFeedback(),
    getAllOutcomeFeedback(),
  ]);

  const qualitySamples = qualityFeedbackToSamples(qualityFeedbacks);
  const outcomeSamples = outcomeFeedbackToSamples(outcomeFeedbacks);

  // Combine and shuffle (to avoid bias from order)
  const allSamples = [...qualitySamples, ...outcomeSamples];

  // Fisher-Yates shuffle
  for (let i = allSamples.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [allSamples[i], allSamples[j]] = [allSamples[j], allSamples[i]];
  }

  console.log(`[ML-TRAINER] Loaded ${qualitySamples.length} quality + ${outcomeSamples.length} outcome = ${allSamples.length} total samples`);

  return allSamples;
}

/**
 * ML Trainer Service
 * Trains quality score models from user feedback
 */

/**
 * Phase 2: Weighted Average Algorithm (5-50 samples)
 * Simple algorithm that adjusts feature weights based on feedback patterns
 * NOW USES BOTH quality_feedback AND outcome_feedback!
 */
export async function trainWeightedAverage(): Promise<{
  success: boolean;
  model_version: string;
  mae: number;
  training_samples: number;
}> {
  console.log('[ML-TRAINER] Starting weighted average training...');

  const samples = await getAllTrainingSamples();
  const sampleCount = samples.length;

  if (sampleCount < 5) {
    console.log('[ML-TRAINER] Not enough samples for training (need at least 5)');
    return {
      success: false,
      model_version: '',
      mae: 999,
      training_samples: sampleCount,
    };
  }

  // Initialize weights (start with equal importance)
  const weights = {
    freshness_multiplier: 1.0,
    completeness_multiplier: 1.0,
    price_value_multiplier: 1.0,
    location_multiplier: 1.0,        // NEW: Location weight
    gold_find_bonus: 20,
    photo_weight: 1.0,
    description_weight: 1.0,
    phone_weight: 1.0,
    // Location-specific weights
    wien_bonus: 0,
    whitelist_bonus: 0,
    blacklist_penalty: 0,
  };

  // Analyze feedback patterns and adjust weights
  let totalDelta = 0;
  let freshnessBoost = 0;
  let completenessBoost = 0;
  let priceBoost = 0;
  let locationBoost = 0;
  let wienBoost = 0;
  let whitelistBoost = 0;
  let blacklistBoost = 0;

  for (const sample of samples) {
    const delta = sample.score_delta;
    totalDelta += Math.abs(delta);
    const features = sample.features;

    // Weight outcome feedback higher (real-world results!)
    const weight = sample.source === 'outcome_feedback' ? 2.0 : 1.0;

    // If positive feedback (user rated higher OR akquise_success)
    if (delta > 0) {
      if (features.days_since_changed < 7) freshnessBoost += 1 * weight;
      if (features.photo_count >= 10) completenessBoost += 1 * weight;
      if (features.price_evaluation_unter === 1) priceBoost += 1 * weight;
      if (features.has_phone === 1) completenessBoost += 0.5 * weight;

      // Location learning
      if (features.location_wien === 1) wienBoost += 1 * weight;
      if (features.location_whitelist === 1) whitelistBoost += 1 * weight;
      if (features.location_blacklist === 1) blacklistBoost -= 0.5 * weight; // Surprising success in blacklist area
    }
    // If negative feedback (user rated lower OR deleted_spam/not_relevant)
    else if (delta < 0) {
      if (features.days_since_changed > 30) freshnessBoost -= 0.5 * weight;
      if (features.photo_count < 4) completenessBoost -= 0.5 * weight;
      if (features.price_evaluation_ueber === 1) priceBoost -= 0.5 * weight;
      if (features.has_phone === 0) completenessBoost -= 0.5 * weight;

      // Location learning - if deleted from certain areas
      if (features.location_blacklist === 1) blacklistBoost += 1 * weight; // Confirms blacklist is correct
      if (features.location_wien === 1) wienBoost -= 0.3 * weight; // Rare: Wien listing deleted
    }

    // Special handling for outcome types
    if (sample.outcome_type === 'deleted_spam') {
      // Strong negative signal - learn what spam looks like
      if (features.description_length < 100) completenessBoost -= 1 * weight;
      if (features.photo_count < 3) completenessBoost -= 1 * weight;
    }
    if (sample.outcome_type === 'akquise_success') {
      // Strong positive signal - learn what success looks like
      if (features.has_phone === 1) completenessBoost += 1.5 * weight;
      locationBoost += 0.5 * weight;
    }
  }

  // Apply boosts (cap at ±30% for more flexibility)
  weights.freshness_multiplier = Math.max(0.7, Math.min(1.3, 1.0 + freshnessBoost / sampleCount));
  weights.completeness_multiplier = Math.max(0.7, Math.min(1.3, 1.0 + completenessBoost / sampleCount));
  weights.price_value_multiplier = Math.max(0.7, Math.min(1.3, 1.0 + priceBoost / sampleCount));
  weights.location_multiplier = Math.max(0.7, Math.min(1.3, 1.0 + locationBoost / sampleCount));

  // Location-specific bonuses/penalties (±5 points max)
  weights.wien_bonus = Math.max(-5, Math.min(5, wienBoost / Math.max(1, sampleCount / 10)));
  weights.whitelist_bonus = Math.max(-5, Math.min(5, whitelistBoost / Math.max(1, sampleCount / 10)));
  weights.blacklist_penalty = Math.max(-5, Math.min(5, blacklistBoost / Math.max(1, sampleCount / 10)));

  // Calculate MAE (Mean Absolute Error)
  let totalError = 0;
  for (const sample of samples) {
    const predictedScore = sample.system_score;
    const actualScore = sample.user_score;
    totalError += Math.abs(predictedScore - actualScore);
  }
  const mae = totalError / sampleCount;

  // Save model
  const modelVersion = `v1.0-weighted-${Date.now()}`;
  await saveModel({
    model_version: modelVersion,
    algorithm: 'weighted_avg',
    weights: weights,
    training_samples: sampleCount,
    mae: mae.toFixed(2),
    rmse: null,
    r_squared: null,
    is_active: true,
    config: { phase: 2, min_samples: 5 },
  });

  console.log(`[ML-TRAINER] ✅ Weighted average trained: MAE=${mae.toFixed(2)}, samples=${sampleCount}`);

  return {
    success: true,
    model_version: modelVersion,
    mae,
    training_samples: sampleCount,
  };
}

/**
 * Phase 3: Linear Regression Algorithm (50+ samples)
 * Uses ml-regression library for proper linear regression with multiple features
 * NOW USES BOTH quality_feedback AND outcome_feedback!
 */
export async function trainLinearRegression(): Promise<{
  success: boolean;
  model_version: string;
  mae: number;
  rmse: number;
  r_squared: number;
  training_samples: number;
}> {
  console.log('[ML-TRAINER] Starting linear regression training...');

  const samples = await getAllTrainingSamples();
  const sampleCount = samples.length;

  if (sampleCount < 50) {
    console.log('[ML-TRAINER] Not enough samples for linear regression (need at least 50)');
    return {
      success: false,
      model_version: '',
      mae: 999,
      rmse: 999,
      r_squared: 0,
      training_samples: sampleCount,
    };
  }

  // Prepare training data
  const X: number[][] = [];
  const y: number[] = [];

  for (const sample of samples) {
    const featureArray = featuresToArray(sample.features);
    X.push(featureArray);
    y.push(sample.user_score);
  }

  // Split into train/test (80/20)
  const splitIndex = Math.floor(sampleCount * 0.8);
  const X_train = X.slice(0, splitIndex);
  const y_train = y.slice(0, splitIndex);
  const X_test = X.slice(splitIndex);
  const y_test = y.slice(splitIndex);

  // Train multiple simple linear regressions for each feature
  // Then combine them (weighted ensemble)
  const featureCount = X_train[0].length;
  const models: SimpleLinearRegression[] = [];
  const featureWeights: number[] = [];

  for (let i = 0; i < featureCount; i++) {
    const x_feature = X_train.map(row => row[i]);
    const model = new SimpleLinearRegression(x_feature, y_train);
    models.push(model);

    // Calculate feature importance (simple correlation-based weight)
    const predictions = X_test.map(row => model.predict(row[i]));
    const errors = predictions.map((pred, idx) => Math.abs(pred - y_test[idx]));
    const avgError = errors.reduce((a, b) => a + b, 0) / errors.length;
    featureWeights.push(1 / (avgError + 0.01)); // Inverse error as weight
  }

  // Normalize weights
  const weightSum = featureWeights.reduce((a, b) => a + b, 0);
  const normalizedWeights = featureWeights.map(w => w / weightSum);

  // Calculate metrics on test set
  let totalError = 0;
  let totalSquaredError = 0;
  const y_mean = y_test.reduce((a, b) => a + b, 0) / y_test.length;
  let totalVariance = 0;

  for (let i = 0; i < X_test.length; i++) {
    // Ensemble prediction (weighted average of all feature predictions)
    let prediction = 0;
    for (let j = 0; j < featureCount; j++) {
      prediction += models[j].predict(X_test[i][j]) * normalizedWeights[j];
    }

    // Clamp prediction to valid range [0, 150]
    prediction = Math.max(0, Math.min(150, prediction));

    const error = Math.abs(prediction - y_test[i]);
    totalError += error;
    totalSquaredError += error * error;
    totalVariance += Math.pow(y_test[i] - y_mean, 2);
  }

  const mae = totalError / y_test.length;
  const rmse = Math.sqrt(totalSquaredError / y_test.length);
  const r_squared = 1 - (totalSquaredError / totalVariance);

  // Save model
  const modelVersion = `v2.0-linreg-${Date.now()}`;
  await saveModel({
    model_version: modelVersion,
    algorithm: 'linear_regression',
    weights: {
      feature_weights: normalizedWeights,
      models: models.map(m => ({ slope: m.slope, intercept: m.intercept })),
    },
    training_samples: sampleCount,
    mae: mae.toFixed(2),
    rmse: rmse.toFixed(2),
    r_squared: r_squared.toFixed(4),
    is_active: true,
    config: { phase: 3, min_samples: 50, train_test_split: 0.8 },
  });

  console.log(
    `[ML-TRAINER] ✅ Linear regression trained: MAE=${mae.toFixed(2)}, RMSE=${rmse.toFixed(2)}, R²=${r_squared.toFixed(4)}, samples=${sampleCount}`
  );

  return {
    success: true,
    model_version: modelVersion,
    mae,
    rmse,
    r_squared,
    training_samples: sampleCount,
  };
}

/**
 * Auto-train: Selects the best algorithm based on sample count
 * Uses TOTAL samples (quality + outcome feedback)
 */
export async function autoTrain(): Promise<{
  success: boolean;
  algorithm: string;
  model_version: string;
  mae: number;
  training_samples: number;
}> {
  const trainingSamples = await getTotalTrainingSamples();
  const sampleCount = trainingSamples.total;

  console.log(`[ML-TRAINER] Auto-train started with ${sampleCount} samples (${trainingSamples.quality_feedback} quality + ${trainingSamples.outcome_feedback} outcome)`);

  if (sampleCount < 5) {
    console.log('[ML-TRAINER] Not enough samples for any training (need at least 5)');
    return {
      success: false,
      algorithm: 'none',
      model_version: '',
      mae: 999,
      training_samples: sampleCount,
    };
  } else if (sampleCount < 50) {
    // Phase 2: Weighted Average
    const result = await trainWeightedAverage();
    return {
      success: result.success,
      algorithm: 'weighted_avg',
      model_version: result.model_version,
      mae: result.mae,
      training_samples: result.training_samples,
    };
  } else {
    // Phase 3: Linear Regression
    const result = await trainLinearRegression();
    return {
      success: result.success,
      algorithm: 'linear_regression',
      model_version: result.model_version,
      mae: result.mae,
      training_samples: result.training_samples,
    };
  }
}

/**
 * Validate a model before activation
 * Checks for reasonable MAE and no NaN/Infinity values
 */
export function validateModel(
  mae: number,
  weights: Record<string, any>
): { valid: boolean; reason?: string } {
  // Check MAE is reasonable (< 20 points average error)
  if (mae > 20) {
    return { valid: false, reason: 'MAE too high (>20)' };
  }

  // Check for NaN or Infinity in weights
  const hasInvalidValues = Object.values(weights).some(val => {
    if (typeof val === 'number') {
      return !isFinite(val);
    }
    if (Array.isArray(val)) {
      return val.some(v => typeof v === 'number' && !isFinite(v));
    }
    return false;
  });

  if (hasInvalidValues) {
    return { valid: false, reason: 'Invalid values (NaN/Infinity) in weights' };
  }

  return { valid: true };
}
