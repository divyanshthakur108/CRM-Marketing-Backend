import crypto from 'crypto';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import sharp from 'sharp';
import { Types } from 'mongoose';
import { getAIProvider } from '../ai/providers/index.js';
import { defaultStorage } from '../../storage/localStorage.adapter.js';
import { validateFileSignature } from '../../utils/fileSignature.js';
import { escapeFilterPath, probeMedia, runFfmpeg } from '../../utils/ffmpeg.js';
import { AppError } from '../../utils/AppError.js';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { parseSceneCuts } from '../videolab/analyze.js';
import {
  AnalysisStep,
  CreativeLabAsset,
  CreativeLabProject,
  ICreativeLabAsset,
  ICreativeLabProject,
} from './model.js';
import {
  ProjectBrief,
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

  public async getProject(projectId: string): Promise<{ project: ICreativeLabProject; assets: ICreativeLabAsset[] }> {
    const project = await this.getProjectDoc(projectId);
    await CreativeLabAsset.updateMany(
      { projectId: project._id, status: { $in: ['QUEUED', 'ANALYZING'] }, updatedAt: { $lt: new Date(Date.now() - STALE_MS) } },
      { $set: { status: 'FAILED', error: 'Interrupted (the server restarted). Press "Analyze again".' } }
    );
    const assets = await CreativeLabAsset.find({ projectId: project._id }).sort({ createdAt: 1 });
    return { project, assets };
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
    await project.deleteOne();
    return { deletedFiles: assets.length, filesKeptInStorage: true };
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
