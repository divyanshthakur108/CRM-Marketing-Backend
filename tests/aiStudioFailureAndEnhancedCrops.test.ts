import { describe, it, expect, beforeEach, vi } from 'vitest';
import sharp from 'sharp';
import { GeminiAIProvider } from '../src/modules/ai/providers/geminiProvider.js';
import { aiStudioService } from '../src/modules/ai/aiStudioService.js';
import { AiStudioBatch, Project, MediaAsset, Subscription, UsageLedger } from '../src/models/index.js';
import { defaultStorage } from '../src/storage/localStorage.adapter.js';

describe('AI Studio Failure Path and Enhanced Crops Mode Tests', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('1. Quota errors are not retried', () => {
    it('fails immediately on attempt 1 when Gemini returns limit: 0 / daily quota error', async () => {
      const provider = new GeminiAIProvider();
      const fn = vi.fn().mockRejectedValue(
        new Error(
          'Quota exceeded for quota metric GenerateContent Requests and limit GenerateContent requests per day of service generativelanguage.googleapis.com. limit: 0'
        )
      );

      // Access private retryWithBackoff method
      await expect((provider as any).retryWithBackoff(fn, 4)).rejects.toThrow(
        /limit: 0/
      );

      // Must fail immediately on attempt 1 with zero retries
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('fails immediately on attempt 1 when Gemini returns billing-required error', async () => {
      const provider = new GeminiAIProvider();
      const fn = vi.fn().mockRejectedValue(
        new Error('429 Resource has been exhausted (e.g. check quota or enable billing in console)')
      );

      await expect((provider as any).retryWithBackoff(fn, 4)).rejects.toThrow(
        /billing/i
      );

      // Quota/billing must NOT be retried
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('retries with backoff on transient 503 busy/overloaded error', async () => {
      const provider = new GeminiAIProvider();
      let callCount = 0;
      const fn = vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount < 3) {
          throw new Error('503 Service Unavailable: The model is overloaded. Please try again later.');
        }
        return 'success';
      });

      const res = await (provider as any).retryWithBackoff(fn, 4);
      expect(res).toBe('success');
      expect(callCount).toBe(3);
      expect(fn).toHaveBeenCalledTimes(3);
    });
  });

  describe('2. Enhanced-crops mode labelling', () => {
    it('labels every image "Enhanced photo (not AI-generated)" and never "AI image"', async () => {
      const fakeOrgId = '6ae477756c6134c0bd8bab32';
      const fakeProjId = '6af561e40e375057568381d2';
      const fakeAssetId = '6af563700e37505756838302';

      // Sample living room image buffer
      const sampleImg = await sharp({
        create: {
          width: 800,
          height: 1000,
          channels: 4,
          background: { r: 180, g: 150, b: 120, alpha: 1 },
        },
      })
        .jpeg()
        .toBuffer();

      const upload = await defaultStorage.upload(
        { buffer: sampleImg, filename: 'sample-living-room.jpg', mimetype: 'image/jpeg' },
        'test-photos'
      );

      // Mock Project.findOne
      vi.spyOn(Project, 'findOne').mockResolvedValue({
        _id: fakeProjId,
        name: 'Skyline Luxury Penthouse',
        category: 'RESIDENTIAL',
        location: { city: 'Mumbai', area: 'Bandra West' },
        details: { bhk: 4 },
      } as any);

      // Mock MediaAsset.find
      vi.spyOn(MediaAsset, 'find').mockReturnValue({
        sort: () =>
          Promise.resolve([
            {
              _id: fakeAssetId,
              organizationId: fakeOrgId,
              projectId: fakeProjId,
              type: 'IMAGE',
              filename: 'sample-living-room.jpg',
              storageKey: upload.key,
              url: upload.url,
            },
          ]),
      } as any);

      // Mock Subscription.findOne
      vi.spyOn(Subscription, 'findOne').mockResolvedValue({
        creditsRemaining: 100,
        creditsUsed: 5,
      } as any);
      vi.spyOn(Subscription, 'updateOne').mockResolvedValue({} as any);
      vi.spyOn(UsageLedger, 'create').mockResolvedValue({} as any);

      // Mock AiStudioBatch.findOne
      vi.spyOn(AiStudioBatch, 'findOne').mockReturnValue({
        sort: () => Promise.resolve({ version: 1 }),
      } as any);

      // Mock AiStudioBatch.create
      vi.spyOn(AiStudioBatch, 'create').mockImplementation((data: any) => Promise.resolve(data));

      // Mock analyzePropertyPhotos to return valid vision analysis
      vi.spyOn(aiStudioService, 'analyzePropertyPhotos').mockResolvedValue({
        propertyType: 'RESIDENTIAL 4 BHK',
        architecturalStyle: 'Modern Contemporary',
        dominantColors: ['Beige', 'Warm Amber'],
        lightingProfile: 'Abundant Natural Light',
        roomLayouts: ['Open-concept living room'],
        detectedSpaces: ['Living Room'],
        uniqueFeatures: ['Floor-to-ceiling windows'],
        analysisSummary: 'Spacious modern luxury apartment.',
        analyzedAt: new Date(),
        analyzedPhotos: [
          {
            assetId: fakeAssetId,
            url: upload.url,
            filename: 'sample-living-room.jpg',
            category: 'Living Room',
            detectedFeatures: ['Floor-to-ceiling windows'],
            lighting: 'Abundant Natural Light',
          },
        ],
      });

      // Generate batch in ENHANCED_CROPS mode
      const batch = await aiStudioService.generateBatchImages(fakeOrgId, fakeProjId, {
        targetCount: 10,
        mode: 'ENHANCED_CROPS',
      });

      expect(batch.generationMode).toBe('ENHANCED_CROPS');
      expect(batch.images.length).toBe(10);

      for (const img of batch.images) {
        // Must be explicitly labelled "Enhanced photo (not AI-generated)"
        expect(img.generationMode).toBe('ENHANCED_CROPS');
        expect(img.imageLabel).toBe('Enhanced photo (not AI-generated)');
        expect(img.isIllustrative).toBe(false);

        // Must NEVER contain "AI image" in its label
        expect(img.imageLabel).not.toContain('AI image');
      }
    });
  });

  describe('3. Failed batch shows error in UI state', () => {
    it('processStudioBatchJob marks batch FAILED and preserves errorMessage when generation throws', async () => {
      const fakeBatchId = '6af568cd276a2e2b66d3afe9';
      const fakeOrgId = '6ae477756c6134c0bd8bab32';
      const fakeProjId = '6af561e40e375057568381d2';

      const mockBatch: any = {
        _id: fakeBatchId,
        version: 5,
        status: 'GENERATING',
        targetCount: 10,
        images: [],
        reels: [],
        save: vi.fn().mockResolvedValue(true),
      };

      vi.spyOn(AiStudioBatch, 'findOne').mockResolvedValue(mockBatch);
      vi.spyOn(aiStudioService, 'analyzePropertyPhotos').mockResolvedValue({
        propertyType: 'RESIDENTIAL',
        architecturalStyle: 'Modern',
        dominantColors: ['White'],
        lightingProfile: 'Natural',
        roomLayouts: ['Hall'],
        detectedSpaces: ['Hall'],
        uniqueFeatures: ['Balcony'],
        analysisSummary: 'Test',
        analyzedAt: new Date(),
      });

      // Mock generateBatchImages to throw a quota error
      const quotaError = new Error(
        'AI image generation is unavailable: this Gemini API key has used up its free daily limit. Try again tomorrow, or enable billing in Google AI Studio (https://aistudio.google.com) to remove the limit.'
      );
      vi.spyOn(aiStudioService, 'generateBatchImages').mockRejectedValueOnce(quotaError);

      await expect(
        aiStudioService.processStudioBatchJob(fakeBatchId, fakeOrgId, fakeProjId, { mode: 'AI_IMAGE' })
      ).rejects.toThrow(/free daily limit/);

      // Verify the state saved to MongoDB that the UI reads
      expect(mockBatch.status).toBe('FAILED');
      expect(mockBatch.errorMessage).toContain('this Gemini API key has used up its free daily limit');
      expect(mockBatch.save).toHaveBeenCalled();
      expect(mockBatch.images).toHaveLength(0);
    });
  });
});
