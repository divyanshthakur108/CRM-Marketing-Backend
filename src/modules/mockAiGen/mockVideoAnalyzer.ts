import path from 'path';
import fs from 'fs';
import fsPromises from 'fs/promises';
import { runFfmpeg, spawnFfprobe } from '../../utils/ffmpeg.js';
import { logger } from '../../config/logger.js';
import { mockAiGenStorage } from './mockAiGenStorage.js';

export interface AnalyzedVideoMetadata {
  assetId: string;
  originalName: string;
  cleanName: string;
  storageKey: string;
  absolutePath: string;
  url: string;
  thumbnailUrl: string;
  thumbnailPath: string;
  sizeBytes: number;
  durationSeconds: number;
  width: number;
  height: number;
  aspectRatio: string;
  orientation: 'portrait' | 'landscape' | 'square';
  rotation: number;
  fps: number;
  hasAudio: boolean;
  stability: 'stable' | 'moderate' | 'shaky';
  lighting: 'balanced' | 'underexposed' | 'overexposed';
  qualityScore: number; // 1-10
  inferredRoom: string;
  inferredConfidence: number; // 0-1
  userRoomOverride?: string;
  classification: 'ACTUAL' | 'ILLUSTRATIVE';
  highlightSegments: Array<{
    start: number;
    end: number;
    duration: number;
    description: string;
    score: number;
  }>;
  bestAdvertisingShot: {
    start: number;
    end: number;
    rationale: string;
  };
  analyzedAt: string;
}

export class MockVideoAnalyzer {
  /**
   * Probes raw video metadata using ffprobe
   */
  public async probeRawVideo(filePath: string): Promise<{
    durationSeconds: number;
    width: number;
    height: number;
    rotation: number;
    fps: number;
    hasAudio: boolean;
  }> {
    const args = [
      '-v', 'error',
      '-show_entries', 'format=duration,size:stream=codec_type,width,height,avg_frame_rate,r_frame_rate,side_data_list',
      '-of', 'json',
      filePath,
    ];

    const output = await new Promise<string>((resolve, reject) => {
      const proc = spawnFfprobe(args);
      let out = '';
      let err = '';
      proc.stdout?.on('data', (d: Buffer) => (out += d.toString()));
      proc.stderr?.on('data', (d: Buffer) => (err += d.toString()));
      proc.on('error', reject);
      proc.on('close', (code) => {
        if (code === 0) resolve(out);
        else reject(new Error(`ffprobe exited with code ${code}: ${err}`));
      });
    });

    const parsed = JSON.parse(output);
    const videoStream = parsed.streams?.find((s: any) => s.codec_type === 'video');
    const audioStream = parsed.streams?.find((s: any) => s.codec_type === 'audio');

    let rotation = 0;
    // Check rotation in side_data_list or stream tags
    if (videoStream?.side_data_list) {
      const rotationEntry = videoStream.side_data_list.find((sd: any) => sd.rotation !== undefined);
      if (rotationEntry) rotation = Math.abs(rotationEntry.rotation);
    }
    if (!rotation && videoStream?.tags?.rotate) {
      rotation = Math.abs(Number(videoStream.tags.rotate));
    }

    let fps = 30;
    if (videoStream?.avg_frame_rate) {
      const [num, den] = videoStream.avg_frame_rate.split('/').map(Number);
      if (den && num) fps = Math.round(num / den);
    }

    return {
      durationSeconds: Math.round(Number(parsed.format?.duration || 0) * 10) / 10,
      width: videoStream?.width || 1080,
      height: videoStream?.height || 1920,
      rotation,
      fps,
      hasAudio: Boolean(audioStream),
    };
  }

  /**
   * Generates a preview thumbnail frame from the video
   */
  public async extractThumbnail(videoPath: string, destPath: string, timestamp = 1.0): Promise<void> {
    await fsPromises.mkdir(path.dirname(destPath), { recursive: true });
    await runFfmpeg([
      '-y',
      '-ss', String(timestamp),
      '-i', videoPath,
      '-vframes', '1',
      '-q:v', '2',
      destPath,
    ]);
  }

  /**
   * Analyzes raw uploaded phone video footage for rotation, stability,
   * lighting, highlights, and room cues.
   */
  public async analyzeVideo(
    videoPath: string,
    assetId: string,
    originalName: string
  ): Promise<AnalyzedVideoMetadata> {
    const rawMeta = await this.probeRawVideo(videoPath);
    const stat = await fsPromises.stat(videoPath);

    // Swap dimensions if rotated 90 or 270 degrees
    let effectiveWidth = rawMeta.width;
    let effectiveHeight = rawMeta.height;
    if (rawMeta.rotation === 90 || rawMeta.rotation === 270) {
      effectiveWidth = rawMeta.height;
      effectiveHeight = rawMeta.width;
    }

    const orientation =
      effectiveHeight > effectiveWidth ? 'portrait' : effectiveWidth > effectiveHeight ? 'landscape' : 'square';
    const aspectRatio = `${effectiveWidth}:${effectiveHeight}`;

    // Extract thumbnail at ~1.5s (or middle if shorter than 3s)
    const thumbTime = Math.min(1.5, Math.max(0.5, rawMeta.durationSeconds / 2));
    const thumbName = `${assetId}_thumb.jpg`;
    const thumbsDir = path.join(mockAiGenStorage.getRoot(), 'thumbnails');
    await fsPromises.mkdir(thumbsDir, { recursive: true });
    const thumbPath = path.join(thumbsDir, thumbName);

    try {
      await this.extractThumbnail(videoPath, thumbPath, thumbTime);
    } catch (err) {
      logger.warn({ err, videoPath }, 'Could not extract thumbnail, using fallback');
    }

    // Heuristic room inferencing based on filename keywords or order
    const lowerName = originalName.toLowerCase();
    let inferredRoom = 'living';
    let inferredConfidence = 0.75;

    if (lowerName.includes('hall') || lowerName.includes('living') || lowerName.includes('lounge')) {
      inferredRoom = 'living';
      inferredConfidence = 0.92;
    } else if (lowerName.includes('kitchen') || lowerName.includes('cook') || lowerName.includes('pantry')) {
      inferredRoom = 'kitchen';
      inferredConfidence = 0.94;
    } else if (lowerName.includes('master') || lowerName.includes('bed1')) {
      inferredRoom = 'master';
      inferredConfidence = 0.91;
    } else if (lowerName.includes('bed2') || lowerName.includes('bed3') || lowerName.includes('bedroom')) {
      inferredRoom = 'bedroom2';
      inferredConfidence = 0.88;
    } else if (lowerName.includes('bath') || lowerName.includes('washroom') || lowerName.includes('toilet')) {
      inferredRoom = 'bath_master';
      inferredConfidence = 0.90;
    } else if (lowerName.includes('balcony') || lowerName.includes('view') || lowerName.includes('terrace_flat')) {
      inferredRoom = 'balcony';
      inferredConfidence = 0.89;
    } else if (lowerName.includes('roof') || lowerName.includes('terrace') || lowerName.includes('deck')) {
      inferredRoom = 'terrace';
      inferredConfidence = 0.87;
    } else if (lowerName.includes('ext') || lowerName.includes('exterior') || lowerName.includes('entry') || lowerName.includes('building')) {
      inferredRoom = 'exterior';
      inferredConfidence = 0.85;
    }

    // Compute duration-based highlight cuts (e.g. best 4-second chunk)
    const dur = rawMeta.durationSeconds;
    const highlightStart = dur > 6 ? 1.5 : 0;
    const highlightEnd = Math.min(dur, highlightStart + 4.5);

    const highlights = [
      {
        start: highlightStart,
        end: highlightEnd,
        duration: Math.round((highlightEnd - highlightStart) * 10) / 10,
        description: `Smooth architectural sweep across ${inferredRoom}`,
        score: 8.8,
      },
    ];

    if (dur > 10) {
      highlights.push({
        start: Math.round(dur * 0.6 * 10) / 10,
        end: Math.min(dur, Math.round((dur * 0.6 + 4.0) * 10) / 10),
        duration: 4.0,
        description: `Secondary detail reveal of ${inferredRoom}`,
        score: 8.2,
      });
    }

    return {
      assetId,
      originalName,
      cleanName: path.basename(videoPath),
      storageKey: `mock_ai_gen/uploads/${path.basename(videoPath)}`,
      absolutePath: videoPath,
      url: `/api/v1/mock-ai-gen/files/uploads/${path.basename(videoPath)}`,
      thumbnailUrl: `/api/v1/mock-ai-gen/files/thumbnails/${thumbName}`,
      thumbnailPath: thumbPath,
      sizeBytes: stat.size,
      durationSeconds: rawMeta.durationSeconds,
      width: effectiveWidth,
      height: effectiveHeight,
      aspectRatio,
      orientation,
      rotation: rawMeta.rotation,
      fps: rawMeta.fps,
      hasAudio: rawMeta.hasAudio,
      stability: rawMeta.durationSeconds > 15 ? 'moderate' : 'stable',
      lighting: 'balanced',
      qualityScore: 9,
      inferredRoom,
      inferredConfidence,
      classification: 'ACTUAL',
      highlightSegments: highlights,
      bestAdvertisingShot: {
        start: highlightStart,
        end: highlightEnd,
        rationale: 'Steady horizontal framing with clear natural lighting and zero structural occlusion.',
      },
      analyzedAt: new Date().toISOString(),
    };
  }
}

export const mockVideoAnalyzer = new MockVideoAnalyzer();
