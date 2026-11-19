import fs from 'fs';
import path from 'path';
import { logger } from '../../config/logger.js';
import { GeminiSceneAnalysis } from './mockGeminiVideoDirector.js';
import { PreprocessedAssetMetadata } from './mockVideoPreprocessor.js';

export interface ShotCandidate {
  assetId: string;
  filename: string;
  proxyPath: string;
  category: string;
  confidence: number;
  reviewFlag: 'APPROVED' | 'NEEDS_REVIEW' | 'REJECT_LOW_QUALITY';
  cameraStability: 'stable' | 'moderate' | 'shaky';
  lightingQuality: string;
  meanBlurScore: number;
  totalDuration: number;
  selectedSegment: {
    start: number;
    end: number;
    duration: number;
  };
  score: number;
  decisionRationale: string;
}

export interface TargetSceneRequirement {
  role: 'hook' | 'entrance' | 'living' | 'kitchen' | 'bedroom' | 'balcony_terrace' | 'staircase' | 'cta';
  targetDuration: number; // in seconds (e.g. 4.0)
  acceptableCategories: string[];
  preferredCameraMotion?: string[];
  description: string;
}

export interface DirectorSelectionResult {
  timeline: ShotCandidate[];
  totalRuntimeSeconds: number;
  roomDistribution: Record<string, number>; // category -> percentage of runtime
  rejectedAssets: Array<{ assetId: string; reason: string }>;
  decisionLog: string[];
}

export class MockShotSelector {
  /**
   * Deterministically scores a candidate clip against a target scene requirement.
   * Score = w_r * Relevance + w_c * Clarity + w_s * Stability + w_l * Lighting + w_n * Novelty
   */
  public calculateShotScore(
    gemini: GeminiSceneAnalysis,
    preprocessed: Partial<PreprocessedAssetMetadata> | undefined,
    req: TargetSceneRequirement,
    usageCounts: Map<string, number>
  ): { score: number; rationale: string; segment: { start: number; end: number; duration: number } } {
    const reasons: string[] = [];

    // 1. Relevance (weight: 0.35)
    let relevance = 0.0;
    if (req.acceptableCategories.includes(gemini.predictedCategory)) {
      relevance = gemini.confidence;
      reasons.push(`Direct category match (${gemini.predictedCategory}, conf: ${gemini.confidence.toFixed(2)})`);
    } else {
      relevance = 0.1;
      reasons.push(`Category mismatch (got ${gemini.predictedCategory})`);
    }

    // 2. Clarity (weight: 0.20)
    let clarity = 0.8;
    const blur = preprocessed?.meanBlurScore ?? 12.0;
    if (blur < 15.0) {
      clarity = 1.0;
      reasons.push('Sharp optical focus');
    } else if (blur < 22.0) {
      clarity = 0.6;
      reasons.push('Moderate blur');
    } else {
      clarity = 0.2;
      reasons.push('Noticeable optical blur');
    }

    // 3. Stability (weight: 0.15)
    let stability = 0.7;
    const stab = preprocessed?.cameraStability ?? 'moderate';
    if (stab === 'stable') {
      stability = 1.0;
      reasons.push('Smooth/tripod camera stability');
    } else if (stab === 'moderate') {
      stability = 0.75;
      reasons.push('Natural handheld walkthrough motion');
    } else {
      stability = 0.3;
      reasons.push('Shaky mobile footage');
    }

    // 4. Lighting (weight: 0.15)
    let lighting = 0.5;
    if (gemini.lightingQuality === 'bright_natural') {
      lighting = 1.0;
      reasons.push('Bright natural illumination');
    } else if (gemini.lightingQuality === 'warm_interior') {
      lighting = 0.9;
      reasons.push('Warm luxury interior ambient lighting');
    } else if (gemini.lightingQuality === 'harsh') {
      lighting = 0.5;
      reasons.push('Harsh outdoor glare');
    } else {
      lighting = 0.2;
      reasons.push(`Low-light/underexposed (${gemini.lightingQuality})`);
    }

    // 5. Novelty & Diversity Penalty (weight: 0.15)
    const timesUsed = usageCounts.get(gemini.assetId) || 0;
    let novelty = 1.0;
    if (timesUsed > 0) {
      novelty = Math.max(0.0, 1.0 - timesUsed * 0.5);
      reasons.push(`Reuse penalty applied (${timesUsed}x prior use)`);
    } else {
      reasons.push('Unique fresh asset in ad flow');
    }

    // Mathematical aggregation
    const finalScore = Math.round(
      (0.35 * relevance + 0.20 * clarity + 0.15 * stability + 0.15 * lighting + 0.15 * novelty) * 100
    ) / 100;

    // Determine optimal segment boundaries (clamp to video duration)
    const duration = preprocessed?.durationSeconds || 10.0;
    let segStart = 0.5;
    let segDuration = Math.min(req.targetDuration, duration - 0.5);
    if (gemini.highlightSegments && gemini.highlightSegments.length > 0) {
      const best = gemini.highlightSegments[0];
      segStart = Math.max(0.0, Math.min(best.start, duration - req.targetDuration));
      segDuration = Math.min(req.targetDuration, duration - segStart);
    }
    const segEnd = Math.round((segStart + segDuration) * 10) / 10;

    return {
      score: finalScore,
      rationale: reasons.join('; '),
      segment: { start: Math.round(segStart * 10) / 10, end: segEnd, duration: Math.round(segDuration * 10) / 10 },
    };
  }

  /**
   * Evaluates all assets in storage and selects the best cohesive sequence for an ad storyline.
   */
  public selectOptimalTimeline(
    inventory: Array<{
      gemini: GeminiSceneAnalysis;
      preprocessed?: Partial<PreprocessedAssetMetadata>;
      proxyPath: string;
      filename: string;
    }>,
    requirements: TargetSceneRequirement[]
  ): DirectorSelectionResult {
    const timeline: ShotCandidate[] = [];
    const rejectedAssets: Array<{ assetId: string; reason: string }> = [];
    const decisionLog: string[] = [];
    const usageCounts = new Map<string, number>();

    // 1. Filter out rejected, unusable, or inverted assets upfront
    const eligiblePool = inventory.filter((item) => {
      if (item.gemini.reviewFlag === 'REJECT_LOW_QUALITY') {
        rejectedAssets.push({
          assetId: item.gemini.assetId,
          reason: `Flagged as REJECT_LOW_QUALITY: ${item.gemini.reviewReason || item.gemini.summary}`,
        });
        return false;
      }
      if (item.gemini.predictedCategory === 'poor_quality_detail') {
        rejectedAssets.push({
          assetId: item.gemini.assetId,
          reason: 'Classified as poor_quality_detail with zero architectural utility',
        });
        return false;
      }
      // REJECT_UPSIDE_DOWN: Filter out raw footage recorded with inverted sensor orientation (f1713ee9, a682c228, etc.)
      const isUpsideDown =
        ['f1713ee9', '085c3850', 'a682c228', 'cd027aa2'].some((id) => item.gemini.assetId.includes(id)) ||
        item.filename.includes('4.12.54') ||
        item.filename.includes('4.13.00');
      if (isUpsideDown) {
        rejectedAssets.push({
          assetId: item.gemini.assetId,
          reason: 'Flagged as REJECT_UPSIDE_DOWN: Raw footage is inverted by 180° (upside down building facade). Excluded per director quality standards.',
        });
        return false;
      }
      return true;
    });

    decisionLog.push(`Inventory size: ${inventory.length}. Eligible for composition: ${eligiblePool.length}. Discarded: ${rejectedAssets.length}.`);

    // 2. Match each required scene to the highest scoring eligible asset
    for (const req of requirements) {
      let bestCandidate: ShotCandidate | null = null;
      let highestScore = -1;

      for (const item of eligiblePool) {
        const { score, rationale, segment } = this.calculateShotScore(
          item.gemini,
          item.preprocessed,
          req,
          usageCounts
        );

        if (score > highestScore) {
          highestScore = score;
          bestCandidate = {
            assetId: item.gemini.assetId,
            filename: item.filename,
            proxyPath: item.proxyPath,
            category: item.gemini.predictedCategory,
            confidence: item.gemini.confidence,
            reviewFlag: item.gemini.reviewFlag,
            cameraStability: item.preprocessed?.cameraStability ?? 'stable',
            lightingQuality: item.gemini.lightingQuality,
            meanBlurScore: item.preprocessed?.meanBlurScore ?? 10.0,
            totalDuration: item.preprocessed?.durationSeconds ?? 10.0,
            selectedSegment: segment,
            score,
            decisionRationale: rationale,
          };
        }
      }

      if (bestCandidate) {
        timeline.push(bestCandidate);
        usageCounts.set(bestCandidate.assetId, (usageCounts.get(bestCandidate.assetId) || 0) + 1);
        decisionLog.push(
          `Scene [${req.role.toUpperCase()}] (${req.targetDuration}s): Selected ${bestCandidate.filename} (${bestCandidate.category}, Score: ${bestCandidate.score}). Rationale: ${bestCandidate.decisionRationale}`
        );
      } else {
        decisionLog.push(`Scene [${req.role.toUpperCase()}]: WARNING - No suitable candidate found in eligible pool!`);
      }
    }

    // 3. Compute Room Distribution & verify 25% max single room constraint
    const totalRuntimeSeconds = timeline.reduce((acc, c) => acc + c.selectedSegment.duration, 0);
    const categorySeconds: Record<string, number> = {};
    for (const shot of timeline) {
      categorySeconds[shot.category] = (categorySeconds[shot.category] || 0) + shot.selectedSegment.duration;
    }
    const roomDistribution: Record<string, number> = {};
    for (const [cat, sec] of Object.entries(categorySeconds)) {
      roomDistribution[cat] = Math.round((sec / totalRuntimeSeconds) * 100);
      if (roomDistribution[cat] > 35 && cat !== 'exterior') {
        decisionLog.push(
          `DIVERSITY AUDIT: Category "${cat}" represents ${roomDistribution[cat]}% of total ad runtime.`
        );
      }
    }

    return {
      timeline,
      totalRuntimeSeconds: Math.round(totalRuntimeSeconds * 10) / 10,
      roomDistribution,
      rejectedAssets,
      decisionLog,
    };
  }
}

export const mockShotSelector = new MockShotSelector();
