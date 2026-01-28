import type { Listing } from '@shared/schema';
import { calculateQualityScore, type QualityScoreResult } from './quality-scorer';
import { extractFeatures, featuresToArray } from './ml-feature-extractor';
import { getActiveModel } from '../storage-ml';
import type { MlModelWeights } from '@shared/schema';

/**
 * ML-Enhanced Quality Scorer
 * Uses trained models to predict quality scores with fallback to default algorithm
 */

export class MLQualityScorer {
  /**
   * Calculate quality score using ML if available, with fallback to default
   */
  async calculateScore(listing: Partial<Listing>): Promise<QualityScoreResult> {
    try {
      // Try to get active ML model
      const model = await getActiveModel();

      if (!model) {
        // No active model - use default scorer
        return calculateQualityScore(listing);
      }

      // Use ML model to predict score
      const mlScore = await this.predictWithModel(listing, model);

      // Blend ML score with default score based on confidence
      const defaultResult = calculateQualityScore(listing);
      const confidence = this.calculateConfidence(model);

      // Blended score = ML * confidence + default * (1 - confidence)
      const blendedTotal = Math.round(mlScore * confidence + defaultResult.total * (1 - confidence));

      // Clamp to valid range [0, 160]
      const finalTotal = Math.max(0, Math.min(160, blendedTotal));

      // Determine tier based on final score
      const tier = this.getScoreTier(finalTotal);

      return {
        total: finalTotal,
        breakdown: defaultResult.breakdown, // Keep breakdown from default for transparency
        tier,
        isGoldFind: defaultResult.isGoldFind, // Gold find detection stays the same
      };
    } catch (error: any) {
      // On any error, fall back to default scorer
      console.error('[ML-SCORER] Error during ML prediction, falling back to default:', error.message);
      return calculateQualityScore(listing);
    }
  }

  /**
   * Predict score using a trained model
   */
  private async predictWithModel(listing: Partial<Listing>, model: MlModelWeights): Promise<number> {
    const features = extractFeatures(listing);

    if (model.algorithm === 'weighted_avg') {
      return this.predictWeightedAverage(listing, features, model.weights);
    } else if (model.algorithm === 'linear_regression') {
      return this.predictLinearRegression(features, model.weights);
    } else {
      throw new Error(`Unknown algorithm: ${model.algorithm}`);
    }
  }

  /**
   * Predict using weighted average model
   */
  private predictWeightedAverage(
    listing: Partial<Listing>,
    features: any,
    weights: any
  ): number {
    // Get base score from default algorithm
    const baseResult = calculateQualityScore(listing);

    // Apply learned multipliers
    const freshness = baseResult.breakdown.freshness * (weights.freshness_multiplier || 1.0);
    const completeness = baseResult.breakdown.completeness * (weights.completeness_multiplier || 1.0);
    const priceValue = baseResult.breakdown.priceValue * (weights.price_value_multiplier || 1.0);

    return freshness + completeness + priceValue;
  }

  /**
   * Predict using linear regression model (ensemble of feature models)
   */
  private predictLinearRegression(features: any, weights: any): number {
    const featureArray = featuresToArray(features);
    const featureWeights = weights.feature_weights || [];
    const models = weights.models || [];

    if (featureWeights.length !== featureArray.length || models.length !== featureArray.length) {
      throw new Error('Feature count mismatch between model and input');
    }

    // Ensemble prediction (weighted average of all feature predictions)
    let prediction = 0;
    for (let i = 0; i < featureArray.length; i++) {
      const featureValue = featureArray[i];
      const model = models[i];
      const weight = featureWeights[i];

      // Linear prediction: y = slope * x + intercept
      const featurePrediction = model.slope * featureValue + model.intercept;
      prediction += featurePrediction * weight;
    }

    return prediction;
  }

  /**
   * Calculate confidence in ML model based on training samples
   * More samples = higher confidence
   */
  private calculateConfidence(model: MlModelWeights): number {
    const sampleCount = model.training_samples;

    // Confidence formula: min(samples / 200, 1.0)
    // At 200+ samples, we have 100% confidence in ML
    // At 50 samples, we have 25% confidence
    // Below 50, weighted_avg is used which has different scaling
    const confidence = Math.min(sampleCount / 200, 1.0);

    return confidence;
  }

  /**
   * Get color tier based on total score
   */
  private getScoreTier(score: number): 'excellent' | 'good' | 'medium' | 'low' {
    if (score >= 80) return 'excellent';
    if (score >= 60) return 'good';
    if (score >= 40) return 'medium';
    return 'low';
  }
}

// Export singleton instance
export const mlScorer = new MLQualityScorer();
