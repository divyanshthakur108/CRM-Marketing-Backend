import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { aiStudioService } from '../src/modules/ai/aiStudioService.js';

describe('AI Studio Duplicate Prevention & Photo Analysis Tests', () => {
  it('computes accurate dHash and identifies exact duplicates vs distinct compositions', async () => {
    // Generate a synthetic living room test image (1080x1350)
    const baseImg = await sharp({
      create: {
        width: 1080,
        height: 1350,
        channels: 4,
        background: { r: 180, g: 150, b: 120, alpha: 1 },
      },
    })
      .composite([
        {
          input: Buffer.from(`
            <svg width="1080" height="1350" xmlns="http://www.w3.org/2000/svg">
              <rect x="100" y="200" width="880" height="400" fill="#2D3748" />
              <circle cx="540" cy="900" r="250" fill="#D4AF37" />
              <rect x="200" y="1100" width="680" height="150" fill="#4A5568" />
            </svg>
          `),
          blend: 'over',
        },
      ])
      .png()
      .toBuffer();

    // 1. Identical copy
    const copyBuf = Buffer.from(baseImg);
    const hashBase = await aiStudioService.computeDHash(baseImg);
    const hashCopy = await aiStudioService.computeDHash(copyBuf);

    expect(hashBase).toBe(hashCopy);
    expect(aiStudioService.hammingDistance(hashBase, hashCopy)).toBe(0);
    expect(aiStudioService.computeSimilarity(hashBase, hashCopy)).toBe(1.0);

    // 2. Distinct composition: top ceiling crop
    const ceilingCrop = await sharp(baseImg)
      .extract({ left: 100, top: 50, width: 880, height: 600 })
      .resize(1080, 1350, { fit: 'cover' })
      .modulate({ brightness: 1.08, saturation: 1.15 })
      .png()
      .toBuffer();

    const hashCeiling = await aiStudioService.computeDHash(ceilingCrop);
    const distCeiling = aiStudioService.hammingDistance(hashBase, hashCeiling);
    const simCeiling = aiStudioService.computeSimilarity(hashBase, hashCeiling);

    // Ceiling crop should be visually distinct (Hamming distance >= 6, similarity < 0.90)
    expect(distCeiling).toBeGreaterThanOrEqual(6);
    expect(simCeiling).toBeLessThan(0.90);

    // 3. Distinct composition: macro detail crop
    const macroDetailCrop = await sharp(baseImg)
      .extract({ left: 400, top: 750, width: 350, height: 400 })
      .resize(1080, 1350, { fit: 'cover' })
      .tint({ r: 255, g: 240, b: 210 })
      .png()
      .toBuffer();

    const hashMacro = await aiStudioService.computeDHash(macroDetailCrop);
    const distMacro = aiStudioService.hammingDistance(hashBase, hashMacro);
    const simMacro = aiStudioService.computeSimilarity(hashBase, hashMacro);

    expect(distMacro).toBeGreaterThanOrEqual(10);
    expect(simMacro).toBeLessThan(0.85);
  });

  it('guarantees hamming distance calculation is symmetric and bounded [0, 64]', () => {
    const h1 = 'ffff0000ffff0000';
    const h2 = '0000ffff0000ffff';
    const dist = aiStudioService.hammingDistance(h1, h2);
    expect(dist).toBe(64);
    expect(aiStudioService.computeSimilarity(h1, h2)).toBe(0.0);

    // Symmetry check
    expect(aiStudioService.hammingDistance(h2, h1)).toBe(dist);
    expect(aiStudioService.computeSimilarity(h2, h1)).toBe(0.0);
  });
});
