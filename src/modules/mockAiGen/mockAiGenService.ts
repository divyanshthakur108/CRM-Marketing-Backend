import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';
import sharp from 'sharp';
import { logger } from '../../config/logger.js';
import {
  MockPropertyProject,
  MockPropertyProjectSchema,
  MockCampaign,
} from './mockPropertySchema.js';
import { mockAiGenStorage, StoredMockAsset } from './mockAiGenStorage.js';
import { mockRunwayClient, RunwayTaskResult } from './mockRunwayClient.js';
import { mockAdComposer, ComposedAdResult, isBannedAsset } from './mockAdComposer.js';
import { mockVideoAnalyzer, AnalyzedVideoMetadata } from './mockVideoAnalyzer.js';
import { mockVideoPreprocessor, PreprocessedAssetMetadata } from './mockVideoPreprocessor.js';
import { mockAiVideoDirector, DirectedStoryboardsResult } from './mockAiVideoDirector.js';
import { env } from '../../config/env.js';

export interface MockSlotMapping {
  slotId: string;
  assetId: string;
  areaId: string;
  fileName: string;
  url: string;
  mappedAt: string;
}

export interface MockAiGenState {
  project: MockPropertyProject;
  uploadedAssets: StoredMockAsset[];
  sourceVideos: AnalyzedVideoMetadata[];
  slotMappings: Record<string, MockSlotMapping>;
  logoAsset?: StoredMockAsset;
  runwayPilotClips: Record<string, RunwayTaskResult>;
  composedAds: Record<string, ComposedAdResult>;
}

export class MockAiGenService {
  private state: MockAiGenState | null = null;
  private fixturePath: string;
  private stateFilePath: string;

  constructor() {
    const directFixture = path.resolve(process.cwd(), 'mock_property_project.json');
    const backendFixture = path.resolve(process.cwd(), 'CRM-Marketing-Backend', 'mock_property_project.json');
    this.fixturePath = fs.existsSync(directFixture) ? directFixture : backendFixture;

    const directState = path.resolve(process.cwd(), 'storage', 'mock_ai_gen', 'state.json');
    const backendState = path.resolve(process.cwd(), 'CRM-Marketing-Backend', 'storage', 'mock_ai_gen', 'state.json');
    this.stateFilePath = fs.existsSync(backendState) ? backendState : directState;
  }

  private async persistState(): Promise<void> {
    if (!this.state) return;
    try {
      await fsPromises.mkdir(path.dirname(this.stateFilePath), { recursive: true });
      const serialized = {
        uploadedAssets: this.state.uploadedAssets,
        sourceVideos: this.state.sourceVideos,
        slotMappings: this.state.slotMappings,
        logoAsset: this.state.logoAsset,
        runwayPilotClips: this.state.runwayPilotClips,
        composedAds: this.state.composedAds,
        project: this.state.project,
      };
      await fsPromises.writeFile(this.stateFilePath, JSON.stringify(serialized, null, 2));
    } catch (err) {
      logger.warn({ err }, 'Failed to persist mock AI Gen state to disk');
    }
  }

  /**
   * Initializes the mock AI gen service by loading and validating the fixture,
   * restoring any saved state from disk, and auto-discovering uploaded files.
   */
  public async init(): Promise<MockPropertyProject> {
    await mockAiGenStorage.init();

    if (!fs.existsSync(this.fixturePath)) {
      throw new Error(`Fixture file not found at ${this.fixturePath}`);
    }

    const rawContent = await fsPromises.readFile(this.fixturePath, 'utf-8');
    const parsedJson = JSON.parse(rawContent);

    // Strict Zod validation
    const validatedProject = MockPropertyProjectSchema.parse(parsedJson);

    let savedState: Partial<MockAiGenState> = {};
    if (fs.existsSync(this.stateFilePath)) {
      try {
        const stateRaw = await fsPromises.readFile(this.stateFilePath, 'utf-8');
        savedState = JSON.parse(stateRaw);
      } catch (err) {
        logger.warn({ err }, 'Could not read existing state.json');
      }
    }

    this.state = {
      project: savedState.project || validatedProject,
      uploadedAssets: savedState.uploadedAssets || [],
      sourceVideos: savedState.sourceVideos || [],
      slotMappings: savedState.slotMappings || {},
      logoAsset: savedState.logoAsset,
      runwayPilotClips: savedState.runwayPilotClips || {},
      composedAds: savedState.composedAds || {},
    };

    // Auto-discover files on disk in storage/mock_ai_gen/uploads if not in state
    await this.syncUploadsFromDisk();

    // Sync sourceVideos into project object
    this.state.project.media.sourceVideos = this.state.sourceVideos as any;

    // Re-apply mappings to project object
    for (const [slotId, mapping] of Object.entries(this.state.slotMappings)) {
      const slot = this.state.project.media.assets.find((s) => s.id === slotId);
      if (slot) {
        slot.uploaded = true;
        slot.fileName = mapping.fileName;
        slot.storageAssetId = mapping.assetId;
      }
    }

    logger.info(
      {
        project: this.state.project.project.name,
        assets: this.state.uploadedAssets.length,
        videos: this.state.sourceVideos.length,
      },
      'MockAiGenService initialized'
    );
    return this.state.project;
  }

  /**
   * Scans uploads folder and indexes any files not currently indexed
   */
  private async syncUploadsFromDisk(): Promise<void> {
    if (!this.state) return;
    const uploadsDir = path.join(mockAiGenStorage.getRoot(), 'uploads');
    if (!fs.existsSync(uploadsDir)) return;

    try {
      const files = await fsPromises.readdir(uploadsDir);
      const indexedAssetKeys = new Set(this.state.uploadedAssets.map((a) => a.cleanName));
      const indexedVideoKeys = new Set(this.state.sourceVideos.map((v) => v.cleanName));

      for (const f of files) {
        const absPath = path.join(uploadsDir, f);
        const stat = await fsPromises.stat(absPath);
        if (stat.size < 1000) continue; // Skip empty files

        const isVideo = /\.(mp4|mov|m4v|webm)$/i.test(f);

        if (isVideo && !indexedVideoKeys.has(f)) {
          try {
            const assetId = path.parse(f).name;
            const videoMeta = await mockVideoAnalyzer.analyzeVideo(absPath, assetId, f);
            this.state.sourceVideos.push(videoMeta);
            indexedVideoKeys.add(f);
          } catch (err) {
            logger.warn({ err, f }, 'Could not auto-analyze existing video file');
          }
        } else if (!isVideo && !indexedAssetKeys.has(f) && (f.endsWith('.jpg') || f.endsWith('.jpeg') || f.endsWith('.png') || f.endsWith('.webp'))) {
          let width = 1080;
          let height = 1350;
          try {
            const meta = await sharp(absPath).metadata();
            if (meta.width) width = meta.width;
            if (meta.height) height = meta.height;
          } catch {}

          const assetId = path.parse(f).name;
          this.state.uploadedAssets.push({
            assetId,
            originalName: f,
            cleanName: f,
            storageKey: `mock_ai_gen/uploads/${f}`,
            absolutePath: absPath,
            url: `/api/v1/mock-ai-gen/files/uploads/${f}`,
            mimetype: f.endsWith('.png') ? 'image/png' : 'image/jpeg',
            sizeBytes: stat.size,
            width,
            height,
            hasExifGpsRemoved: true,
            uploadedAt: stat.mtime.toISOString(),
          });
          indexedAssetKeys.add(f);
        }
      }
      await this.persistState();
    } catch (err) {
      logger.warn({ err }, 'Error scanning uploads folder');
    }
  }

  public async getProject(): Promise<MockPropertyProject> {
    if (!this.state) await this.init();
    return this.state!.project;
  }

  public async getState(): Promise<MockAiGenState> {
    if (!this.state) await this.init();
    return this.state!;
  }

  /**
   * Updates and saves structured property JSON with strict Zod validation
   */
  public async updateProjectJson(newJson: any): Promise<MockPropertyProject> {
    if (!this.state) await this.init();

    const validated = MockPropertyProjectSchema.parse(newJson);
    this.state!.project = validated;
    await this.persistState();

    logger.info({ project: validated.project.name }, 'Updated mock property project JSON');
    return validated;
  }

  /**
   * Uploads a video file, strips EXIF, and triggers full video analysis
   */
  public async uploadVideo(
    buffer: Buffer,
    originalName: string,
    mimeType: string
  ): Promise<AnalyzedVideoMetadata> {
    if (!this.state) await this.init();

    const stored = await mockAiGenStorage.saveUploadedFile({
      buffer,
      originalname: originalName,
      mimetype: mimeType,
    });

    const analyzed = await mockVideoAnalyzer.analyzeVideo(
      stored.absolutePath,
      stored.assetId,
      originalName
    );

    if (env.FEATURE_AI_VIDEO_DIRECTOR) {
      try {
        const preprocessed = await mockVideoPreprocessor.preprocessAsset(
          stored.absolutePath,
          stored.assetId,
          originalName
        );
        (analyzed as any).preprocessed = preprocessed;
        // Point playback and preview to the normalized proxy
        analyzed.url = preprocessed.proxyUrl;
        if (preprocessed.thumbnails.length > 0) {
          analyzed.thumbnailUrl = preprocessed.thumbnails[0].url;
          analyzed.thumbnailPath = preprocessed.thumbnails[0].absolutePath;
        }
      } catch (err: any) {
        logger.warn({ err: err.message, assetId: stored.assetId }, 'Preprocessing failed, falling back to raw video');
      }
    }

    this.state!.sourceVideos.push(analyzed);
    this.state!.project.media.sourceVideos = this.state!.sourceVideos as any;
    await this.persistState();

    logger.info({ assetId: analyzed.assetId, name: originalName }, 'Uploaded and analyzed raw property video');
    return analyzed;
  }

  /**
   * Deterministically overrides rotation (e.g. 180° flip for upside-down footage)
   * and regenerates normalized 720p proxy and keyframe thumbnails.
   */
  public async rotateAsset(assetId: string, rotationOverride: number): Promise<AnalyzedVideoMetadata> {
    if (!this.state) await this.init();
    const video = this.state!.sourceVideos.find((v) => v.assetId === assetId);
    if (!video) throw new Error(`Video with assetId "${assetId}" not found in state.`);

    const preprocessed = await mockVideoPreprocessor.preprocessAsset(
      video.absolutePath,
      video.assetId,
      video.originalName,
      { forceRefresh: true, rotationOverride }
    );
    (video as any).preprocessed = preprocessed;
    video.url = preprocessed.proxyUrl;
    video.rotation = rotationOverride;
    if (preprocessed.thumbnails.length > 0) {
      video.thumbnailUrl = preprocessed.thumbnails[0].url;
      video.thumbnailPath = preprocessed.thumbnails[0].absolutePath;
    }
    await this.persistState();
    return video;
  }

  /**
   * Preprocesses all uploaded videos that do not yet have cached normalized proxies.
   */
  public async preprocessAllVideos(): Promise<PreprocessedAssetMetadata[]> {
    if (!this.state) await this.init();
    const results: PreprocessedAssetMetadata[] = [];
    const knownSha256Map = new Map<string, string>();

    for (const v of this.state!.sourceVideos) {
      try {
        const preprocessed = await mockVideoPreprocessor.preprocessAsset(
          v.absolutePath,
          v.assetId,
          v.originalName,
          { knownSha256Map }
        );
        (v as any).preprocessed = preprocessed;
        v.url = preprocessed.proxyUrl;
        if (preprocessed.thumbnails.length > 0) {
          v.thumbnailUrl = preprocessed.thumbnails[0].url;
          v.thumbnailPath = preprocessed.thumbnails[0].absolutePath;
        }
        results.push(preprocessed);
      } catch (err: any) {
        logger.warn({ err: err.message, assetId: v.assetId }, 'Failed to preprocess video in batch');
      }
    }
    await this.persistState();
    return results;
  }

  /**
   * Uploads an image asset (photo or logo) with EXIF stripping
   */
  public async uploadAsset(
    buffer: Buffer,
    originalName: string,
    mimeType: string,
    isLogo = false
  ): Promise<StoredMockAsset> {
    if (!this.state) await this.init();

    const stored = await mockAiGenStorage.saveUploadedFile({
      buffer,
      originalname: originalName,
      mimetype: mimeType,
    });

    if (isLogo) {
      this.state!.logoAsset = stored;
      this.state!.project.media.logo.uploaded = true;
      this.state!.project.media.logo.fileName = stored.cleanName;
      this.state!.project.media.logo.url = stored.url;
    } else {
      this.state!.uploadedAssets.push(stored);
    }

    await this.persistState();
    return stored;
  }

  /**
   * Manually updates/overrides AI-generated room classification & asset classification
   */
  public async updateAssetClassification(params: {
    assetId: string;
    userRoomOverride: string;
    classification: 'ACTUAL' | 'ILLUSTRATIVE';
  }): Promise<AnalyzedVideoMetadata | StoredMockAsset> {
    if (!this.state) await this.init();

    const video = this.state!.sourceVideos.find((v) => v.assetId === params.assetId);
    if (video) {
      video.userRoomOverride = params.userRoomOverride;
      video.classification = params.classification;
      await this.persistState();
      return video;
    }

    const photo = this.state!.uploadedAssets.find((a) => a.assetId === params.assetId);
    if (photo) {
      await this.persistState();
      return photo;
    }

    throw new Error(`Asset "${params.assetId}" not found`);
  }

  /**
   * Maps an uploaded asset to a specific room/area media slot in the fixture
   */
  public async mapAssetToSlot(slotId: string, assetId: string): Promise<MockSlotMapping> {
    if (!this.state) await this.init();

    const targetSlot = this.state!.project.media.assets.find((s) => s.id === slotId);
    if (!targetSlot) {
      throw new Error(`Media slot "${slotId}" does not exist in mock property project.`);
    }

    let fileName = '';
    let url = '';

    const uploadedAsset = this.state!.uploadedAssets.find((a) => a.assetId === assetId);
    const uploadedVideo = this.state!.sourceVideos.find((v) => v.assetId === assetId);

    if (uploadedAsset) {
      fileName = uploadedAsset.cleanName;
      url = uploadedAsset.url;
    } else if (uploadedVideo) {
      fileName = uploadedVideo.cleanName;
      url = uploadedVideo.url;
    } else {
      throw new Error(`Uploaded asset "${assetId}" not found in sandbox storage.`);
    }

    const mapping: MockSlotMapping = {
      slotId,
      assetId,
      areaId: targetSlot.areaId,
      fileName,
      url,
      mappedAt: new Date().toISOString(),
    };

    this.state!.slotMappings[slotId] = mapping;
    targetSlot.uploaded = true;
    targetSlot.fileName = fileName;
    targetSlot.storageAssetId = assetId;

    await this.persistState();
    logger.info({ slotId, assetId, areaId: targetSlot.areaId }, 'Mapped asset to slot');
    return mapping;
  }

  /**
   * Auto-maps uploaded photos and videos across unmapped room slots by room matching
   */
  public async autoMapSlots(): Promise<Record<string, MockSlotMapping>> {
    if (!this.state) await this.init();
    const assets = this.state!.uploadedAssets;
    const videos = this.state!.sourceVideos;
    const pool = [...videos, ...assets];

    if (pool.length === 0) {
      throw new Error('No photos or videos have been uploaded yet. Please upload media first.');
    }

    const slots = this.state!.project.media.assets;
    const usedAssetIds = new Set<string>();

    // If FEATURE_AI_VIDEO_DIRECTOR is enabled, use verified Gemini evidence rather than regex/slot order
    if (env.FEATURE_AI_VIDEO_DIRECTOR) {
      try {
        const inventory = await mockAiVideoDirector.loadAnalyzedInventory();
        const eligibleInventory = inventory.filter(
          (inv) =>
            inv.gemini.reviewFlag !== 'REJECT_LOW_QUALITY' &&
            inv.gemini.predictedCategory !== 'poor_quality_detail' &&
            !['f1713ee9', '085c3850', 'a682c228', 'cd027aa2'].some((id) => inv.gemini.assetId.includes(id)) &&
            !inv.filename.includes('4.12.54') &&
            !inv.filename.includes('4.13.00')
        );

        for (const slot of slots) {
          // Normalize areaId to match categories
          let targetCategory = slot.areaId.toLowerCase();
          if (targetCategory === 'entrance') targetCategory = 'gate_signage';

          const match = eligibleInventory.find((item) => {
            if (usedAssetIds.has(item.gemini.assetId)) return false;
            return item.gemini.predictedCategory.toLowerCase().includes(targetCategory) ||
              targetCategory.includes(item.gemini.predictedCategory.toLowerCase());
          });

          if (match) {
            usedAssetIds.add(match.gemini.assetId);
            await this.mapAssetToSlot(slot.id, match.gemini.assetId);
          }
        }

        // Also update creative campaigns with evidence-directed storyboards
        const storyboardsResult = await mockAiVideoDirector.generateDualStoryboards();
        this.state!.project.campaigns = [storyboardsResult.videoA, storyboardsResult.videoB];
        await this.persistState();

        return this.state!.slotMappings;
      } catch (err: any) {
        logger.warn({ err: err.message }, 'Autonomous Director mapping failed, using fallback heuristic mapping');
      }
    }

    // Fallback heuristic mapping
    for (const slot of slots) {
      let chosen = pool.find((item) => {
        if (usedAssetIds.has(item.assetId)) return false;
        const room = (item as any).userRoomOverride || (item as any).inferredRoom || '';
        return room.toLowerCase().includes(slot.areaId.toLowerCase()) || slot.areaId.toLowerCase().includes(room.toLowerCase());
      });

      if (!chosen) {
        chosen = pool.find((item) => !usedAssetIds.has(item.assetId));
      }

      if (!chosen) {
        chosen = pool[slots.indexOf(slot) % pool.length];
      }

      if (chosen) {
        usedAssetIds.add(chosen.assetId);
        await this.mapAssetToSlot(slot.id, chosen.assetId);
      }
    }

    return this.state!.slotMappings;
  }

  /**
   * Generates dual storyboards (Video A & Video B) via Autonomous AI Video Director
   */
  public async generateAutonomousStoryboards(): Promise<DirectedStoryboardsResult> {
    if (!this.state) await this.init();
    const result = await mockAiVideoDirector.generateDualStoryboards();
    this.state!.project.campaigns = [result.videoA, result.videoB];
    await this.persistState();
    return result;
  }

  /**
   * Get campaigns from the fixture
   */
  public async getCampaigns(): Promise<MockCampaign[]> {
    const proj = await this.getProject();
    return proj.campaigns;
  }

  /**
   * Triggers Runway pilot generation for a designated scene in a campaign.
   */
  public async triggerRunwayPilot(params: {
    campaignId: string;
    sceneIndex: number;
    hasHumanCostApproval: boolean;
  }): Promise<{ task: RunwayTaskResult; message: string }> {
    if (!this.state) await this.init();

    const campaign = this.state!.project.campaigns.find((c) => c.id === params.campaignId);
    if (!campaign) {
      throw new Error(`Campaign "${params.campaignId}" not found.`);
    }

    const scene = campaign.scenes[params.sceneIndex];
    if (!scene) {
      throw new Error(`Scene at index ${params.sceneIndex} not found in campaign.`);
    }

    if (!scene.runwayClip) {
      throw new Error(`Scene "${scene.role}" is not configured for Runway generative motion.`);
    }

    // Check if slot has an image mapped
    const mapping = this.state!.slotMappings[scene.assetId];
    let sourceImagePath: string | undefined;

    if (mapping) {
      const asset =
        this.state!.uploadedAssets.find((a) => a.assetId === mapping.assetId) ||
        this.state!.sourceVideos.find((v) => v.assetId === mapping.assetId);
      if (asset) sourceImagePath = asset.absolutePath;
    }

    // Fallback to any uploaded photo or video if slot not explicitly mapped
    if (!sourceImagePath && this.state!.uploadedAssets.length > 0) {
      sourceImagePath = this.state!.uploadedAssets[0].absolutePath;
    } else if (!sourceImagePath && this.state!.sourceVideos.length > 0) {
      sourceImagePath = this.state!.sourceVideos[0].absolutePath;
    }

    if (!sourceImagePath || !fs.existsSync(sourceImagePath)) {
      throw new Error(
        `Cannot generate Runway clip for slot "${scene.assetId}": No original photo available. Upload a photo first.`
      );
    }

    const modelCandidate = (campaign.generationPolicy?.videoModelCandidate as 'seedance2_5' | 'gen3a_turbo' | 'gen4_turbo') || 'gen4_turbo';

    const task = await mockRunwayClient.createImageToVideoTask({
      promptImageUrl: sourceImagePath,
      promptText: `Cinematic architectural showcase, ${scene.motion.replace(/_/g, ' ')}, stable structural geometry, natural daylight, photorealistic interior design`,
      model: modelCandidate,
      ratio: '768:1280',
      durationSeconds: 5,
      hasHumanCostApproval: params.hasHumanCostApproval,
    });

    this.state!.runwayPilotClips[params.campaignId] = task;
    await this.persistState();

    return {
      task,
      message: task.status === 'BLOCKED'
        ? task.error || 'Generation blocked'
        : task.status === 'FAILED'
        ? task.error || 'Runway generation failed'
        : 'Runway image-to-video task processed.',
    };
  }

  public async getRunwayPilotStatus(taskId: string): Promise<any> {
    return mockRunwayClient.getTaskStatus(taskId);
  }

  /**
   * Composes a complete 9:16 vertical video ad for a campaign using FFmpeg & Sharp
   */
  public async composeCampaignAd(campaignId: string): Promise<ComposedAdResult> {
    if (!this.state) await this.init();

    const campaign = this.state!.project.campaigns.find((c) => c.id === campaignId);
    if (!campaign) {
      throw new Error(`Campaign "${campaignId}" not found.`);
    }

    // Build map of slotId -> { absolutePath, url }
    const mappedPhotos = new Map<string, { absolutePath: string; url: string }>();
    for (const [slotId, mapping] of Object.entries(this.state!.slotMappings)) {
      if (isBannedAsset(mapping.assetId) || isBannedAsset(mapping.fileName)) continue;

      const asset = this.state!.uploadedAssets.find((a) => a.assetId === mapping.assetId);
      const video = this.state!.sourceVideos.find((v) => v.assetId === mapping.assetId);

      if (asset && fs.existsSync(asset.absolutePath) && !isBannedAsset(asset.absolutePath)) {
        mappedPhotos.set(slotId, {
          absolutePath: asset.absolutePath,
          url: asset.url,
        });
      } else if (video && fs.existsSync(video.absolutePath) && !isBannedAsset(video.absolutePath)) {
        mappedPhotos.set(slotId, {
          absolutePath: video.absolutePath,
          url: video.url,
        });
      } else if (video && fs.existsSync(video.thumbnailPath) && !isBannedAsset(video.thumbnailPath)) {
        mappedPhotos.set(slotId, {
          absolutePath: video.thumbnailPath,
          url: video.thumbnailUrl,
        });
      }
    }

    // List of all available uploaded photo & video paths
    const allAvailablePhotos = [
      ...this.state!.uploadedAssets.map((a) => a.absolutePath),
      ...this.state!.sourceVideos.map((v) => v.absolutePath),
      ...this.state!.sourceVideos.map((v) => v.thumbnailPath),
    ].filter((p) => fs.existsSync(p) && !isBannedAsset(p));

    // Check if a Runway pilot clip was generated for this campaign
    const pilotClip = this.state!.runwayPilotClips[campaignId];
    let runwayClipLocalPath: string | undefined;

    if (pilotClip && pilotClip.localStorageKey) {
      const resolved = path.resolve(process.cwd(), 'storage', pilotClip.localStorageKey);
      if (fs.existsSync(resolved)) {
        runwayClipLocalPath = resolved;
      }
    }

    const composedResult = await mockAdComposer.composeAd(
      campaign,
      this.state!.project,
      mappedPhotos,
      allAvailablePhotos,
      runwayClipLocalPath,
      pilotClip?.taskId
    );

    this.state!.composedAds[campaignId] = composedResult;
    await this.persistState();
    return composedResult;
  }

  /**
   * Composes a 10-15s Style-Match Pilot demo matching reference 1013.mp4
   */
  public async composeStyleMatchPilot(): Promise<ComposedAdResult> {
    if (!this.state) await this.init();

    const mappedPhotos = new Map<string, { absolutePath: string; url: string }>();
    for (const [slotId, mapping] of Object.entries(this.state!.slotMappings)) {
      if (isBannedAsset(mapping.assetId) || isBannedAsset(mapping.fileName)) continue;

      const asset = this.state!.uploadedAssets.find((a) => a.assetId === mapping.assetId);
      const video = this.state!.sourceVideos.find((v) => v.assetId === mapping.assetId);

      if (asset && fs.existsSync(asset.absolutePath) && !isBannedAsset(asset.absolutePath)) {
        mappedPhotos.set(slotId, { absolutePath: asset.absolutePath, url: asset.url });
      } else if (video && fs.existsSync(video.absolutePath) && !isBannedAsset(video.absolutePath)) {
        mappedPhotos.set(slotId, { absolutePath: video.absolutePath, url: video.url });
      }
    }

    const allAvailablePhotos = [
      ...this.state!.uploadedAssets.map((a) => a.absolutePath),
      ...this.state!.sourceVideos.map((v) => v.absolutePath),
    ].filter((p) => fs.existsSync(p) && !isBannedAsset(p));

    const pilotClip = Object.values(this.state!.runwayPilotClips).find((c) => c.status === 'SUCCEEDED');
    let runwayClipLocalPath: string | undefined;
    if (pilotClip && pilotClip.localStorageKey) {
      const resolved = path.resolve(process.cwd(), 'storage', pilotClip.localStorageKey);
      if (fs.existsSync(resolved)) runwayClipLocalPath = resolved;
    }

    const composedResult = await mockAdComposer.composeStyleMatchPilot(
      this.state!.project,
      mappedPhotos,
      allAvailablePhotos,
      runwayClipLocalPath,
      pilotClip?.taskId
    );

    this.state!.composedAds['pilot_style_match_1013'] = composedResult;
    await this.persistState();
    return composedResult;
  }

  /**
   * Completely deletes all mock AI data:
   * - Deletes uploaded videos, photos, thumbnails, runway clips, rendered ads, and audio.
   * - Resets slot mappings and campaigns back to the clean baseline fixture.
   * - Re-persists clean state.json.
   */
  public async resetMockData(): Promise<{ success: boolean; message: string }> {
    const root = mockAiGenStorage.getRoot();
    const subdirs = ['uploads', 'thumbnails', 'runway_clips', 'rendered_ads', 'audio'];

    for (const sub of subdirs) {
      const fullPath = path.join(root, sub);
      try {
        if (fs.existsSync(fullPath)) {
          await fsPromises.rm(fullPath, { recursive: true, force: true });
        }
      } catch (err) {
        logger.warn({ err, sub }, 'Failed to delete mock AI subfolder');
      }
    }

    // Re-initialize clean directories
    await mockAiGenStorage.init();
    await fsPromises.mkdir(path.join(root, 'audio', 'cache'), { recursive: true });

    // Reload baseline fixture
    if (!fs.existsSync(this.fixturePath)) {
      throw new Error(`Fixture file not found at ${this.fixturePath}`);
    }

    const rawContent = await fsPromises.readFile(this.fixturePath, 'utf-8');
    const parsedJson = JSON.parse(rawContent);
    const validatedProject = MockPropertyProjectSchema.parse(parsedJson);

    // Reset media assets slots in project
    for (const slot of validatedProject.media.assets) {
      slot.uploaded = false;
      slot.fileName = null;
      slot.storageAssetId = null;
      slot.url = null;
    }
    validatedProject.media.logo.uploaded = false;
    validatedProject.media.logo.fileName = null;
    validatedProject.media.logo.url = null;
    validatedProject.media.sourceVideos = [];

    this.state = {
      project: validatedProject,
      uploadedAssets: [],
      sourceVideos: [],
      slotMappings: {},
      logoAsset: undefined,
      runwayPilotClips: {},
      composedAds: {},
    };

    await this.persistState();

    logger.info('Completely reset mock AI data to pristine fixture state');
    return {
      success: true,
      message: 'All Mock AI data (uploaded videos, photos, slot mappings, rendered ads) has been completely deleted.',
    };
  }
}

export const mockAiGenService = new MockAiGenService();
