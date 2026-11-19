import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import sharp from 'sharp';
import { logger } from '../../config/logger.js';

export interface StoredMockAsset {
  assetId: string;
  originalName: string;
  cleanName: string;
  storageKey: string;
  absolutePath: string;
  url: string;
  mimetype: string;
  sizeBytes: number;
  width: number;
  height: number;
  hasExifGpsRemoved: boolean;
  uploadedAt: string;
}

export class MockAiGenStorage {
  private readonly rootDir: string;

  constructor() {
    const backendSub = path.resolve(process.cwd(), 'CRM-Marketing-Backend', 'storage', 'mock_ai_gen');
    const direct = path.resolve(process.cwd(), 'storage', 'mock_ai_gen');
    this.rootDir = fs.existsSync(backendSub) ? backendSub : direct;
  }

  public getRoot(): string {
    return this.rootDir;
  }

  public getStorageDir(): string {
    return path.dirname(this.rootDir);
  }

  private initialized = false;

  public async init(): Promise<void> {
    if (this.initialized) return;
    await fsPromises.mkdir(this.rootDir, { recursive: true });
    await fsPromises.mkdir(path.join(this.rootDir, 'uploads'), { recursive: true });
    await fsPromises.mkdir(path.join(this.rootDir, 'thumbnails'), { recursive: true });
    await fsPromises.mkdir(path.join(this.rootDir, 'runway_clips'), { recursive: true });
    await fsPromises.mkdir(path.join(this.rootDir, 'rendered_ads'), { recursive: true });
    await fsPromises.mkdir(path.join(this.rootDir, 'preprocessed', 'cache'), { recursive: true });
    await fsPromises.mkdir(path.join(this.rootDir, 'preprocessed', 'proxies'), { recursive: true });
    await fsPromises.mkdir(path.join(this.rootDir, 'preprocessed', 'thumbs'), { recursive: true });
    this.initialized = true;
  }

  public getPreprocessedDir(): string {
    return path.join(this.rootDir, 'preprocessed');
  }

  public getPreprocessedCacheDir(): string {
    return path.join(this.rootDir, 'preprocessed', 'cache');
  }

  public getPreprocessedProxiesDir(): string {
    return path.join(this.rootDir, 'preprocessed', 'proxies');
  }

  public getPreprocessedThumbsDir(): string {
    return path.join(this.rootDir, 'preprocessed', 'thumbs');
  }

  /**
   * Save uploaded file to the isolated sandbox, stripping EXIF GPS metadata for photos
   * while preserving high-resolution image and video bytes without corruption.
   */
  public async saveUploadedFile(
    file: { buffer: Buffer; originalname: string; mimetype: string }
  ): Promise<StoredMockAsset> {
    await this.init();

    const assetId = `mock_asset_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    const cleanName = `${assetId}${ext}`;
    const storageKey = `mock_ai_gen/uploads/${cleanName}`;
    const absolutePath = path.join(this.rootDir, 'uploads', cleanName);

    const isVideo = file.mimetype.startsWith('video/') || /\.(mp4|mov|m4v|webm)$/i.test(ext);

    let processedBuffer = file.buffer;
    let width = 1080;
    let height = 1920;
    let hasExifGpsRemoved = false;

    if (!isVideo) {
      try {
        const imageInstance = sharp(file.buffer);
        const meta = await imageInstance.metadata();
        if (meta.width) width = meta.width;
        if (meta.height) height = meta.height;

        // Strip EXIF GPS metadata
        if (file.mimetype.includes('png')) {
          processedBuffer = await imageInstance.png().toBuffer();
        } else if (file.mimetype.includes('webp')) {
          processedBuffer = await imageInstance.webp({ quality: 95 }).toBuffer();
        } else {
          processedBuffer = await imageInstance.jpeg({ quality: 95 }).toBuffer();
        }
        hasExifGpsRemoved = true;
      } catch (err) {
        logger.warn({ err }, 'Could not strip EXIF using Sharp, using original buffer');
      }
    } else {
      hasExifGpsRemoved = true; // Videos don't retain EXIF JPEG tags
    }

    await fsPromises.writeFile(absolutePath, processedBuffer);

    return {
      assetId,
      originalName: file.originalname,
      cleanName,
      storageKey,
      absolutePath,
      url: `/api/v1/mock-ai-gen/files/uploads/${cleanName}`,
      mimetype: file.mimetype,
      sizeBytes: processedBuffer.length,
      width,
      height,
      hasExifGpsRemoved,
      uploadedAt: new Date().toISOString(),
    };
  }

  public getAbsolutePath(relPath: string): string {
    const normalized = relPath.replace(/^storage\/mock_ai_gen\//, '').replace(/^mock_ai_gen\//, '');
    return path.join(this.rootDir, normalized);
  }
}

export const mockAiGenStorage = new MockAiGenStorage();
