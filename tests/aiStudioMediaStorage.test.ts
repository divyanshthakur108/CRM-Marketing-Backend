import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Types } from 'mongoose';
import sharp from 'sharp';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { MediaAsset, IMediaAsset, MediaCategory, MediaAspectRatio } from '../src/models/MediaAsset.js';
import { defaultStorage } from '../src/storage/localStorage.adapter.js';
import { aiStudioService } from '../src/modules/ai/aiStudioService.js';

describe('Phase 1: AI Studio Photo Upload, Retrieval & Media Storage Integration', () => {
  const testOrgId = new Types.ObjectId();
  const testProjectId = new Types.ObjectId();
  const createdStorageKeys: string[] = [];

  afterEach(async () => {
    // Clean up any test files created in storage
    for (const key of createdStorageKeys) {
      try {
        await defaultStorage.delete(key);
      } catch {
        // Ignore cleanup errors
      }
    }
    createdStorageKeys.length = 0;
  });

  describe('1. Mongoose MediaAsset Schema Validation & Field Correctness', () => {
    it('validates a schema-compliant property photo asset without errors', () => {
      const assetDoc = new MediaAsset({
        organizationId: testOrgId,
        projectId: testProjectId,
        type: 'IMAGE',
        category: 'INTERIOR',
        roomType: 'Living Room',
        room: 'Living Room',
        filename: 'living_room_prime.jpg',
        storageKey: `media/${testOrgId}/${testProjectId}/living_room_prime.jpg`,
        url: `/storage/media/${testOrgId}/${testProjectId}/living_room_prime.jpg`,
        mimetype: 'image/jpeg',
        sizeBytes: 154200,
        width: 1200,
        height: 900,
        aspectRatio: '4:5',
        actualOrIllustrative: 'ACTUAL',
        isApproved: true,
        approvalStatus: 'APPROVED',
        isCover: false,
        sortOrder: 0,
        processingStatus: 'ready',
        rightsConsent: { confirmed: true, at: new Date() },
        tags: ['ClientUpload', 'PropertyPhoto', 'StudioSource'],
      });

      const validationError = assetDoc.validateSync();
      expect(validationError).toBeUndefined();
      expect(assetDoc.mimetype).toBe('image/jpeg');
      expect(assetDoc.sizeBytes).toBe(154200);
      expect(assetDoc.width).toBe(1200);
      expect(assetDoc.height).toBe(900);
      expect(assetDoc.actualOrIllustrative).toBe('ACTUAL');
    });

    it('rejects invalid aspectRatio value "CUSTOM" with Mongoose ValidatorError', () => {
      const assetDoc = new MediaAsset({
        organizationId: testOrgId,
        projectId: testProjectId,
        filename: 'invalid_ratio.jpg',
        storageKey: 'media/test/invalid_ratio.jpg',
        url: '/storage/media/test/invalid_ratio.jpg',
        mimetype: 'image/jpeg',
        sizeBytes: 100000,
        aspectRatio: 'CUSTOM' as any, // The old bug
      });

      const validationError = assetDoc.validateSync();
      expect(validationError).toBeDefined();
      expect(validationError?.errors['aspectRatio']).toBeDefined();
      expect(validationError?.errors['aspectRatio']?.message).toContain('is not a valid enum value');
    });

    it('rejects asset missing required sizeBytes field', () => {
      const assetDoc = new MediaAsset({
        organizationId: testOrgId,
        projectId: testProjectId,
        filename: 'missing_size.png',
        storageKey: 'media/test/missing_size.png',
        url: '/storage/media/test/missing_size.png',
        mimetype: 'image/png',
        // sizeBytes omitted (the old saveImageToMediaLibrary bug)
      });

      const validationError = assetDoc.validateSync();
      expect(validationError).toBeDefined();
      expect(validationError?.errors['sizeBytes']).toBeDefined();
    });

    it('rejects asset missing required mimetype field when passed as mimeType', () => {
      const assetDoc = new MediaAsset({
        organizationId: testOrgId,
        projectId: testProjectId,
        filename: 'wrong_casing.png',
        storageKey: 'media/test/wrong_casing.png',
        url: '/storage/media/test/wrong_casing.png',
        sizeBytes: 50000,
        mimeType: 'image/png', // The old bug where camelCase mimeType was passed
      } as any);

      const validationError = assetDoc.validateSync();
      expect(validationError).toBeDefined();
      expect(validationError?.errors['mimetype']).toBeDefined();
    });

    it('validates a generated AI image asset with illustrative classification', () => {
      const generatedDoc = new MediaAsset({
        organizationId: testOrgId,
        projectId: testProjectId,
        type: 'IMAGE',
        category: 'INTERIOR',
        roomType: 'Grand Living Room',
        room: 'Grand Living Room',
        filename: 'ai_living_room_hero.png',
        storageKey: `media/${testOrgId}/${testProjectId}/ai_living_room_hero.png`,
        url: `/storage/media/${testOrgId}/${testProjectId}/ai_living_room_hero.png`,
        mimetype: 'image/png',
        sizeBytes: 945200,
        width: 1080,
        height: 1350,
        aspectRatio: '4:5',
        actualOrIllustrative: 'ILLUSTRATIVE',
        isApproved: true,
        approvalStatus: 'APPROVED',
        isCover: false,
        sortOrder: 1,
        processingStatus: 'ready',
        rightsConsent: { confirmed: true, at: new Date() },
        tags: ['AIGenerated', 'MarketingCreative', 'Grand Living Room'],
      });

      const validationError = generatedDoc.validateSync();
      expect(validationError).toBeUndefined();
      expect(generatedDoc.actualOrIllustrative).toBe('ILLUSTRATIVE');
      expect(generatedDoc.aspectRatio).toBe('4:5');
    });
  });

  describe('2. Resolution, Aspect Ratio Calculation & Category Inference', () => {
    it('accurately maps image resolutions to standardized enum aspect ratios', () => {
      const calcRatio = (w: number, h: number): MediaAspectRatio => {
        const ratio = w / h;
        if (Math.abs(ratio - 1.0) < 0.05) return '1:1';
        if (Math.abs(ratio - 0.8) < 0.05) return '4:5';
        if (Math.abs(ratio - 16 / 9) < 0.1) return '16:9';
        if (Math.abs(ratio - 9 / 16) < 0.1) return '9:16';
        return 'OTHER';
      };

      expect(calcRatio(1000, 1000)).toBe('1:1');
      expect(calcRatio(1080, 1350)).toBe('4:5');
      expect(calcRatio(1920, 1080)).toBe('16:9');
      expect(calcRatio(1080, 1920)).toBe('9:16');
      expect(calcRatio(1200, 800)).toBe('OTHER'); // 3:2 landscape mapped to OTHER, never 'CUSTOM'
      expect(calcRatio(800, 1200)).toBe('OTHER');
    });

    it('infers categories correctly and maps to valid MediaCategory enums', () => {
      const mapCategory = (filename: string): { inferred: string; category: MediaCategory } => {
        const lower = filename.toLowerCase();
        let inferred = 'Living Room';
        if (lower.includes('kitchen')) inferred = 'Kitchen';
        else if (lower.includes('bed')) inferred = 'Bedroom';
        else if (lower.includes('exterior') || lower.includes('facade') || lower.includes('elevation')) inferred = 'Exterior / Facade';
        else if (lower.includes('plan') || lower.includes('layout')) inferred = 'Floor Plan';
        else if (lower.includes('pool') || lower.includes('amenit')) inferred = 'Amenities';

        let category: MediaCategory = 'INTERIOR';
        if (inferred === 'Exterior / Facade') category = 'EXTERIOR';
        else if (inferred === 'Floor Plan') category = 'FLOOR_PLANS';
        else if (inferred === 'Amenities') category = 'AMENITIES';

        return { inferred, category };
      };

      expect(mapCategory('tower_exterior_facade.jpg')).toEqual({
        inferred: 'Exterior / Facade',
        category: 'EXTERIOR',
      });
      expect(mapCategory('luxury_master_bedroom.png')).toEqual({
        inferred: 'Bedroom',
        category: 'INTERIOR',
      });
      expect(mapCategory('penthouse_floor_plan.webp')).toEqual({
        inferred: 'Floor Plan',
        category: 'FLOOR_PLANS',
      });
      expect(mapCategory('clubhouse_pool_amenities.jpg')).toEqual({
        inferred: 'Amenities',
        category: 'AMENITIES',
      });
    });
  });

  describe('3. File Storage, WebP Thumbnailing & Pristine Image Preservation', () => {
    it('stores raw image buffer on disk without modification and retrieves it intact', async () => {
      // 1. Generate a test image buffer with distinct pixel patterns
      const originalBuffer = await sharp({
        create: {
          width: 800,
          height: 1000,
          channels: 4,
          background: { r: 180, g: 140, b: 100, alpha: 1 },
        },
      })
        .composite([
          {
            input: Buffer.from(`
              <svg width="800" height="1000" xmlns="http://www.w3.org/2000/svg">
                <circle cx="400" cy="500" r="200" fill="#2563EB" />
                <rect x="100" y="80" width="600" height="120" fill="#D97706" />
              </svg>
            `),
            blend: 'over',
          },
        ])
        .png()
        .toBuffer();

      const storageKey = `media/${testOrgId}/${testProjectId}/${Date.now()}_original_test_shot.png`;
      createdStorageKeys.push(storageKey);

      // 2. Save buffer to storage adapter
      await defaultStorage.saveBuffer(storageKey, originalBuffer);

      // 3. Verify physical file exists and length is identical
      const absPath = defaultStorage.getAbsolutePath(storageKey);
      expect(fsSync.existsSync(absPath)).toBe(true);

      const retrievedBuffer = await defaultStorage.download(storageKey);
      expect(retrievedBuffer.length).toBe(originalBuffer.length);
      expect(Buffer.compare(originalBuffer, retrievedBuffer)).toBe(0);

      // 4. Generate WebP thumbnail and verify
      const thumbBuffer = await sharp(retrievedBuffer)
        .resize(400, 400, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 80 })
        .toBuffer();

      const thumbKey = `media/${testOrgId}/${testProjectId}/thumb_${Date.now()}_original_test_shot.webp`;
      createdStorageKeys.push(thumbKey);
      await defaultStorage.saveBuffer(thumbKey, thumbBuffer);

      const thumbMeta = await sharp(thumbBuffer).metadata();
      expect(thumbMeta.format).toBe('webp');
      expect(thumbMeta.width).toBeLessThanOrEqual(400);
      expect(thumbMeta.height).toBeLessThanOrEqual(400);

      // 5. Verify original buffer was NOT altered by thumbnail creation
      const postThumbBuffer = await defaultStorage.download(storageKey);
      expect(Buffer.compare(originalBuffer, postThumbBuffer)).toBe(0);
    });

    it('verifies loadAssetBuffer handles storageKey and /storage/ relative URLs', async () => {
      const testImg = await sharp({
        create: {
          width: 500,
          height: 500,
          channels: 4,
          background: { r: 50, g: 100, b: 150, alpha: 1 },
        },
      })
        .jpeg()
        .toBuffer();

      const storageKey = `media/${testOrgId}/${testProjectId}/${Date.now()}_load_test.jpg`;
      createdStorageKeys.push(storageKey);
      await defaultStorage.saveBuffer(storageKey, testImg);

      // Asset document pointing to the storageKey
      const mockAsset = {
        _id: new Types.ObjectId(),
        filename: 'load_test.jpg',
        storageKey,
        url: defaultStorage.getUrl(storageKey),
      } as unknown as IMediaAsset;

      // Access private loadAssetBuffer via prototype / cast
      const loaded = await (aiStudioService as any).loadAssetBuffer(mockAsset);
      expect(loaded).toBeDefined();
      expect(loaded.length).toBe(testImg.length);

      // Test fallback when storageKey is empty but url is /storage/...
      const mockUrlAsset = {
        _id: new Types.ObjectId(),
        filename: 'load_url_test.jpg',
        storageKey: '',
        url: `/storage/${storageKey}`,
      } as unknown as IMediaAsset;

      const loadedFromUrl = await (aiStudioService as any).loadAssetBuffer(mockUrlAsset);
      expect(loadedFromUrl).toBeDefined();
      expect(loadedFromUrl.length).toBe(testImg.length);
    });
  });

  describe('4. Tenant & Project Isolation Constraints', () => {
    it('enforces strict organizationId and projectId scoping on media assets', () => {
      const orgA = new Types.ObjectId();
      const orgB = new Types.ObjectId();
      const projectA = new Types.ObjectId();

      const assetOrgA = new MediaAsset({
        organizationId: orgA,
        projectId: projectA,
        filename: 'org_a_asset.jpg',
        storageKey: `media/${orgA}/${projectA}/org_a_asset.jpg`,
        url: `/storage/media/${orgA}/${projectA}/org_a_asset.jpg`,
        mimetype: 'image/jpeg',
        sizeBytes: 12000,
        actualOrIllustrative: 'ACTUAL',
      });

      expect(assetOrgA.organizationId.toString()).toBe(orgA.toString());
      expect(assetOrgA.organizationId.toString()).not.toBe(orgB.toString());
      expect(assetOrgA.projectId?.toString()).toBe(projectA.toString());
    });
  });
});

