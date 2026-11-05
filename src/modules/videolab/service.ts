import crypto from 'crypto';
import fsp from 'fs/promises';
import path from 'path';
import sharp from 'sharp';
import { Types } from 'mongoose';
import { VideoLabRender, IVideoLabRender } from './model.js';
import { buildVariants, LabInput } from './recipe.js';
import { renderRecipeWithFfmpeg } from './ffmpegRenderer.js';
import { defaultStorage } from '../../storage/localStorage.adapter.js';
import { validateFileSignature } from '../../utils/fileSignature.js';
import { probeMedia } from '../../utils/ffmpeg.js';
import { AppError } from '../../utils/AppError.js';
import { logger } from '../../config/logger.js';

export type LabAssetKind = 'video' | 'image' | 'audio';

export interface LabAsset {
  key: string;
  url: string;
  kind: LabAssetKind;
  filename: string;
  sizeBytes: number;
  durationSeconds?: number;
  width?: number;
  height?: number;
  hasAudio?: boolean;
}

/** Only files uploaded through the Lab can be used as Lab inputs */
export const LAB_ASSET_KEY = /^video-lab\/assets\/[a-f0-9-]{36}\.(mp4|mov|webm|png|jpg|jpeg|webp|mp3|m4a|wav|aac)$/;

const AUDIO_EXT: Record<string, string> = {
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/aac': 'aac',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/wave': 'wav',
};

/** Magic-byte check for audio files (fileSignature.ts covers images and video only) */
function detectAudio(buffer: Buffer, mime: string): string | null {
  const ext = AUDIO_EXT[mime.toLowerCase()];
  if (!ext) return null;
  const head = buffer.subarray(0, 12);
  const isMp3 = head.subarray(0, 3).toString('latin1') === 'ID3' || (head[0] === 0xff && (head[1] & 0xe0) === 0xe0);
  const isWav = head.subarray(0, 4).toString('latin1') === 'RIFF' && head.subarray(8, 12).toString('latin1') === 'WAVE';
  const isMp4 = head.subarray(4, 8).toString('latin1') === 'ftyp';
  if ((ext === 'mp3' || ext === 'aac') && (isMp3 || ext === 'aac')) return ext;
  if (ext === 'wav' && isWav) return 'wav';
  if (ext === 'm4a' && isMp4) return 'm4a';
  return null;
}

// Renders run one at a time in the background
let renderChain: Promise<void> = Promise.resolve();

export class VideoLabService {
  public async uploadAsset(file: Express.Multer.File): Promise<LabAsset> {
    const mime = file.mimetype.toLowerCase();
    let kind: LabAssetKind;
    let ext: string;

    if (mime.startsWith('audio/')) {
      const audioExt = detectAudio(file.buffer, mime);
      if (!audioExt) throw AppError.badRequest('Unsupported or invalid audio file. Use MP3, M4A, AAC or WAV.');
      kind = 'audio';
      ext = audioExt;
    } else {
      const detection = validateFileSignature(file.buffer, file.originalname, file.mimetype);
      if (!detection.valid || (detection.type !== 'IMAGE' && detection.type !== 'VIDEO')) {
        throw AppError.badRequest(detection.error || 'Only videos (MP4, MOV, WebM), images and audio are allowed');
      }
      kind = detection.type === 'VIDEO' ? 'video' : 'image';
      ext = (path.extname(file.originalname).slice(1) || detection.ext || 'bin').toLowerCase();
      if (ext === 'jpeg') ext = 'jpg';
    }

    const key = `video-lab/assets/${crypto.randomUUID()}.${ext}`;
    if (!LAB_ASSET_KEY.test(key)) throw AppError.badRequest(`Unsupported file extension: .${ext}`);

    const upload = await defaultStorage.upload(
      { buffer: file.buffer, filename: file.originalname, mimetype: file.mimetype },
      'video-lab/assets',
      key
    );

    const asset: LabAsset = { key, url: upload.url, kind, filename: file.originalname, sizeBytes: file.size };
    try {
      if (kind === 'image') {
        const meta = await sharp(file.buffer).metadata();
        asset.width = meta.width;
        asset.height = meta.height;
      } else {
        const probe = await probeMedia(defaultStorage.getAbsolutePath(key));
        asset.durationSeconds = Math.round(probe.durationSeconds * 10) / 10;
        asset.width = probe.width;
        asset.height = probe.height;
        asset.hasAudio = probe.hasAudio;
        if (kind === 'video' && !probe.hasVideo) throw AppError.badRequest('This file has no video track');
      }
    } catch (err) {
      if (err instanceof AppError) throw err;
      logger.warn({ err, key }, 'Video Lab: could not read media details');
    }
    return asset;
  }

  public async createRenders(input: LabInput, variants: number, adminUserId: string): Promise<IVideoLabRender[]> {
    const keys = [...input.clips.map((c) => c.key), input.logoKey, input.musicKey].filter(Boolean) as string[];
    for (const key of keys) {
      if (!LAB_ASSET_KEY.test(key)) throw AppError.badRequest(`Not a Video Lab file: ${key}`);
    }

    const recipes = buildVariants(input, variants);
    if (recipes.some((r) => !r.cuts.length)) {
      throw AppError.badRequest('No usable shots: every shot is marked "cut". Keep at least one shot, or use whole clips.');
    }
    const batchId = crypto.randomUUID();
    const docs = await VideoLabRender.insertMany(
      recipes.map((recipe) => ({
        createdBy: new Types.ObjectId(adminUserId),
        batchId,
        engine: 'ffmpeg',
        status: 'QUEUED',
        input,
        recipe,
      }))
    );

    for (const doc of docs) {
      const id = doc._id.toString();
      renderChain = renderChain.then(() => this.renderOne(id)).catch(() => undefined);
    }
    return docs as unknown as IVideoLabRender[];
  }

  public async listRenders(limit = 30): Promise<IVideoLabRender[]> {
    // Renders interrupted by a server restart would otherwise stay "rendering" forever
    await VideoLabRender.updateMany(
      { status: { $in: ['QUEUED', 'RENDERING'] }, updatedAt: { $lt: new Date(Date.now() - 20 * 60 * 1000) } },
      { $set: { status: 'FAILED', error: 'Interrupted (the server restarted). Please generate again.' } }
    );
    return VideoLabRender.find().sort({ createdAt: -1 }).limit(limit);
  }

  public async getRender(id: string): Promise<IVideoLabRender> {
    if (!Types.ObjectId.isValid(id)) throw AppError.notFound('Render not found');
    const doc = await VideoLabRender.findById(id);
    if (!doc) throw AppError.notFound('Render not found');
    return doc;
  }

  private async renderOne(id: string): Promise<void> {
    const doc = await VideoLabRender.findById(id);
    if (!doc || doc.status !== 'QUEUED') return;

    const started = Date.now();
    doc.status = 'RENDERING';
    doc.startedAt = new Date();
    doc.steps = [];
    await doc.save();

    const workDir = path.resolve(process.cwd(), 'storage', 'scratch', `video-lab-${id}`);
    const outputKey = `video-lab/renders/${id}/reel.mp4`;
    const posterKey = `video-lab/renders/${id}/poster.jpg`;
    const outputPath = defaultStorage.getAbsolutePath(outputKey);
    const posterPath = defaultStorage.getAbsolutePath(posterKey);

    try {
      await fsp.mkdir(path.dirname(outputPath), { recursive: true });
      const result = await renderRecipeWithFfmpeg(doc.recipe, {
        workDir,
        outputVideoPath: outputPath,
        outputPosterPath: posterPath,
        onStep: (step) => {
          // Live progress for the Lab page
          VideoLabRender.updateOne({ _id: id }, { $push: { steps: step } }).catch(() => undefined);
        },
      });

      const uploadStarted = Date.now();
      await defaultStorage.persist(outputKey);
      await defaultStorage.persist(posterKey);

      await VideoLabRender.updateOne(
        { _id: id },
        {
          $set: {
            status: 'DONE',
            outputKey,
            outputUrl: defaultStorage.getUrl(outputKey),
            posterUrl: defaultStorage.getUrl(posterKey),
            durationSeconds: Math.round(result.durationSeconds * 10) / 10,
            renderMs: Date.now() - started,
            finishedAt: new Date(),
          },
          $push: { steps: { name: 'Upload result to storage', ms: Date.now() - uploadStarted } },
        }
      );
    } catch (err) {
      logger.error({ err, renderId: id }, 'Video Lab render failed');
      await VideoLabRender.updateOne(
        { _id: id },
        {
          $set: {
            status: 'FAILED',
            error: err instanceof Error ? err.message.slice(0, 1500) : String(err),
            renderMs: Date.now() - started,
            finishedAt: new Date(),
          },
        }
      );
    } finally {
      await fsp.rm(workDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

export const videoLabService = new VideoLabService();
