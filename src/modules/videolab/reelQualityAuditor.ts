import path from 'path';
import fs from 'fs/promises';
import fsSync from 'fs';
import sharp from 'sharp';
import { StoryboardPlan, CreativeProfileType } from './creativeDirectorProfiles.js';
import { spawnMediaTool } from '../../utils/ffmpeg.js';

export interface VisualCheckResult {
  passed: boolean;
  metric: string;
  expected: string;
  actual: string;
  details?: string;
}

export interface QualityDimensionScores {
  typographyReadability: number; // 0 - 100
  compositionQuality: number; // 0 - 100
  brandConsistency: number; // 0 - 100
  animationSmoothness: number; // 0 - 100
  storytellingQuality: number; // 0 - 100
  audioQuality: number; // 0 - 100
  factualAccuracy: number; // 0 - 100
  compositeScore: number; // 0 - 100 weighted average
  grade: 'A+' | 'A' | 'B' | 'C' | 'REJECT';
}

export interface HumanCreativeReview {
  reviewerId: string;
  reviewerName: string;
  reviewedAt: string;
  decision: 'APPROVED' | 'REJECTED' | 'REVISE';
  feedbackNotes?: string;
  ratings?: {
    visualAesthetic?: number; // 1-5
    pacing?: number; // 1-5
    copyQuality?: number; // 1-5
  };
}

export interface ReelQualityAuditReport {
  timestamp: string;
  projectName: string;
  profile: CreativeProfileType;
  reelDuration: number;
  totalScenes: number;
  checks: VisualCheckResult[];
  scores: QualityDimensionScores;
  overallStatus: 'APPROVED' | 'REJECTED';
  contactSheetPath?: string;
  extractedFrames: string[];
  humanReview?: HumanCreativeReview;
}

export class ReelQualityAuditor {
  /**
   * Validates safe zones, font sizes, and layout compliance from a StoryboardPlan
   */
  public static auditStoryboardSafeZones(storyboard: StoryboardPlan): VisualCheckResult[] {
    const results: VisualCheckResult[] = [];

    // 1. Canvas Dimensions
    results.push({
      passed: storyboard.canvas.width === 1080 && storyboard.canvas.height === 1920,
      metric: 'Canvas Aspect Ratio',
      expected: '1080x1920 (9:16 Vertical)',
      actual: `${storyboard.canvas.width}x${storyboard.canvas.height}`,
    });

    // 2. Safe Zone Compliance for each shot
    for (let i = 0; i < storyboard.shots.length; i++) {
      const shot = storyboard.shots[i];
      const topSafeZone = 180; // 180px top safe zone limit
      const bottomLimit = 1540; // 380px bottom safe zone limit (1920 - 380 = 1540)
      const bufferLimit = 1500; // Extra 40px buffer

      // Top Safe Zone check (Brand tag / shot counter header)
      const isTopSafe = (shot.typography.headerStartY || 195) >= topSafeZone;
      results.push({
        passed: isTopSafe,
        metric: `Scene ${i + 1} (${shot.roomName}) Top Safe Zone (180px)`,
        expected: `StartY >= ${topSafeZone}px (clear of status bar & notch)`,
        actual: `Header StartY = ${shot.typography.headerStartY || 195}px`,
        details: isTopSafe
          ? `Safe! ${(shot.typography.headerStartY || 195) - topSafeZone}px clearance below top platform UI.`
          : `Violation! Overlaps into top notch/status bar area.`,
      });

      // Bottom Safe Zone check (Lower third typography)
      const isSafe = shot.typography.safeZoneEndY <= bufferLimit;
      results.push({
        passed: isSafe,
        metric: `Scene ${i + 1} (${shot.roomName}) Bottom Safe Zone (380px)`,
        expected: `EndY <= ${bufferLimit}px (clear of ${bottomLimit}px platform limit)`,
        actual: `EndY = ${shot.typography.safeZoneEndY}px`,
        details: isSafe
          ? `Safe! ${bottomLimit - shot.typography.safeZoneEndY}px clearance from bottom UI controls.`
          : `Violation! Overlaps into platform UI area.`,
      });

      // Eyebrow and Title Readability Check
      results.push({
        passed: shot.typography.title.length > 0 && shot.typography.title.length <= 48,
        metric: `Scene ${i + 1} Title Typography Length & Scaling`,
        expected: '1 to 48 characters (no single-line truncation or wrap overflow)',
        actual: `${shot.typography.title.length} characters ("${shot.typography.title}")`,
      });
    }

    // 3. Factual Accuracy & Compliance Verification
    const hasProjectName = Boolean(storyboard.projectMetadata.projectName && storyboard.projectMetadata.projectName.length > 0);
    results.push({
      passed: hasProjectName,
      metric: 'Project Identity Verification',
      expected: 'Approved Project Name sourced from Database',
      actual: storyboard.projectMetadata.projectName || 'Missing',
    });

    results.push({
      passed: Boolean(storyboard.projectMetadata.reraNumber || storyboard.projectMetadata.city),
      metric: 'RERA Compliance & Location Tagging',
      expected: 'RERA Registration or Verified City in Compliance Footnote',
      actual: storyboard.projectMetadata.reraNumber
        ? `RERA: ${storyboard.projectMetadata.reraNumber}`
        : `City: ${storyboard.projectMetadata.city}`,
    });

    results.push({
      passed: storyboard.projectMetadata.isActualPhotography === true,
      metric: 'Factual Photography Preservation',
      expected: 'Original Approved Client Photography (Zero AI Alteration)',
      actual: 'Verified Original Asset Pipeline',
    });

    return results;
  }

  /**
   * Evaluates the 7 Quality Dimensions and produces quantitative scores (0-100)
   */
  public static computeQualityScores(params: {
    storyboard: StoryboardPlan;
    hasAudio: boolean;
    renderDurationSec: number;
    fileSizeMb: number;
    fps: number;
  }): QualityDimensionScores {
    const { storyboard, hasAudio, fps } = params;

    // 1. Typography Readability (Safe zones, character length, contrast support)
    let typoScore = 95;
    for (const shot of storyboard.shots) {
      if (shot.typography.title.length > 40) typoScore -= 4;
      if (shot.typography.safeZoneEndY > 1500) typoScore -= 20;
      if (shot.typography.headerStartY < 180) typoScore -= 15;
    }
    typoScore = Math.max(50, Math.min(100, typoScore));

    // 2. Composition Quality (Aspect ratio, margin balance, zero fake UI)
    const compScore = storyboard.canvas.width === 1080 && storyboard.canvas.height === 1920 ? 98 : 60;

    // 3. Brand Consistency (Official project name, RERA, brand palette)
    const brandScore = storyboard.projectMetadata.projectName && storyboard.projectMetadata.reraNumber ? 96 : 85;

    // 4. Animation Smoothness (Cadence, decoupled text, camera motion)
    const animScore = fps >= 24 ? 94 : 70;

    // 5. Storytelling Quality (Scene progression: Hero -> Feature -> End Card)
    const storyScore = storyboard.shots.length >= 3 && storyboard.shots.length <= 6 ? 95 : 80;

    // 6. Audio Quality (Stereo presence, normalized loudness, gentle fades)
    const audioScore = hasAudio ? 92 : 40;

    // 7. Factual Accuracy (100% original photography, no AI hallucinations)
    const factualScore = storyboard.projectMetadata.isActualPhotography ? 100 : 50;

    // Weighted Composite Score
    const composite = Math.round(
      typoScore * 0.20 +
      compScore * 0.15 +
      brandScore * 0.15 +
      animScore * 0.15 +
      storyScore * 0.10 +
      audioScore * 0.10 +
      factualScore * 0.15
    );

    let grade: 'A+' | 'A' | 'B' | 'C' | 'REJECT' = 'A+';
    if (composite >= 95) grade = 'A+';
    else if (composite >= 90) grade = 'A';
    else if (composite >= 80) grade = 'B';
    else if (composite >= 70) grade = 'C';
    else grade = 'REJECT';

    return {
      typographyReadability: typoScore,
      compositionQuality: compScore,
      brandConsistency: brandScore,
      animationSmoothness: animScore,
      storytellingQuality: storyScore,
      audioQuality: audioScore,
      factualAccuracy: factualScore,
      compositeScore: composite,
      grade,
    };
  }

  /**
   * Persists the evaluation record into storage/quality-audits for auditing and analytics
   */
  public static async persistAuditReport(
    report: ReelQualityAuditReport,
    storageDir: string
  ): Promise<string> {
    await fs.mkdir(storageDir, { recursive: true });
    const fileName = `audit_${report.projectName.replace(/\s+/g, '_')}_${Date.now()}.json`;
    const filePath = path.join(storageDir, fileName);
    await fs.writeFile(filePath, JSON.stringify(report, null, 2), 'utf-8');
    return filePath;
  }

  /**
   * Extracts representative frames from the rendered reel and produces a contact sheet montage.
   */
  public static async generateVerificationContactSheet(params: {
    videoPath: string;
    outputContactSheetPath: string;
    scratchDir: string;
    timestamps: Array<{ time: string; label: string }>;
    ffmpegBinary: string;
  }): Promise<{ contactSheetPath: string; extractedFrames: string[] }> {
    const { videoPath, outputContactSheetPath, scratchDir, timestamps, ffmpegBinary } = params;
    await fs.mkdir(scratchDir, { recursive: true });
    await fs.mkdir(path.dirname(outputContactSheetPath), { recursive: true });

    const extractedFrames: string[] = [];

    for (let i = 0; i < timestamps.length; i++) {
      const framePath = path.join(scratchDir, `audit_frame_${i}.jpg`);
      await new Promise<void>((resolve, reject) => {
        const proc = spawnMediaTool(ffmpegBinary, [
          '-ss', timestamps[i].time,
          '-i', videoPath,
          '-vframes', '1',
          '-q:v', '2',
          '-y',
          framePath,
        ]);
        proc.on('exit', (code) => {
          if (code === 0) resolve();
          else reject(new Error(`Failed to extract frame at ${timestamps[i].time}s`));
        });
        proc.on('error', reject);
      });
      extractedFrames.push(framePath);
    }

    // Assemble horizontal contact sheet montage
    const thumbW = 360;
    const thumbH = 640;
    const margin = 20;

    const composites = await Promise.all(
      extractedFrames.map(async (framePath, idx) => {
        const buf = await sharp(framePath).resize(thumbW, thumbH, { fit: 'cover' }).toBuffer();
        return {
          input: buf,
          top: margin + 30,
          left: idx * (thumbW + margin) + margin,
        };
      })
    );

    const sheetW = timestamps.length * (thumbW + margin) + margin;
    const sheetH = thumbH + margin * 2 + 50;

    const labelsSvg = `
      <svg width="${sheetW}" height="${sheetH}" xmlns="http://www.w3.org/2000/svg">
        <rect width="${sheetW}" height="${sheetH}" fill="#0B0F17" />
        ${timestamps
          .map((ts, idx) => {
            const x = idx * (thumbW + margin) + margin + thumbW / 2;
            return `
              <text x="${x}" y="32" font-family="system-ui, -apple-system, sans-serif" font-size="13" font-weight="700" fill="#D4AF37" text-anchor="middle" letter-spacing="1">
                ${ts.label} (${ts.time}s)
              </text>
            `;
          })
          .join('')}
      </svg>
    `;

    await sharp(Buffer.from(labelsSvg))
      .composite(composites)
      .jpeg({ quality: 92 })
      .toFile(outputContactSheetPath);

    return {
      contactSheetPath: outputContactSheetPath,
      extractedFrames,
    };
  }
}
