import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { v2 as cloudinary } from 'cloudinary';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

export interface StorageUploadFile {
  buffer: Buffer;
  filename: string;
  mimetype?: string;
}

export interface StorageUploadResult {
  key: string;
  url: string;
  sizeBytes: number;
  mimetype?: string;
}

type ResourceType = 'image' | 'video' | 'raw';

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'avif', 'bmp', 'tiff', 'heic']);
// Cloudinary stores audio under the "video" resource type
const VIDEO_EXTS = new Set(['mp4', 'mov', 'webm', 'mkv', 'avi', 'm4v', 'mp3', 'wav', 'm4a', 'aac', 'ogg']);

/**
 * File storage for uploads and generated assets.
 *
 * - Files are always written to a local working folder (<cwd>/storage) first, because
 *   sharp/ffmpeg need real files on disk.
 * - When Cloudinary is configured, every saved file is also uploaded to Cloudinary, which is
 *   the source of truth. Reads download from Cloudinary when the file isn't on this machine.
 * - Storage keys stay the same either way (e.g. "creatives/<org>/<id>/4x5.png").
 *   GET /storage/<key> redirects to Cloudinary (see app.ts).
 */
export class LocalDiskStorageAdapter {
  private readonly rootDir: string;
  private readonly useCloudinary: boolean;

  constructor(
    rootDir: string = path.resolve(process.cwd(), 'storage'),
    options: { cloudinary?: boolean } = {}
  ) {
    this.rootDir = path.resolve(rootDir);
    this.useCloudinary = options.cloudinary ?? false;
  }

  public get isCloudinary(): boolean {
    return this.useCloudinary;
  }

  /** Local working-copy path for a key. Rejects keys that escape the storage root. */
  public getAbsolutePath(key: string): string {
    const fullPath = path.resolve(this.rootDir, normalizeKey(key));
    if (fullPath !== this.rootDir && !fullPath.startsWith(this.rootDir + path.sep)) {
      throw new Error(`Invalid storage key: ${key}`);
    }
    return fullPath;
  }

  /** Public URL for a key: a Cloudinary URL when configured, otherwise /storage/<key>. */
  public getUrl(key: string): string {
    const normalized = normalizeKey(key);
    if (!this.useCloudinary) return `/storage/${normalized}`;
    const { publicId, resourceType, ext } = toCloudinaryId(normalized);
    return cloudinary.url(publicId, {
      resource_type: resourceType,
      type: 'upload',
      secure: true,
      ...(resourceType !== 'raw' && ext ? { format: ext } : {}),
    });
  }

  /** Saves a file. When `key` is omitted, one is generated inside `folder`. */
  public async upload(
    file: StorageUploadFile,
    folder: string = 'uploads',
    key?: string
  ): Promise<StorageUploadResult> {
    const storageKey = key ?? this.generateKey(folder, file.filename);
    await this.saveBuffer(storageKey, file.buffer);
    return {
      key: storageKey,
      url: this.getUrl(storageKey),
      sizeBytes: file.buffer.length,
      mimetype: file.mimetype || 'application/octet-stream',
    };
  }

  /** Writes a buffer locally and (if configured) uploads it to Cloudinary. */
  public async saveBuffer(key: string, buffer: Buffer): Promise<string> {
    const fullPath = this.getAbsolutePath(key);
    await fsPromises.mkdir(path.dirname(fullPath), { recursive: true });
    await fsPromises.writeFile(fullPath, buffer);
    await this.persist(key);
    return key;
  }

  /**
   * Uploads a file that was written directly to getAbsolutePath(key) (e.g. by ffmpeg or sharp).
   * No-op without Cloudinary. Silently skips when the local file doesn't exist.
   */
  public async persist(key: string): Promise<void> {
    if (!this.useCloudinary) return;
    const fullPath = this.getAbsolutePath(key);
    if (!fs.existsSync(fullPath)) return;
    const { publicId, resourceType } = toCloudinaryId(normalizeKey(key));
    const options = {
      public_id: publicId,
      resource_type: resourceType,
      overwrite: true,
      invalidate: true,
    } as const;
    const size = (await fsPromises.stat(fullPath)).size;
    // Cloudinary rejects single-request uploads over 100MB; use chunked upload for large files
    if (size > 90 * 1024 * 1024) {
      await new Promise<void>((resolve, reject) => {
        cloudinary.uploader.upload_large(fullPath, { ...options, chunk_size: 20 * 1024 * 1024 }, (err) =>
          err ? reject(err) : resolve()
        );
      });
    } else {
      await cloudinary.uploader.upload(fullPath, options);
    }
  }

  /**
   * Makes sure a local working copy exists (downloading from Cloudinary if needed) and returns
   * its path. Never throws: if the file can't be found, the returned path simply won't exist.
   */
  public async ensureLocal(key: string): Promise<string> {
    const fullPath = this.getAbsolutePath(key);
    if (!this.useCloudinary || fs.existsSync(fullPath)) return fullPath;
    try {
      const res = await fetch(this.getUrl(key));
      if (!res.ok) return fullPath;
      await fsPromises.mkdir(path.dirname(fullPath), { recursive: true });
      await fsPromises.writeFile(fullPath, Buffer.from(await res.arrayBuffer()));
    } catch (err) {
      logger.warn({ key, err: (err as Error).message }, 'Could not fetch file from Cloudinary');
    }
    return fullPath;
  }

  public async download(key: string): Promise<Buffer> {
    return fsPromises.readFile(await this.ensureLocal(key));
  }

  /** Streams the local working copy. Call ensureLocal(key) first when using Cloudinary. */
  public createReadStream(key: string, options?: { start?: number; end?: number }): fs.ReadStream {
    return fs.createReadStream(this.getAbsolutePath(key), options);
  }

  public async exists(key: string): Promise<boolean> {
    if (fs.existsSync(this.getAbsolutePath(key))) return true;
    if (!this.useCloudinary) return false;
    const { publicId, resourceType } = toCloudinaryId(normalizeKey(key));
    try {
      await cloudinary.api.resource(publicId, { resource_type: resourceType });
      return true;
    } catch {
      return false;
    }
  }

  public async delete(key: string): Promise<void> {
    await fsPromises.rm(this.getAbsolutePath(key), { force: true });
    if (!this.useCloudinary) return;
    const { publicId, resourceType } = toCloudinaryId(normalizeKey(key));
    await cloudinary.uploader.destroy(publicId, { resource_type: resourceType, invalidate: true });
  }

  private generateKey(folder: string, filename: string): string {
    const ext = path.extname(filename).toLowerCase();
    const base =
      path
        .basename(filename, ext)
        .toLowerCase()
        .replace(/[^a-z0-9-_]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60) || 'file';
    const cleanFolder = folder.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    return `${cleanFolder}/${Date.now()}-${crypto.randomBytes(4).toString('hex')}-${base}${ext}`;
  }
}

function normalizeKey(key: string): string {
  return key.replace(/\\/g, '/').replace(/^\/+/, '').replace(/^storage\//, '');
}

/** Maps a storage key to a Cloudinary public id + resource type (deterministic, so URLs can be built without a lookup). */
function toCloudinaryId(key: string): { publicId: string; resourceType: ResourceType; ext: string } {
  const ext = path.extname(key).slice(1).toLowerCase();
  const resourceType: ResourceType = IMAGE_EXTS.has(ext) ? 'image' : VIDEO_EXTS.has(ext) ? 'video' : 'raw';
  // Image/video public ids drop the extension (Cloudinary adds it as the format); raw files keep it
  const withoutExt = resourceType === 'raw' || !ext ? key : key.slice(0, -(ext.length + 1));
  const folder = env.CLOUDINARY_FOLDER.replace(/^\/+|\/+$/g, '');
  return { publicId: folder ? `${folder}/${withoutExt}` : withoutExt, resourceType, ext };
}

const cloudinaryConfigured = Boolean(
  env.CLOUDINARY_CLOUD_NAME && env.CLOUDINARY_API_KEY && env.CLOUDINARY_API_SECRET
);

if (cloudinaryConfigured) {
  cloudinary.config({
    cloud_name: env.CLOUDINARY_CLOUD_NAME,
    api_key: env.CLOUDINARY_API_KEY,
    api_secret: env.CLOUDINARY_API_SECRET,
    secure: true,
  });
}

export const defaultStorage = new LocalDiskStorageAdapter(undefined, {
  cloudinary: cloudinaryConfigured && env.NODE_ENV !== 'test',
});
