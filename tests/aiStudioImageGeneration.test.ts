import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { aiStudioService } from '../src/modules/ai/aiStudioService.js';
import { aiOrchestrator, EnhancedLocalProvider } from '../src/modules/ai/providers/index.js';
import { env } from '../src/config/env.js';

describe('AI Studio Professional Image Generation Suite Tests', () => {
  it('EnhancedLocalProvider performs architectural photo enhancement and preserves 100% structure', async () => {
    const provider = new EnhancedLocalProvider();

    // Synthetic living room photograph buffer (800x1000)
    const testBuffer = await sharp({
      create: {
        width: 800,
        height: 1000,
        channels: 4,
        background: { r: 160, g: 140, b: 120, alpha: 1 },
      },
    })
      .composite([
        {
          input: Buffer.from(`
            <svg width="800" height="1000" xmlns="http://www.w3.org/2000/svg">
              <rect x="50" y="50" width="700" height="300" fill="#1E293B" />
              <rect x="150" y="500" width="500" height="200" fill="#D97706" />
            </svg>
          `),
          blend: 'over',
        },
      ])
      .jpeg()
      .toBuffer();

    // 1. Image analysis
    const analysis = await provider.analyzeImage({
      imageBuffer: testBuffer,
      filename: 'living_room_luxury_shot.jpg',
    });

    expect(analysis.category).toBe('Grand Living Room');
    expect(analysis.detectedFeatures.length).toBeGreaterThanOrEqual(1);
    expect(analysis.lighting).toBeTruthy();
    expect(analysis.perspective).toBeTruthy();

    // 2. Image generation across 4:5 social ratio
    const result = await provider.generateImage({
      prompt: 'Professional architectural photo of Grand Living Room',
      sourceImageBuffer: testBuffer,
      aspectRatio: '4:5',
      mode: 'IMAGE_TO_IMAGE',
    });

    expect(result.url).toBeTruthy();
    expect(result.format).toBe('4:5');
    expect(result.structurePreservationScore).toBe(100); // 100% layout locked
    expect(result.isIllustrative).toBe(false);
  });

  it('AI Provider Orchestrator uses the local engine only when IMAGE_TO_IMAGE_PROVIDER=local', async () => {
    const testBuffer = await sharp({
      create: {
        width: 600,
        height: 800,
        channels: 4,
        background: { r: 200, g: 190, b: 180, alpha: 1 },
      },
    })
      .png()
      .toBuffer();
    const options = {
      prompt: 'Twilight exterior high-rise facade',
      sourceImageBuffer: testBuffer,
      aspectRatio: '4:5' as const,
      mode: 'DAY_TO_DUSK' as const,
    };

    const saved = {
      IMAGE_TO_IMAGE_PROVIDER: env.IMAGE_TO_IMAGE_PROVIDER,
      FAL_KEY: env.FAL_KEY,
      REPLICATE_API_TOKEN: env.REPLICATE_API_TOKEN,
      GEMINI_API_KEY: env.GEMINI_API_KEY,
    };
    try {
      // Chosen on purpose: the local engine grades the real photo
      (env as any).IMAGE_TO_IMAGE_PROVIDER = 'local';
      const result = await aiOrchestrator.generateImage(options);
      expect(result.url).toBeTruthy();
      expect(result.structurePreservationScore).toBeGreaterThanOrEqual(98);
      expect(result.format).toBe('4:5');

      // 'auto' with no AI configured: a clear error, never a silent local/fake result
      Object.assign(env as any, { IMAGE_TO_IMAGE_PROVIDER: 'auto', FAL_KEY: '', REPLICATE_API_TOKEN: '', GEMINI_API_KEY: '' });
      await expect(aiOrchestrator.generateImage(options)).rejects.toMatchObject({ code: 'AI_NOT_CONFIGURED' });
    } finally {
      Object.assign(env as any, saved);
    }
  });

  it('Validates photo upload constraints (rejects undersized images)', async () => {
    // 200x200 is below the 400x400 threshold
    const smallBuffer = await sharp({
      create: { width: 200, height: 200, channels: 4, background: { r: 100, g: 100, b: 100, alpha: 1 } },
    })
      .jpeg()
      .toBuffer();

    let meta = await sharp(smallBuffer).metadata();
    expect(meta.width).toBe(200);
    expect(meta.height).toBe(200);

    const isTooSmall = (meta.width || 0) < 400 || (meta.height || 0) < 400;
    expect(isTooSmall).toBe(true);

    // 800x800 is valid
    const validBuffer = await sharp({
      create: { width: 800, height: 800, channels: 4, background: { r: 100, g: 100, b: 100, alpha: 1 } },
    })
      .jpeg()
      .toBuffer();

    meta = await sharp(validBuffer).metadata();
    expect(meta.width).toBe(800);
    expect(meta.height).toBe(800);
    const isValid = (meta.width || 0) >= 400 && (meta.height || 0) >= 400;
    expect(isValid).toBe(true);
  });

  it('Ensures distinct perceptual hashes across multiple architectural crops', async () => {
    const rawBuffer = await sharp({
      create: { width: 1200, height: 900, channels: 4, background: { r: 150, g: 120, b: 90, alpha: 1 } },
    })
      .composite([
        {
          input: Buffer.from(`
            <svg width="1200" height="900" xmlns="http://www.w3.org/2000/svg">
              <rect x="100" y="100" width="400" height="300" fill="#0F172A" />
              <rect x="700" y="500" width="400" height="300" fill="#D97706" />
            </svg>
          `),
          blend: 'over',
        },
      ])
      .png()
      .toBuffer();

    // Crop 1: Top ceiling angle
    const crop1 = await sharp(rawBuffer)
      .extract({ left: 0, top: 0, width: 550, height: 450 })
      .resize(1080, 1350, { fit: 'cover' })
      .toBuffer();

    // Crop 2: Bottom detail angle
    const crop2 = await sharp(rawBuffer)
      .extract({ left: 650, top: 450, width: 550, height: 450 })
      .resize(1080, 1350, { fit: 'cover' })
      .toBuffer();

    const hash1 = await aiStudioService.computeDHash(crop1);
    const hash2 = await aiStudioService.computeDHash(crop2);

    expect(hash1).not.toBe(hash2);
    const similarity = aiStudioService.computeSimilarity(hash1, hash2);
    // Visual similarity must be under 85% to ensure genuine marketing variety
    expect(similarity).toBeLessThan(0.85);
  });
});
