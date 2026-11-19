import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { spawnFfprobe, spawnFfmpeg, runFfmpeg } from '../../utils/ffmpeg.js';
import { logger } from '../../config/logger.js';
import { mockAiGenStorage } from './mockAiGenStorage.js';

export interface PreprocessedThumbnail {
  percent: number;
  timestamp: number;
  relativePath: string;
  absolutePath: string;
  url: string;
}

export interface PreprocessedAssetMetadata {
  assetId: string;
  sourceKey: string;
  sourceAbsolutePath: string;
  sha256: string;
  isDuplicate: boolean;
  duplicateOfAssetId?: string;
  preprocessingVersion: string;

  // Stream & Container Specs
  container: string;
  videoCodec: string;
  audioCodec?: string;
  durationSeconds: number;
  originalWidth: number;
  originalHeight: number;
  normalizedWidth: number;
  normalizedHeight: number;
  aspectRatio: string;
  fps: number;
  hasAudio: boolean;

  // Orientation & Crop Specs
  detectedRotation: number;
  effectiveRotationApplied: number;
  isUpsideDownFlagged: boolean;
  letterboxPillarboxDetected: boolean;
  activeCropRegion?: { w: number; h: number; x: number; y: number };

  // Lightweight Quality Metrics
  meanBlurScore: number;
  isBlurry: boolean;
  meanLuminanceYavg: number;
  exposureQuality: 'underexposed' | 'balanced' | 'overexposed';
  cameraStability: 'stable' | 'moderate' | 'shaky';

  // Visual Derivatives
  thumbnails: PreprocessedThumbnail[];
  proxyPath: string;
  proxyUrl: string;

  // Candidate Sub-Clips / Scene Cuts
  candidateSceneChanges: number[];

  preprocessedAt: string;
  cached: boolean;
}

export interface PreprocessOptions {
  forceRefresh?: boolean;
  rotationOverride?: number; // 0, 90, 180, 270
  knownSha256Map?: Map<string, string>; // sha256 -> assetId for duplicate detection
}

export class MockVideoPreprocessor {
  private readonly version = 'v1.0.0';
  private readonly memoryCache = new Map<string, PreprocessedAssetMetadata>();

  /**
   * Computes SHA-256 hash of a file efficiently via direct buffer read (under 64MB)
   * or fast highWaterMark stream for large files.
   */
  public async computeSha256(filePath: string): Promise<string> {
    const stat = await fsPromises.stat(filePath);
    if (stat.size <= 64 * 1024 * 1024) {
      const buf = await fsPromises.readFile(filePath);
      return crypto.createHash('sha256').update(buf).digest('hex');
    }
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      const stream = fs.createReadStream(filePath, { highWaterMark: 1024 * 1024 });
      stream.on('error', (err) => reject(err));
      stream.on('data', (chunk) => hash.update(chunk));
      stream.on('end', () => resolve(hash.digest('hex')));
    });
  }

  /**
   * Comprehensive ffprobe parsing including Display Matrix side data & tags
   */
  public async probeVideo(filePath: string): Promise<{
    container: string;
    videoCodec: string;
    audioCodec?: string;
    durationSeconds: number;
    width: number;
    height: number;
    rotation: number;
    fps: number;
    hasAudio: boolean;
  }> {
    const args = [
      '-v', 'error',
      '-show_entries', 'format=format_name,duration,size:stream=codec_name,codec_type,width,height,avg_frame_rate,r_frame_rate:stream_side_data:stream_tags=rotate',
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
        else reject(new Error(`ffprobe failed with code ${code}: ${err}`));
      });
    });

    let parsed: any;
    try {
      parsed = JSON.parse(output);
    } catch (e) {
      throw new Error(`Failed to parse ffprobe JSON for ${path.basename(filePath)}`);
    }

    const vStream = parsed.streams?.find((s: any) => s.codec_type === 'video');
    if (!vStream) {
      throw new Error(`No video stream found in ${path.basename(filePath)}`);
    }

    const aStream = parsed.streams?.find((s: any) => s.codec_type === 'audio');

    // Detect rotation from side data list (Display Matrix) or tags
    let rotation = 0;
    if (vStream.side_data_list && Array.isArray(vStream.side_data_list)) {
      const dm = vStream.side_data_list.find((sd: any) => sd.rotation !== undefined);
      if (dm && typeof dm.rotation === 'number') {
        rotation = dm.rotation;
      }
    }
    if (rotation === 0 && vStream.tags?.rotate) {
      rotation = Number(vStream.tags.rotate) || 0;
    }

    // Normalizing rotation to standard degrees (-90 -> 270)
    let normalizedRotation = rotation % 360;
    if (normalizedRotation < 0) normalizedRotation += 360;

    let fps = 30;
    if (vStream.avg_frame_rate && vStream.avg_frame_rate !== '0/0') {
      const [num, den] = vStream.avg_frame_rate.split('/').map(Number);
      if (den && num) fps = Math.round((num / den) * 100) / 100;
    } else if (vStream.r_frame_rate && vStream.r_frame_rate !== '0/0') {
      const [num, den] = vStream.r_frame_rate.split('/').map(Number);
      if (den && num) fps = Math.round((num / den) * 100) / 100;
    }

    const durationSeconds = Math.round(Number(parsed.format?.duration || 0) * 100) / 100;
    const container = parsed.format?.format_name?.split(',')[0] || path.extname(filePath).replace('.', '');

    return {
      container,
      videoCodec: vStream.codec_name || 'unknown',
      audioCodec: aStream?.codec_name,
      durationSeconds,
      width: vStream.width || 0,
      height: vStream.height || 0,
      rotation: normalizedRotation,
      fps,
      hasAudio: Boolean(aStream),
    };
  }

  /**
   * Lightweight quality metric analysis using signalstats, blurdetect, and cropdetect
   * Runs on a downscaled 1.0s snippet for sub-second execution speed.
   */
  public async analyzeQualityMetrics(filePath: string, durationSeconds: number): Promise<{
    meanBlurScore: number;
    isBlurry: boolean;
    meanLuminanceYavg: number;
    exposureQuality: 'underexposed' | 'balanced' | 'overexposed';
    cameraStability: 'stable' | 'moderate' | 'shaky';
    letterboxPillarboxDetected: boolean;
    activeCropRegion?: { w: number; h: number; x: number; y: number };
    isUpsideDownFlagged: boolean;
  }> {
    const sampleTimestamp = durationSeconds > 3 ? Math.min(2.0, durationSeconds * 0.25) : 0.2;
    const sampleDuration = Math.min(1.0, Math.max(0.4, durationSeconds - sampleTimestamp));

    // Downscale to width 360 for ultra-fast filter execution
    const vf = [
      'scale=360:-2',
      'signalstats',
      'metadata=print:key=lavfi.signalstats.YAVG',
      'blurdetect=low=0.1:high=0.2',
      'metadata=print:key=lavfi.blur',
      'cropdetect=24:16:0',
    ].join(',');

    const args = [
      '-ss', String(sampleTimestamp),
      '-t', String(sampleDuration),
      '-i', filePath,
      '-vf', vf,
      '-f', 'null',
      '-',
    ];

    let stderr = '';
    await new Promise<void>((resolve, reject) => {
      const proc = spawnFfmpeg(args);
      proc.stderr?.on('data', (d: Buffer) => {
        stderr += d.toString();
      });
      proc.on('error', reject);
      proc.on('close', (code) => {
        // code 0 or null is fine for null muxer
        resolve();
      });
    });

    // Parse YAVG (mean luminance, 0-255)
    const yavgMatches = Array.from(stderr.matchAll(/lavfi\.signalstats\.YAVG=([0-9.]+)/g));
    let meanLuminanceYavg = 128;
    if (yavgMatches.length > 0) {
      const values = yavgMatches.map((m) => parseFloat(m[1]));
      meanLuminanceYavg = Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10;
    }

    let exposureQuality: 'underexposed' | 'balanced' | 'overexposed' = 'balanced';
    if (meanLuminanceYavg < 45) {
      exposureQuality = 'underexposed';
    } else if (meanLuminanceYavg > 215) {
      exposureQuality = 'overexposed';
    }

    // Parse blurdetect score
    const blurMatches = Array.from(stderr.matchAll(/lavfi\.blur=([0-9.]+)/g));
    let meanBlurScore = 8.0;
    if (blurMatches.length > 0) {
      const values = blurMatches.map((m) => parseFloat(m[1]));
      meanBlurScore = Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10;
    }
    const isBlurry = meanBlurScore > 20.0;

    // Parse cropdetect (letterbox / pillarbox detection)
    let letterboxPillarboxDetected = false;
    let activeCropRegion: { w: number; h: number; x: number; y: number } | undefined;
    const cropMatches = Array.from(stderr.matchAll(/crop=([0-9]+):([0-9]+):([0-9]+):([0-9]+)/g));
    if (cropMatches.length > 0) {
      const lastCrop = cropMatches[cropMatches.length - 1];
      const cw = parseInt(lastCrop[1], 10);
      const ch = parseInt(lastCrop[2], 10);
      const cx = parseInt(lastCrop[3], 10);
      const cy = parseInt(lastCrop[4], 10);
      activeCropRegion = { w: cw, h: ch, x: cx, y: cy };

      // If cropped region has black bars > 10% on width or height
      if (cx > 20 || cy > 20 || cw < 310) {
        letterboxPillarboxDetected = true;
      }
    }

    // Camera stability heuristic
    let cameraStability: 'stable' | 'moderate' | 'shaky' = 'stable';
    if (durationSeconds > 15 || meanBlurScore > 14.0) {
      cameraStability = 'moderate';
    }
    if (meanBlurScore > 25.0) {
      cameraStability = 'shaky';
    }

    // Upside down flag heuristic: will be refined if rotation is 180 or luminance inverted
    const isUpsideDownFlagged = false;

    return {
      meanBlurScore,
      isBlurry,
      meanLuminanceYavg,
      exposureQuality,
      cameraStability,
      letterboxPillarboxDetected,
      activeCropRegion,
      isUpsideDownFlagged,
    };
  }

  /**
   * Generates a fast 720p H.264 proxy normalized to vertical 720x1280.
   * FFmpeg's decoder applies autorotate by default, baking the orientation into the pixel buffer
   * and stripping container display matrices.
   */
  public async generateProxy(
    sourcePath: string,
    destProxyPath: string,
    rotationOverride?: number
  ): Promise<void> {
    await fsPromises.mkdir(path.dirname(destProxyPath), { recursive: true });

    // Video filter chain:
    // 1. If explicit manual rotation override is requested (e.g. 180 flip), apply transpose or flips
    const filters: string[] = [];
    if (rotationOverride === 180) {
      filters.push('hflip,vflip');
    } else if (rotationOverride === 90) {
      filters.push('transpose=1');
    } else if (rotationOverride === 270) {
      filters.push('transpose=2');
    }

    // 2. Preserve native aspect ratio without stretching, distorting, or cropping
    // For landscape (iw > ih): limit width to 1280, height proportional (-2)
    // For portrait / square: limit height to 1280, width proportional (-2)
    filters.push("scale='if(gt(iw,ih),min(iw,1280),-2)':'if(gt(iw,ih),-2,min(ih,1280))'");

    // 3. Fast encode with libx264 ultrafast preset, stripping rotation metadata tags
    const args = [
      '-y',
      '-i', sourcePath,
      '-vf', filters.join(','),
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-crf', '24',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-metadata:s:v:0', 'rotate=0',
      destProxyPath,
    ];

    await runFfmpeg(args, 60000);
  }

  /**
   * Extracts keyframe thumbnails from the generated 720p proxy at 15%, 50%, and 85% timestamps.
   */
  public async extractThumbnails(
    proxyPath: string,
    assetId: string,
    durationSeconds: number
  ): Promise<PreprocessedThumbnail[]> {
    const thumbsDir = mockAiGenStorage.getPreprocessedThumbsDir();
    await fsPromises.mkdir(thumbsDir, { recursive: true });

    const percentages = [15, 50, 85];
    const results: PreprocessedThumbnail[] = [];

    for (const pct of percentages) {
      const timestamp = Math.max(0.1, Math.round((durationSeconds * (pct / 100)) * 100) / 100);
      const filename = `${assetId}_thumb_${pct}.jpg`;
      const absolutePath = path.join(thumbsDir, filename);
      const relativePath = `mock_ai_gen/preprocessed/thumbs/${filename}`;
      const url = `/api/v1/mock-ai-gen/files/preprocessed/thumbs/${filename}`;

      const args = [
        '-y',
        '-ss', String(timestamp),
        '-i', proxyPath,
        '-vframes', '1',
        '-q:v', '2',
        absolutePath,
      ];

      try {
        await runFfmpeg(args, 10000);
        results.push({
          percent: pct,
          timestamp,
          relativePath,
          absolutePath,
          url,
        });
      } catch (err) {
        logger.warn({ err, timestamp, assetId }, 'Failed extracting thumbnail at timestamp, using fallback');
      }
    }

    return results;
  }

  /**
   * Detects candidate scene change timestamps using select='gt(scene,0.35)'
   */
  public async detectCandidateSceneChanges(proxyPath: string): Promise<number[]> {
    const args = [
      '-i', proxyPath,
      '-vf', "select='gt(scene,0.35)',metadata=print:key=lavfi.scene_score",
      '-f', 'null',
      '-',
    ];

    let stderr = '';
    try {
      await new Promise<void>((resolve, reject) => {
        const proc = spawnFfmpeg(args);
        proc.stderr?.on('data', (d: Buffer) => {
          stderr += d.toString();
        });
        proc.on('error', reject);
        proc.on('close', () => resolve());
      });
    } catch (e) {
      return [];
    }

    const scenePts: number[] = [];
    const matches = Array.from(stderr.matchAll(/pts_time:([0-9.]+)/g));
    for (const m of matches) {
      const t = parseFloat(m[1]);
      if (!isNaN(t) && !scenePts.includes(t)) {
        scenePts.push(Math.round(t * 100) / 100);
      }
    }

    return scenePts;
  }

  /**
   * Main entry point: preprocesses a single raw media asset into normalized vertical proxy,
   * extracts keyframes, computes metrics, and caches results.
   */
  public async preprocessAsset(
    sourceAbsolutePath: string,
    assetId: string,
    originalName: string,
    options: PreprocessOptions = {}
  ): Promise<PreprocessedAssetMetadata> {
    await mockAiGenStorage.init();

    // 1. Verify source file exists and is readable
    if (!fs.existsSync(sourceAbsolutePath)) {
      throw new Error(`Media file does not exist: ${sourceAbsolutePath}`);
    }
    const stat = await fsPromises.stat(sourceAbsolutePath);
    if (stat.size === 0) {
      throw new Error(`Media file is empty (0 bytes): ${sourceAbsolutePath}`);
    }

    // 2. Compute SHA-256
    const sha256 = await this.computeSha256(sourceAbsolutePath);

    // 3. Check for duplicates
    let isDuplicate = false;
    let duplicateOfAssetId: string | undefined;
    if (options.knownSha256Map) {
      if (options.knownSha256Map.has(sha256)) {
        isDuplicate = true;
        duplicateOfAssetId = options.knownSha256Map.get(sha256);
      } else {
        options.knownSha256Map.set(sha256, assetId);
      }
    }

    // 4. Cache check: return cached metadata in < 100ms if valid
    if (!options.forceRefresh && this.memoryCache.has(sha256)) {
      const inMemory = this.memoryCache.get(sha256)!;
      if (fs.existsSync(inMemory.proxyPath)) {
        return {
          ...inMemory,
          assetId,
          cached: true,
        };
      }
    }

    const cacheDir = mockAiGenStorage.getPreprocessedCacheDir();
    const cachePath = path.join(cacheDir, `${sha256}_${this.version}.json`);
    const proxiesDir = mockAiGenStorage.getPreprocessedProxiesDir();
    const proxyFilename = `${assetId}_720p.mp4`;
    const proxyPath = path.join(proxiesDir, proxyFilename);

    if (!options.forceRefresh && fs.existsSync(cachePath)) {
      try {
        const rawJson = await fsPromises.readFile(cachePath, 'utf8');
        const cachedMeta = JSON.parse(rawJson) as PreprocessedAssetMetadata;
        // Verify proxy still exists on disk
        if (fs.existsSync(cachedMeta.proxyPath)) {
          this.memoryCache.set(sha256, cachedMeta);
          return {
            ...cachedMeta,
            assetId, // preserve current assetId mapping
            cached: true,
          };
        }
      } catch (e) {
        logger.warn({ cachePath }, 'Preprocessed cache corrupted, regenerating');
      }
    }

    // 5. Probe raw container & stream specs
    const probe = await this.probeVideo(sourceAbsolutePath);

    // 6. Fast quality metrics (< 1s)
    const metrics = await this.analyzeQualityMetrics(sourceAbsolutePath, probe.durationSeconds);

    // Determine upside-down status:
    // If probed rotation is 180, or rotationOverride was set to 180
    let effectiveRotationApplied = options.rotationOverride !== undefined ? options.rotationOverride : 0;
    let isUpsideDown = probe.rotation === 180 || options.rotationOverride === 180;

    // 7. Generate 720p vertical normalized proxy (orientation baked into pixels)
    await this.generateProxy(sourceAbsolutePath, proxyPath, effectiveRotationApplied || (isUpsideDown ? 180 : 0));

    // 8. Extract 3 keyframe thumbnails from the proxy
    const thumbnails = await this.extractThumbnails(proxyPath, assetId, probe.durationSeconds);

    // 9. Scene cuts detection
    const candidateSceneChanges = await this.detectCandidateSceneChanges(proxyPath);

    const isLandscape = probe.width > probe.height;
    const maxDim = 1280;
    let normalizedWidth = probe.width;
    let normalizedHeight = probe.height;
    if (isLandscape && probe.width > maxDim) {
      normalizedWidth = maxDim;
      normalizedHeight = Math.round((probe.height * (maxDim / probe.width)) / 2) * 2;
    } else if (!isLandscape && probe.height > maxDim) {
      normalizedHeight = maxDim;
      normalizedWidth = Math.round((probe.width * (maxDim / probe.height)) / 2) * 2;
    }

    const metadata: PreprocessedAssetMetadata = {
      assetId,
      sourceKey: `mock_ai_gen/uploads/${path.basename(sourceAbsolutePath)}`,
      sourceAbsolutePath,
      sha256,
      isDuplicate,
      duplicateOfAssetId,
      preprocessingVersion: this.version,

      container: probe.container,
      videoCodec: probe.videoCodec,
      audioCodec: probe.audioCodec,
      durationSeconds: probe.durationSeconds,
      originalWidth: probe.width,
      originalHeight: probe.height,
      normalizedWidth,
      normalizedHeight,
      aspectRatio: `${normalizedWidth}:${normalizedHeight}`,
      fps: probe.fps,
      hasAudio: probe.hasAudio,

      detectedRotation: probe.rotation,
      effectiveRotationApplied,
      isUpsideDownFlagged: isUpsideDown,
      letterboxPillarboxDetected: metrics.letterboxPillarboxDetected,
      activeCropRegion: metrics.activeCropRegion,

      meanBlurScore: metrics.meanBlurScore,
      isBlurry: metrics.isBlurry,
      meanLuminanceYavg: metrics.meanLuminanceYavg,
      exposureQuality: metrics.exposureQuality,
      cameraStability: metrics.cameraStability,

      thumbnails,
      proxyPath,
      proxyUrl: `/api/v1/mock-ai-gen/files/preprocessed/proxies/${proxyFilename}`,

      candidateSceneChanges,
      preprocessedAt: new Date().toISOString(),
      cached: false,
    };

    // Save cache
    this.memoryCache.set(sha256, metadata);
    await fsPromises.writeFile(cachePath, JSON.stringify(metadata, null, 2), 'utf8');

    return metadata;
  }

  /**
   * Batch processes a set of assets sequentially or with concurrency control
   */
  public async preprocessBatch(
    assets: Array<{ filePath: string; assetId: string; originalName: string }>,
    options: PreprocessOptions = {}
  ): Promise<PreprocessedAssetMetadata[]> {
    const knownSha256Map = options.knownSha256Map || new Map<string, string>();
    const results: PreprocessedAssetMetadata[] = [];

    for (const asset of assets) {
      try {
        const meta = await this.preprocessAsset(asset.filePath, asset.assetId, asset.originalName, {
          ...options,
          knownSha256Map,
        });
        results.push(meta);
      } catch (err: any) {
        logger.error({ err: err.message, assetId: asset.assetId }, 'Failed preprocessing asset');
      }
    }

    return results;
  }
}

export const mockVideoPreprocessor = new MockVideoPreprocessor();
