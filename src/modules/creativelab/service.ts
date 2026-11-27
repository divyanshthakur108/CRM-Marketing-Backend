import crypto from 'crypto';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import sharp from 'sharp';
import { GoogleGenAI } from '@google/genai';
import { Types } from 'mongoose';
import { getAIProvider } from '../ai/providers/index.js';
import { defaultStorage } from '../../storage/localStorage.adapter.js';
import { validateFileSignature } from '../../utils/fileSignature.js';
import { escapeFilterPath, probeMedia, runFfmpeg } from '../../utils/ffmpeg.js';
import { AppError } from '../../utils/AppError.js';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { parseSceneCuts } from '../videolab/analyze.js';
import { recordGeminiUsage } from '../videolab/cacheModel.js';
import { renderMapCard } from './mapCardRender.js';
import { measureTilt, runCleanup } from './cleanup.js';
import {
  AnalysisStep,
  CreativeLabAsset,
  CreativeLabProject,
  CreativeLabResult,
  ICreativeLabAsset,
  ICreativeLabProject,
  ICreativeLabResult,
  MapCardStatus,
} from './model.js';
import {
  NearbyPlace,
  ProjectBrief,
  MapStyle,
  FixPlan,
  VideoKnowledge,
  buildFixPlanPrompt,
  cleanFixPlan,
  buildMapCardPrompt,
  buildMapScenePrompt,
  cleanPlaces,
  buildBriefPrompt,
  buildImagePrompt,
  buildVideoPrompt,
  cleanBrief,
  cleanImageKnowledge,
  cleanVideoKnowledge,
} from './knowledge.js';

/** Videos are understood up to this length (longer clips: only the start is sent to Gemini) */
export const MAX_VIDEO_SECONDS = 180;
/** Analyses stuck longer than this (e.g. server restarted mid-way) are marked failed */
const STALE_MS = 20 * 60 * 1000;

const round2 = (n: number) => Math.round(n * 100) / 100;

// Analyses run one at a time in the background (keeps the free Gemini tier and the CPU calm)
let analysisChain: Promise<void> = Promise.resolve();
// Clean-ups run one at a time too (ffmpeg is CPU heavy)
let cleanupChain: Promise<void> = Promise.resolve();

export class CreativeLabService {
  // ── Projects ──────────────────────────────────────────────────────────────

  public async createProject(adminUserId: string, name: string, infoText: string): Promise<ICreativeLabProject> {
    const project = await CreativeLabProject.create({
      createdBy: new Types.ObjectId(adminUserId),
      name,
      infoText,
      briefStatus: 'PENDING',
    });
    await this.extractBrief(project);
    return project;
  }

  public async updateInfo(projectId: string, name: string, infoText: string): Promise<ICreativeLabProject> {
    const project = await this.getProjectDoc(projectId);
    project.name = name;
    project.infoText = infoText;
    project.briefStatus = 'PENDING';
    await project.save();
    await this.extractBrief(project);
    return project;
  }

  /** One Gemini request: turns the typed project info into a fact sheet. Only written facts. */
  private async extractBrief(project: ICreativeLabProject): Promise<void> {
    if (!project.infoText.trim()) {
      project.briefStatus = 'FAILED';
      project.briefError = 'No project information was typed.';
      project.brief = undefined;
      await project.save();
      return;
    }
    try {
      const raw = await getAIProvider().generateJson(buildBriefPrompt(project.infoText), {
        feature: 'Creative Lab project facts',
      });
      project.brief = cleanBrief(raw);
      project.briefStatus = 'DONE';
      project.briefError = undefined;
    } catch (err) {
      project.briefStatus = 'FAILED';
      project.briefError = err instanceof Error ? err.message.slice(0, 600) : String(err);
      logger.warn({ err, projectId: project._id }, 'Creative Lab: brief extraction failed');
    }
    await project.save();
  }

  public async listProjects(): Promise<Array<ICreativeLabProject & { assetCount: number }>> {
    const projects = await CreativeLabProject.find().sort({ createdAt: -1 }).limit(50).lean();
    const counts = await CreativeLabAsset.aggregate<{ _id: Types.ObjectId; n: number }>([
      { $match: { projectId: { $in: projects.map((p) => p._id) } } },
      { $group: { _id: '$projectId', n: { $sum: 1 } } },
    ]);
    const byId = new Map(counts.map((c) => [c._id.toString(), c.n]));
    return projects.map((p) => ({ ...p, assetCount: byId.get(p._id.toString()) || 0 })) as never;
  }

  public async getProject(
    projectId: string
  ): Promise<{ project: ICreativeLabProject; assets: ICreativeLabAsset[]; results: ICreativeLabResult[] }> {
    const project = await this.getProjectDoc(projectId);
    await CreativeLabAsset.updateMany(
      { projectId: project._id, status: { $in: ['QUEUED', 'ANALYZING'] }, updatedAt: { $lt: new Date(Date.now() - STALE_MS) } },
      { $set: { status: 'FAILED', error: 'Interrupted (the server restarted). Press "Analyze again".' } }
    );
    await CreativeLabAsset.updateMany(
      { projectId: project._id, 'cleaned.status': { $in: ['QUEUED', 'WORKING'] }, 'cleaned.updatedAt': { $lt: new Date(Date.now() - STALE_MS) } },
      { $set: { 'cleaned.status': 'FAILED', 'cleaned.error': 'Interrupted (the server restarted). Press "Clean up" again.' } }
    );
    const [assets, results] = await Promise.all([
      CreativeLabAsset.find({ projectId: project._id }).sort({ createdAt: 1 }),
      CreativeLabResult.find({ projectId: project._id }).sort({ createdAt: -1 }),
    ]);
    return { project, assets, results };
  }

  private async getProjectDoc(projectId: string): Promise<ICreativeLabProject> {
    if (!Types.ObjectId.isValid(projectId)) throw AppError.notFound('Test project not found');
    const project = await CreativeLabProject.findById(projectId);
    if (!project) throw AppError.notFound('Test project not found');
    return project;
  }

  // ── Uploads ───────────────────────────────────────────────────────────────

  public async uploadAsset(projectId: string, file: Express.Multer.File, adminUserId: string): Promise<ICreativeLabAsset> {
    const project = await this.getProjectDoc(projectId);

    const detection = validateFileSignature(file.buffer, file.originalname, file.mimetype);
    if (!detection.valid || (detection.type !== 'IMAGE' && detection.type !== 'VIDEO')) {
      throw AppError.badRequest(detection.error || 'Only photos (JPG, PNG, WebP) and videos (MP4, MOV, WebM) are allowed');
    }
    const kind = detection.type === 'VIDEO' ? 'video' : 'image';
    let ext = (path.extname(file.originalname).slice(1) || detection.ext || '').toLowerCase();
    if (ext === 'jpeg') ext = 'jpg';
    if (!/^(jpg|png|webp|mp4|mov|webm)$/.test(ext)) throw AppError.badRequest(`Unsupported file extension: .${ext}`);

    const sha256 = crypto.createHash('sha256').update(file.buffer).digest('hex');
    const key = `creative-lab/assets/${crypto.randomUUID()}.${ext}`;
    const stored = await defaultStorage.upload(
      { buffer: file.buffer, filename: file.originalname, mimetype: file.mimetype },
      'creative-lab/assets',
      key
    );

    const doc = new CreativeLabAsset({
      projectId: project._id,
      createdBy: new Types.ObjectId(adminUserId),
      kind,
      key,
      url: stored.url,
      filename: file.originalname.slice(0, 200),
      mimeType: file.mimetype,
      sizeBytes: file.size,
      sha256,
      status: 'QUEUED',
      steps: [],
    });

    try {
      if (kind === 'image') {
        const image = sharp(file.buffer).rotate();
        const meta = await image.metadata();
        const portrait = (meta.orientation || 1) >= 5;
        doc.width = portrait ? meta.height : meta.width;
        doc.height = portrait ? meta.width : meta.height;
        const thumb = await image.resize(320, 320, { fit: 'inside' }).jpeg({ quality: 70 }).toBuffer();
        doc.previewThumb = `data:image/jpeg;base64,${thumb.toString('base64')}`;
      } else {
        const localPath = defaultStorage.getAbsolutePath(key);
        const probe = await probeMedia(localPath);
        if (!probe.hasVideo) throw AppError.badRequest('This file has no video track');
        doc.durationSeconds = round2(probe.durationSeconds);
        doc.width = probe.width;
        doc.height = probe.height;
        doc.hasAudio = probe.hasAudio;
        doc.previewThumb = await this.videoFrame(localPath, Math.min(1, probe.durationSeconds / 2), 320);
      }
    } catch (err) {
      if (err instanceof AppError) throw err;
      logger.warn({ err, key }, 'Creative Lab: could not read media details');
    }

    // Same file analyzed before in this project: reuse its knowledge card, no Gemini request
    const twin = await this.findTwin(project._id as Types.ObjectId, sha256);
    if (twin) {
      doc.status = 'DONE';
      doc.knowledge = twin.knowledge;
      doc.aiModel = twin.aiModel;
      doc.reusedFromAssetId = twin._id as Types.ObjectId;
      doc.steps = [{ name: 'Same file was analyzed before: reused its knowledge card (no Gemini request)', ms: 0 }];
      doc.finishedAt = new Date();
      await doc.save();
      return doc;
    }

    await doc.save();
    this.enqueue(doc._id.toString());
    return doc;
  }

  public async reanalyze(assetId: string): Promise<ICreativeLabAsset> {
    if (!Types.ObjectId.isValid(assetId)) throw AppError.notFound('File not found');
    const doc = await CreativeLabAsset.findById(assetId);
    if (!doc) throw AppError.notFound('File not found');
    if (doc.status === 'QUEUED' || doc.status === 'ANALYZING') throw AppError.conflict('This file is already being analyzed');
    doc.status = 'QUEUED';
    doc.error = undefined;
    doc.reusedFromAssetId = undefined;
    doc.steps = [];
    await doc.save();
    this.enqueue(doc._id.toString(), true);
    return doc;
  }

  public async deleteAsset(assetId: string): Promise<void> {
    if (!Types.ObjectId.isValid(assetId)) throw AppError.notFound('File not found');
    const doc = await CreativeLabAsset.findById(assetId);
    if (!doc) throw AppError.notFound('File not found');
    if (doc.status === 'ANALYZING') throw AppError.conflict('Wait until the analysis finishes');
    await doc.deleteOne();
  }

  /** Deletes a test project and its knowledge cards. Uploaded files are kept in storage. */
  public async deleteProject(projectId: string): Promise<{ deletedFiles: number; filesKeptInStorage: true }> {
    const project = await this.getProjectDoc(projectId);
    const assets = await CreativeLabAsset.find({ projectId: project._id });
    if (assets.some((a) => a.status === 'ANALYZING')) {
      throw AppError.conflict('A file in this project is being analyzed. Wait until it finishes, then delete.');
    }
    await CreativeLabAsset.deleteMany({ projectId: project._id });
    await CreativeLabResult.deleteMany({ projectId: project._id });
    await project.deleteOne();
    return { deletedFiles: assets.length, filesKeptInStorage: true };
  }

  // ── Clean-up (step 1): safe fixes before a file is used ──────────────────

  /** Queues a clean-up: fix plan (1 Gemini request, reused if present) + ffmpeg fixes. */
  public async startCleanup(
    assetId: string,
    replan = false,
    orientation?: 'ok' | 'upside_down' | 'turn_left' | 'turn_right'
  ): Promise<ICreativeLabAsset> {
    if (!Types.ObjectId.isValid(assetId)) throw AppError.notFound('File not found');
    const doc = await CreativeLabAsset.findById(assetId);
    if (!doc) throw AppError.notFound('File not found');
    if (doc.status !== 'DONE') throw AppError.conflict('Wait until the AI has analyzed this file');
    if (doc.cleaned && ['QUEUED', 'WORKING'].includes(doc.cleaned.status)) throw AppError.conflict('This file is already being cleaned');
    if (replan) doc.fixPlan = undefined;
    doc.cleaned = { status: 'QUEUED', updatedAt: new Date(), ...(orientation ? { orientationOverride: orientation } : {}) };
    doc.markModified('cleaned');
    await doc.save();
    cleanupChain = cleanupChain.then(() => this.cleanOne(assetId)).catch(() => undefined);
    return doc;
  }

  public async setCleanedStatus(assetId: string, status: 'APPROVED' | 'REJECTED' | 'READY'): Promise<ICreativeLabAsset> {
    if (!Types.ObjectId.isValid(assetId)) throw AppError.notFound('File not found');
    const doc = await CreativeLabAsset.findById(assetId);
    if (!doc?.cleaned?.url) throw AppError.notFound('No cleaned version yet');
    doc.cleaned.status = status;
    doc.cleaned.updatedAt = new Date();
    doc.markModified('cleaned');
    await doc.save();
    return doc;
  }

  private async cleanOne(assetId: string): Promise<void> {
    const doc = await CreativeLabAsset.findById(assetId);
    if (!doc || doc.cleaned?.status !== 'QUEUED') return;
    const started = Date.now();
    const set = (cleaned: Record<string, unknown>) =>
      CreativeLabAsset.updateOne({ _id: assetId }, { $set: { cleaned: { ...cleaned, updatedAt: new Date() } } });
    await set({ status: 'WORKING' });
    const scratch = path.resolve(process.cwd(), 'storage', 'scratch', `clean-${crypto.randomUUID()}`);
    try {
      const input = await defaultStorage.ensureLocal(doc.key);
      if (!fs.existsSync(input)) throw new Error('Original file not found in storage');
      const k = doc.knowledge as (VideoKnowledge & { quality?: { issues?: string[] } }) | undefined;
      const issues: string[] =
        doc.kind === 'image'
          ? ((doc.knowledge as any)?.quality?.issues ?? [])
          : [...new Set(((k?.shots ?? []).flatMap((s) => s.quality?.issues ?? []) as string[]).concat((k as any)?.quality?.issues ?? []))];

      // 1. Fix plan (Gemini looks at the photo, or 3 frames of the useful part of the video)
      let plan = doc.fixPlan as FixPlan | undefined;
      let planNote = '';
      const kept = (k?.shots ?? []).filter((s) => s.keep);
      let trim: { start: number; end: number } | null = null;
      if (doc.kind === 'video' && kept.length && doc.durationSeconds) {
        const start = Math.max(0, Math.min(...kept.map((s) => s.bestStart)));
        const end = Math.min(doc.durationSeconds, Math.max(...kept.map((s) => s.bestEnd)));
        if (end - start >= 2 && (start > 0.5 || end < doc.durationSeconds - 0.5)) trim = { start, end };
      }
      let images: Array<{ data: Buffer; mimeType: string }>;
      if (doc.kind === 'image') {
        images = [{ data: await sharp(input).rotate().resize(1024, 1024, { fit: 'inside' }).jpeg({ quality: 85 }).toBuffer(), mimeType: 'image/jpeg' }];
      } else {
        const a = trim?.start ?? 0;
        const b = trim?.end ?? doc.durationSeconds ?? 1;
        images = [];
        for (const t of [0.25, 0.5, 0.75]) images.push({ data: await this.frameJpeg(input, a + (b - a) * t, scratch), mimeType: 'image/jpeg' });
      }
      if (!plan) {
        try {
          const raw = await getAIProvider().generateJson(buildFixPlanPrompt(doc.kind, issues), { images, feature: 'Clean-up plan' });
          plan = cleanFixPlan(raw);
          await CreativeLabAsset.updateOne({ _id: assetId }, { $set: { fixPlan: plan } });
        } catch (err) {
          // Gemini busy / limit reached: still do the safe basic fixes; the plan is retried next time
          logger.warn({ assetId, err: (err as Error).message }, 'Creative Lab: fix plan unavailable, using basic fixes');
          planNote = 'Gemini unavailable (busy or daily limit): light/colour checks skipped; straightening is measured without AI. "Clean again" later for the full check.';
          plan = cleanFixPlan({ noise: 'medium', blurry: issues.includes('blurry'), exposure: issues.includes('too_dark') ? 'dark' : issues.includes('overexposed') ? 'bright' : 'ok' });
        }
      }

      // Orientation chosen by hand on the page beats the AI's answer
      const override = (doc.cleaned as { orientationOverride?: FixPlan['orientation'] } | undefined)?.orientationOverride;
      if (override) plan = { ...plan, orientation: override };
      // Measure tilt on upright frames
      if (plan.orientation !== 'ok') {
        const turn = { upside_down: 180, turn_left: -90, turn_right: 90 }[plan.orientation];
        images = await Promise.all(images.map(async (im) => ({ ...im, data: await sharp(im.data).rotate(turn).jpeg().toBuffer() })));
      }

      // Straightening: measure the angle from the vertical edges (no AI); trust it over the AI's estimate
      const tilts = await Promise.all(images.map((im) => measureTilt(im.data)));
      const sure = tilts.filter((t) => t.confidence >= 0.2 && Math.abs(t.degrees) <= 6).map((t) => t.degrees).sort((x, y) => x - y);
      let tiltNote = '';
      if (sure.length) {
        const measured = sure[Math.floor(sure.length / 2)];
        plan = { ...plan, tiltDegrees: measured };
        tiltNote = measured ? `Tilt measured from vertical edges: ${measured > 0 ? '+' : ''}${measured}°` : 'Tilt measured: already straight';
      } else if (!doc.fixPlan) {
        plan = { ...plan, tiltDegrees: 0 }; // no AI plan and no clear vertical lines: don't guess
      }

      // 2. Safe fixes
      const { output, fixes } = await runCleanup({
        input,
        outDir: scratch,
        kind: doc.kind,
        width: doc.width || 1080,
        height: doc.height || 1920,
        plan,
        stabilize: doc.kind === 'video' && issues.includes('shaky'),
        trim,
        hasAudio: doc.hasAudio,
      });

      // 3. Save + preview
      const buffer = await fsp.readFile(output);
      const ext = doc.kind === 'image' ? 'jpg' : 'mp4';
      const key = `creative-lab/cleaned/${crypto.randomUUID()}.${ext}`;
      const stored = await defaultStorage.upload(
        { buffer, filename: `cleaned.${ext}`, mimetype: doc.kind === 'image' ? 'image/jpeg' : 'video/mp4' },
        'creative-lab/cleaned',
        key
      );
      const probe = await probeMedia(output).catch(() => null);
      const thumb =
        doc.kind === 'image'
          ? `data:image/jpeg;base64,${(await sharp(buffer).resize(320, 320, { fit: 'inside' }).jpeg({ quality: 70 }).toBuffer()).toString('base64')}`
          : await this.videoFrame(output, Math.min(1, (probe?.durationSeconds || 2) / 2), 320).catch(() => undefined);
      await set({
        ...(override ? { orientationOverride: override } : {}),
        status: 'READY',
        key,
        url: stored.url,
        width: probe?.width,
        height: probe?.height,
        durationSeconds: probe?.durationSeconds ? round2(probe.durationSeconds) : undefined,
        previewThumb: thumb,
        fixes: [planNote, tiltNote, ...fixes].filter(Boolean),
        ms: Date.now() - started,
      });
    } catch (err) {
      logger.warn({ err, assetId }, 'Creative Lab: clean-up failed');
      await set({ status: 'FAILED', error: (err instanceof Error ? err.message : String(err)).slice(0, 800), ms: Date.now() - started });
    } finally {
      await fsp.rm(scratch, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private async frameJpeg(videoPath: string, atSeconds: number, dir: string): Promise<Buffer> {
    await fsp.mkdir(dir, { recursive: true });
    const file = path.join(dir, `f-${crypto.randomUUID()}.jpg`);
    await runFfmpeg(['-y', '-ss', atSeconds.toFixed(2), '-i', videoPath, '-frames:v', '1', '-vf', 'scale=720:-2', '-q:v', '3', file]);
    return fsp.readFile(file);
  }

  // ── Brand kit + nearby places + map card ──────────────────────────────────

  /** Saves the project's logo / icon (PNG, JPG or WebP). The old file stays in storage. */
  public async setLogo(projectId: string, file: { buffer: Buffer; originalname: string; mimetype: string }): Promise<ICreativeLabProject> {
    const project = await this.getProjectDoc(projectId);
    const ext = this.checkImage(file);
    const key = `creative-lab/brand/${crypto.randomUUID()}.${ext}`;
    const stored = await defaultStorage.upload({ buffer: file.buffer, filename: file.originalname, mimetype: file.mimetype }, 'creative-lab/brand', key);
    const thumb = await sharp(file.buffer)
      .resize(240, 240, { fit: 'inside' })
      .png()
      .toBuffer()
      .catch(() => undefined);
    project.brand = {
      logoKey: key,
      logoUrl: stored.url,
      logoThumb: thumb ? `data:image/png;base64,${thumb.toString('base64')}` : undefined,
      filename: file.originalname.slice(0, 200),
      mimeType: file.mimetype,
      updatedAt: new Date(),
    };
    await project.save();
    return project;
  }

  public async removeLogo(projectId: string): Promise<ICreativeLabProject> {
    const project = await this.getProjectDoc(projectId);
    project.brand = undefined;
    await project.save();
    return project;
  }

  public async setPlaces(projectId: string, raw: unknown): Promise<ICreativeLabProject> {
    const project = await this.getProjectDoc(projectId);
    let places: NearbyPlace[];
    try {
      places = cleanPlaces(raw);
    } catch (err) {
      throw AppError.badRequest((err as Error).message, 'INVALID_PLACES');
    }
    project.places = places;
    await project.save();
    return project;
  }

  /** The prompt the next map card would use (shown on the page so it can be copied to the Gemini website) */
  public async getMapCardPrompt(projectId: string, variant?: number, style: MapStyle = 'flat'): Promise<{ prompt: string; variant: number }> {
    const project = await this.getProjectDoc(projectId);
    const v = variant ?? this.nextVariant(project, style);
    return { prompt: this.mapPrompt(project, v, style), variant: v };
  }

  /**
   * Makes a map card with the Gemini image model (1 request). Each call uses the next style
   * variant, so it also works as "Regenerate". The card starts as NEEDS_CHECK.
   */
  public async generateMapCard(
    projectId: string,
    style: MapStyle = 'flat',
    engine: 'free' | 'gemini' = 'free'
  ): Promise<ICreativeLabProject> {
    if (engine === 'free') return this.generateFreeMapCard(projectId, style);
    const project = await this.getProjectDoc(projectId);
    const variant = this.nextVariant(project, style);
    const prompt = this.mapPrompt(project, variant, style);
    if (!env.GEMINI_API_KEY) {
      throw new AppError(503, 'IMAGE_API_UNAVAILABLE', 'Gemini is not configured on the server', { prompt, variant });
    }

    const parts: Array<{ text: string } | { inlineData: { data: string; mimeType: string } }> = [];
    if (project.brand?.logoKey) {
      const logo = await defaultStorage.download(project.brand.logoKey).catch(() => undefined);
      if (logo) parts.push({ inlineData: { data: logo.toString('base64'), mimeType: project.brand.mimeType || 'image/png' } });
    }
    parts.push({ text: prompt });

    let image: { data: string; mimeType?: string } | undefined;
    try {
      await recordGeminiUsage(env.GEMINI_IMAGE_MODEL).catch(() => undefined);
      const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
      const res = await ai.models.generateContent({
        model: env.GEMINI_IMAGE_MODEL,
        contents: [{ role: 'user', parts }],
        config: { imageConfig: { aspectRatio: '9:16' } },
      });
      const part = res.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
      if (part?.inlineData?.data) image = { data: part.inlineData.data, mimeType: part.inlineData.mimeType };
    } catch (err) {
      const message = (err as Error).message || String(err);
      logger.warn({ err: message.slice(0, 300) }, 'Creative Lab: map card generation failed');
      const quota = /quota|429|RESOURCE_EXHAUSTED|billing|limit: 0/i.test(message);
      throw new AppError(
        503,
        'IMAGE_API_UNAVAILABLE',
        quota
          ? "The Gemini image API isn't available on this key (free tier has 0 image requests; it needs billing)."
          : `Gemini couldn't make the image: ${message.slice(0, 160)}`,
        { prompt, variant }
      );
    }
    if (!image) {
      throw new AppError(503, 'IMAGE_API_UNAVAILABLE', 'Gemini returned no image (it may have been blocked). Try again.', { prompt, variant });
    }

    const buffer = Buffer.from(image.data, 'base64');
    const ext = /jpe?g/.test(image.mimeType || '') ? 'jpg' : 'png';
    return this.addMapCard(project, buffer, ext, { prompt, variant, style, source: 'gemini', model: env.GEMINI_IMAGE_MODEL });
  }

  /**
   * Free map card: Cloudflare Workers AI (FLUX) draws only the background scene, then we draw the
   * pin, labels, chips, "Not to scale" and the logo ourselves, so every name and number is exact.
   */
  private async generateFreeMapCard(projectId: string, style: MapStyle): Promise<ICreativeLabProject> {
    const project = await this.getProjectDoc(projectId);
    if (!project.places?.length) throw AppError.badRequest('Add and save at least one nearby place first', 'NO_PLACES');
    if (!env.CLOUDFLARE_ACCOUNT_ID || !env.CLOUDFLARE_API_TOKEN) {
      throw new AppError(503, 'FREE_IMAGE_UNAVAILABLE', 'Free generator is not set up (add CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN to the backend .env)');
    }
    const variant = this.nextVariant(project, style);
    const scenePrompt = buildMapScenePrompt(style, variant);

    let background: Buffer;
    try {
      const res = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/ai/run/${env.CLOUDFLARE_IMAGE_MODEL}`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: scenePrompt, steps: 8 }),
          signal: AbortSignal.timeout(90_000),
        }
      );
      const body = (await res.json().catch(() => ({}))) as { success?: boolean; result?: { image?: string }; errors?: Array<{ message?: string }> };
      if (!res.ok || !body.result?.image) {
        const msg = body.errors?.map((e) => e.message).join('; ') || `HTTP ${res.status}`;
        throw new Error(msg);
      }
      background = Buffer.from(body.result.image, 'base64');
    } catch (err) {
      const message = (err as Error).message || String(err);
      logger.warn({ err: message.slice(0, 300) }, 'Creative Lab: free map background failed');
      const quota = /limit|neuron|quota|429/i.test(message);
      throw new AppError(
        503,
        'FREE_IMAGE_UNAVAILABLE',
        quota ? "Today's free Cloudflare image limit is used up (resets at 05:30 IST). Try tomorrow or use Gemini." : `Free generator failed: ${message.slice(0, 160)}`
      );
    }

    const logo = project.brand?.logoKey ? await defaultStorage.download(project.brand.logoKey).catch(() => null) : null;
    const png = await renderMapCard({
      background,
      projectName: project.brief?.projectName || project.name,
      locality: [project.brief?.locality, project.brief?.city].filter(Boolean).join(', ') || null,
      places: project.places,
      logo,
    });
    return this.addMapCard(project, png, 'png', {
      prompt: `Background (Cloudflare ${env.CLOUDFLARE_IMAGE_MODEL}): ${scenePrompt}\nText, pin, labels and logo drawn by RealCRM (exact).`,
      variant,
      style,
      source: 'cloudflare',
      model: env.CLOUDFLARE_IMAGE_MODEL,
    });
  }

  /** Adds a map card made elsewhere (e.g. on the Gemini website with the copied prompt) */
  public async uploadMapCard(
    projectId: string,
    file: { buffer: Buffer; originalname: string; mimetype: string },
    style: MapStyle = 'flat'
  ): Promise<ICreativeLabProject> {
    const project = await this.getProjectDoc(projectId);
    const ext = this.checkImage(file);
    const variant = this.nextVariant(project, style);
    return this.addMapCard(project, file.buffer, ext, { prompt: this.mapPrompt(project, variant, style), variant, style, source: 'upload' });
  }

  public async setMapCardStatus(projectId: string, cardId: string, status: MapCardStatus): Promise<ICreativeLabProject> {
    const project = await this.getProjectDoc(projectId);
    const card = Types.ObjectId.isValid(cardId) ? project.mapCards?.id(cardId) : null;
    if (!card) throw AppError.notFound('Map card not found');
    card.status = status;
    await project.save();
    return project;
  }

  /** Next look within the chosen style, so "Regenerate" gives a different design each time */
  private nextVariant(project: ICreativeLabProject, style: MapStyle): number {
    return (project.mapCards || []).filter((c) => (c.style || 'flat') === style).length;
  }

  private mapPrompt(project: ICreativeLabProject, variant: number, style: MapStyle = 'flat'): string {
    if (!project.places?.length) throw AppError.badRequest('Add and save at least one nearby place first', 'NO_PLACES');
    return buildMapCardPrompt({
      projectName: project.brief?.projectName || project.name,
      locality: [project.brief?.locality, project.brief?.city].filter(Boolean).join(', ') || null,
      places: project.places,
      hasLogo: Boolean(project.brand?.logoKey),
      variant,
      style,
    });
  }

  private async addMapCard(
    project: ICreativeLabProject,
    buffer: Buffer,
    ext: string,
    meta: { prompt: string; variant: number; style: MapStyle; source: 'gemini' | 'cloudflare' | 'upload'; model?: string }
  ): Promise<ICreativeLabProject> {
    const key = `creative-lab/map-cards/${crypto.randomUUID()}.${ext}`;
    const stored = await defaultStorage.upload({ buffer, filename: `map-card.${ext}`, mimetype: `image/${ext === 'jpg' ? 'jpeg' : ext}` }, 'creative-lab/map-cards', key);
    project.mapCards = project.mapCards || ([] as unknown as ICreativeLabProject['mapCards']);
    project.mapCards!.unshift({ key, url: stored.url, ...meta, status: 'NEEDS_CHECK', createdAt: new Date() });
    await project.save();
    return project;
  }

  /** PNG / JPG / WebP only (checked by file content, not just the name). Returns the extension. */
  private checkImage(file: { buffer: Buffer; originalname: string; mimetype: string }): string {
    const detection = validateFileSignature(file.buffer, file.originalname, file.mimetype);
    if (!detection.valid || detection.type !== 'IMAGE') throw AppError.badRequest(detection.error || 'Use a PNG, JPG or WebP image');
    let ext = (path.extname(file.originalname).slice(1) || detection.ext || '').toLowerCase();
    if (ext === 'jpeg') ext = 'jpg';
    if (!/^(jpg|png|webp)$/.test(ext)) throw AppError.badRequest('Use a PNG, JPG or WebP image (SVG is not accepted)');
    return ext;
  }

  // ── Generated results (finished reels) ────────────────────────────────────

  /**
   * Saves a finished video to storage (Cloudinary when configured) and lists it on the project's
   * page. Publishing the same file again only updates its title/notes (matched by content hash).
   */
  public async addResult(
    projectId: string,
    file: { buffer: Buffer; filename: string },
    meta: {
      title: string;
      notes?: string;
      aiDisclosure?: string;
      tags?: string[];
      verdict?: ICreativeLabResult['verdict'];
      source?: ICreativeLabResult['source'];
      createdBy?: string;
    }
  ): Promise<ICreativeLabResult> {
    const project = await this.getProjectDoc(projectId);
    const detection = validateFileSignature(file.buffer, file.filename, 'video/mp4');
    if (!detection.valid || detection.type !== 'VIDEO') throw AppError.badRequest('Results must be MP4 videos');

    const sha256 = crypto.createHash('sha256').update(file.buffer).digest('hex');
    const fields = {
      title: meta.title.trim().slice(0, 160),
      notes: (meta.notes || '').slice(0, 2000),
      aiDisclosure: (meta.aiDisclosure || '').slice(0, 300),
      tags: (meta.tags || []).map((t) => t.trim()).filter(Boolean).slice(0, 12),
      verdict: meta.verdict || 'CHECK',
    };
    const existing = await CreativeLabResult.findOne({ projectId: project._id, sha256 });
    if (existing) {
      existing.set(fields);
      await existing.save();
      return existing;
    }

    const key = `creative-lab/results/${crypto.randomUUID()}.mp4`;
    const stored = await defaultStorage.upload({ buffer: file.buffer, filename: file.filename, mimetype: 'video/mp4' }, 'creative-lab/results', key);
    const doc = new CreativeLabResult({
      projectId: project._id,
      createdBy: meta.createdBy ? new Types.ObjectId(meta.createdBy) : undefined,
      ...fields,
      key,
      url: stored.url,
      filename: path.basename(file.filename).slice(0, 200),
      sizeBytes: file.buffer.length,
      sha256,
      source: meta.source || 'upload',
    });
    try {
      const localPath = defaultStorage.getAbsolutePath(key);
      const probe = await probeMedia(localPath);
      doc.durationSeconds = round2(probe.durationSeconds);
      doc.width = probe.width;
      doc.height = probe.height;
      doc.previewThumb = await this.videoFrame(localPath, Math.min(2, probe.durationSeconds / 2), 360);
    } catch (err) {
      logger.warn({ err, key }, 'Creative Lab: could not read result video details');
    }
    await doc.save();
    return doc;
  }

  /** Removes a result from the page. The video file stays in storage. */
  public async deleteResult(resultId: string): Promise<void> {
    if (!Types.ObjectId.isValid(resultId)) throw AppError.notFound('Result not found');
    const doc = await CreativeLabResult.findById(resultId);
    if (!doc) throw AppError.notFound('Result not found');
    await doc.deleteOne();
  }


  // ── Analysis ──────────────────────────────────────────────────────────────

  private enqueue(assetId: string, force = false): void {
    analysisChain = analysisChain.then(() => this.analyzeOne(assetId, force)).catch(() => undefined);
  }

  /** A finished knowledge card for the identical file in the same project (cards mention the project's facts) */
  private findTwin(projectId: Types.ObjectId, sha256: string, excludeId?: Types.ObjectId) {
    return CreativeLabAsset.findOne({
      projectId,
      sha256,
      status: 'DONE',
      knowledge: { $exists: true },
      ...(excludeId ? { _id: { $ne: excludeId } } : {}),
    }).sort({ finishedAt: -1 });
  }

  private async analyzeOne(assetId: string, force: boolean): Promise<void> {
    const doc = await CreativeLabAsset.findById(assetId);
    if (!doc || doc.status !== 'QUEUED') return;

    // The same file may have finished while this one waited in the queue: reuse it, no Gemini request
    const twin = force ? null : await this.findTwin(doc.projectId, doc.sha256, doc._id as Types.ObjectId);
    if (twin) {
      await CreativeLabAsset.updateOne(
        { _id: assetId },
        {
          $set: {
            status: 'DONE',
            knowledge: twin.knowledge,
            aiModel: twin.aiModel,
            reusedFromAssetId: twin._id,
            steps: [{ name: 'Same file was analyzed before: reused its knowledge card (no Gemini request)', ms: 0 }],
            analysisMs: 0,
            finishedAt: new Date(),
          },
        }
      );
      return;
    }

    const project = await CreativeLabProject.findById(doc.projectId);
    const brief = project?.briefStatus === 'DONE' ? (project.brief as ProjectBrief) : null;
    const infoText = project?.infoText || '';

    const started = Date.now();
    doc.status = 'ANALYZING';
    doc.startedAt = new Date();
    doc.steps = [];
    await doc.save();

    const steps: AnalysisStep[] = [];
    const timed = async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
      const t = Date.now();
      const result = await fn();
      const step = { name, ms: Date.now() - t };
      steps.push(step);
      await CreativeLabAsset.updateOne({ _id: assetId }, { $push: { steps: step } }).catch(() => undefined);
      return result;
    };

    try {
      const knowledge =
        doc.kind === 'image'
          ? await this.analyzeImage(doc, brief, infoText, timed)
          : await this.analyzeVideo(doc, brief, infoText, timed);
      await CreativeLabAsset.updateOne(
        { _id: assetId },
        {
          $set: {
            status: 'DONE',
            knowledge,
            aiModel: env.GEMINI_TEXT_MODEL,
            steps,
            analysisMs: Date.now() - started,
            finishedAt: new Date(),
          },
          $unset: { error: 1 },
        }
      );
    } catch (err) {
      logger.warn({ err, assetId }, 'Creative Lab: analysis failed');
      await CreativeLabAsset.updateOne(
        { _id: assetId },
        {
          $set: {
            status: 'FAILED',
            error: err instanceof Error ? err.message.slice(0, 1500) : String(err),
            steps,
            analysisMs: Date.now() - started,
            finishedAt: new Date(),
          },
        }
      );
    }
  }

  private async analyzeImage(
    doc: ICreativeLabAsset,
    brief: ProjectBrief | null,
    infoText: string,
    timed: <T>(name: string, fn: () => Promise<T>) => Promise<T>
  ) {
    const localPath = await defaultStorage.ensureLocal(doc.key);
    const image = await timed('Prepare the photo (upright, long side up to 1600 px)', async () =>
      sharp(await fsp.readFile(localPath))
        .rotate()
        .resize(1600, 1600, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 85 })
        .toBuffer()
    );
    const raw = await timed(`Gemini studies the photo (${env.GEMINI_TEXT_MODEL})`, () =>
      getAIProvider().generateJson(buildImagePrompt(brief, infoText), {
        images: [{ data: image, mimeType: 'image/jpeg' }],
        feature: 'Creative Lab photo knowledge',
      })
    );
    return cleanImageKnowledge(raw);
  }

  private async analyzeVideo(
    doc: ICreativeLabAsset,
    brief: ProjectBrief | null,
    infoText: string,
    timed: <T>(name: string, fn: () => Promise<T>) => Promise<T>
  ) {
    const clipPath = await defaultStorage.ensureLocal(doc.key);
    const probe = await probeMedia(clipPath);
    if (!probe.hasVideo) throw AppError.badRequest('This file has no video track');
    const analyzedSeconds = round2(Math.min(probe.durationSeconds || MAX_VIDEO_SECONDS, MAX_VIDEO_SECONDS));

    const scratch = path.resolve(process.cwd(), 'storage', 'scratch', `creative-lab-${crypto.randomUUID()}`);
    await fsp.mkdir(scratch, { recursive: true });
    const ff = (args: string[]) => runFfmpeg(['-hide_banner', '-loglevel', 'error', '-y', ...args]);

    try {
      // Small preview copy: upright, long side 640 px, 5 fps, mono audio (small enough to send inline)
      const preview = path.join(scratch, 'preview.mp4');
      await timed(`Make a small preview copy (640 px, 5 fps${probe.durationSeconds > MAX_VIDEO_SECONDS ? `, first ${MAX_VIDEO_SECONDS} s` : ''})`, () =>
        ff([
          '-i', clipPath,
          '-t', String(analyzedSeconds),
          '-vf', "scale='if(gte(iw,ih),640,-2)':'if(gte(iw,ih),-2,640)',fps=5,format=yuv420p",
          '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '30',
          ...(probe.hasAudio ? ['-c:a', 'aac', '-b:a', '48k', '-ac', '1'] : ['-an']),
          preview,
        ])
      );

      const scenesFile = path.join(scratch, 'scenes.txt');
      await timed('Find exact hard cuts (ffmpeg scene detection)', () =>
        ff(['-i', preview, '-map', '0:v', '-vf', `select='gt(scene,0.30)',metadata=print:file='${escapeFilterPath(scenesFile)}'`, '-f', 'null', '-'])
      );
      const sceneCuts = parseSceneCuts(fs.existsSync(scenesFile) ? await fsp.readFile(scenesFile, 'utf8') : '').filter(
        (t) => t > 0.2 && t < analyzedSeconds - 0.2
      );

      const video = await fsp.readFile(preview);
      const raw = await timed(`Gemini watches and listens to the clip (${env.GEMINI_TEXT_MODEL})`, () =>
        getAIProvider().generateJson(buildVideoPrompt({ analyzedSeconds, sceneCuts, hasAudio: probe.hasAudio, brief, infoText }), {
          images: [{ data: video, mimeType: 'video/mp4' }],
          feature: 'Creative Lab video knowledge',
        })
      );
      const knowledge = cleanVideoKnowledge(raw, {
        durationSeconds: probe.durationSeconds,
        analyzedSeconds,
        sceneCuts,
        hasAudio: probe.hasAudio,
      });
      if (!knowledge.shots.length) {
        throw new AppError(502, 'AI_FAILED', 'Gemini returned no shots for this clip. Press "Analyze again".');
      }

      await timed(`Take ${knowledge.shots.length} shot thumbnails`, async () => {
        for (const shot of knowledge.shots) {
          shot.thumbnail = await this.videoFrame(preview, (shot.bestStart + shot.bestEnd) / 2, 240).catch(() => undefined);
        }
      });
      return knowledge;
    } finally {
      await fsp.rm(scratch, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  /** One frame as a small JPEG data URL */
  private async videoFrame(videoPath: string, atSeconds: number, width: number): Promise<string> {
    const dir = path.resolve(process.cwd(), 'storage', 'scratch');
    await fsp.mkdir(dir, { recursive: true });
    const file = path.join(dir, `frame-${crypto.randomUUID()}.jpg`);
    try {
      await runFfmpeg([
        '-hide_banner', '-loglevel', 'error', '-y',
        '-ss', Math.max(0, atSeconds).toFixed(2), '-i', videoPath,
        '-frames:v', '1', '-vf', `scale=${width}:-2`, '-q:v', '5', file,
      ]);
      return `data:image/jpeg;base64,${(await fsp.readFile(file)).toString('base64')}`;
    } finally {
      await fsp.rm(file, { force: true }).catch(() => undefined);
    }
  }
}

export const creativeLabService = new CreativeLabService();
