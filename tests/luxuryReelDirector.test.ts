import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import fs from 'fs/promises';
import path from 'path';
import {
  LUXURY_DESIGN_TOKENS,
  LuxuryReelDirector,
  LuxuryReelShotInput,
  LuxuryReelProjectInfo,
} from '../src/modules/videolab/luxuryReelDirector.js';
import {
  CreativeDirector,
  CREATIVE_PROFILES,
} from '../src/modules/videolab/creativeDirectorProfiles.js';
import { ReelQualityAuditor } from '../src/modules/videolab/reelQualityAuditor.js';

describe('LuxuryReelDirector, Creative Director & Quality Auditor', () => {
  it('enforces 1080x1920 9:16 vertical canvas and safe zones', () => {
    expect(LUXURY_DESIGN_TOKENS.canvas.width).toBe(1080);
    expect(LUXURY_DESIGN_TOKENS.canvas.height).toBe(1920);
    expect(LUXURY_DESIGN_TOKENS.canvas.aspectRatio).toBe('9:16');
    expect(LUXURY_DESIGN_TOKENS.canvas.fps).toBe(24);
    expect(LUXURY_DESIGN_TOKENS.safeZones.top).toBe(180);
    expect(LUXURY_DESIGN_TOKENS.safeZones.bottom).toBe(380);
    expect(LUXURY_DESIGN_TOKENS.safeZones.left).toBe(64);
    expect(LUXURY_DESIGN_TOKENS.safeZones.right).toBe(64);
  });

  it('provides 3 distinct design profiles: LUXURY_EDITORIAL, MODERN_MINIMAL, BOLD_COMMERCIAL', () => {
    expect(CREATIVE_PROFILES.LUXURY_EDITORIAL).toBeDefined();
    expect(CREATIVE_PROFILES.MODERN_MINIMAL).toBeDefined();
    expect(CREATIVE_PROFILES.BOLD_COMMERCIAL).toBeDefined();

    expect(CREATIVE_PROFILES.LUXURY_EDITORIAL.pacing.shotDurationSeconds).toBe(3.2);
    expect(CREATIVE_PROFILES.MODERN_MINIMAL.pacing.shotDurationSeconds).toBe(2.6);
    expect(CREATIVE_PROFILES.BOLD_COMMERCIAL.pacing.shotDurationSeconds).toBe(2.0);

    expect(CREATIVE_PROFILES.LUXURY_EDITORIAL.palette.accentPrimary).toBe('#D4AF37');
    expect(CREATIVE_PROFILES.MODERN_MINIMAL.palette.accentPrimary).toBe('#10B981');
    expect(CREATIVE_PROFILES.BOLD_COMMERCIAL.palette.accentPrimary).toBe('#F59E0B');
  });

  it('generates a structured storyboard plan with safe zone verification', () => {
    const storyboard = CreativeDirector.generateStoryboardPlan({
      profileType: 'LUXURY_EDITORIAL',
      project: {
        projectName: 'RS Heritage',
        city: 'Chandigarh',
        reraNumber: 'PBRERA-SAS80-PR0485',
        developerName: 'RS Group',
      },
      shots: [
        { roomName: 'Living Lounge', featureTitle: 'Contemporary Living Lounge' },
        { roomName: 'Modular Kitchen', featureTitle: 'Streamlined Modular Kitchen' },
      ],
    });

    expect(storyboard.profile).toBe('LUXURY_EDITORIAL');
    expect(storyboard.canvas.width).toBe(1080);
    expect(storyboard.canvas.height).toBe(1920);
    expect(storyboard.shots.length).toBe(2);

    // Verify safe zone constraint in all shots: safeZoneEndY <= 1500 (strictly clear of 1540 danger limit)
    for (const shot of storyboard.shots) {
      expect(shot.typography.safeZoneEndY).toBeLessThanOrEqual(1500);
    }

    const auditResults = ReelQualityAuditor.auditStoryboardSafeZones(storyboard);
    expect(auditResults.every((r) => r.passed)).toBe(true);
  });

  it('renders a luxury end card adhering to 1080x1920 resolution for each profile', async () => {
    const tmpEndCard = path.join(process.cwd(), 'storage', 'scratch', `test_endcard_${Date.now()}.jpg`);
    await fs.mkdir(path.dirname(tmpEndCard), { recursive: true });

    const project: LuxuryReelProjectInfo = {
      projectName: 'RS Heritage',
      city: 'Chandigarh',
      reraNumber: 'PBRERA-SAS80-PR0485',
      developerName: 'RS Group',
    };

    await LuxuryReelDirector.renderEndCard(project, tmpEndCard, 'LUXURY_EDITORIAL');

    const meta = await sharp(tmpEndCard).metadata();
    expect(meta.width).toBe(1080);
    expect(meta.height).toBe(1920);
    expect(meta.format).toBe('jpeg');

    await fs.unlink(tmpEndCard);
  });

  it('renders decoupled clean visual plate and transparent vector overlay', async () => {
    const tmpClean = path.join(process.cwd(), 'storage', 'scratch', `test_clean_${Date.now()}.jpg`);
    const tmpFrame = path.join(process.cwd(), 'storage', 'scratch', `test_frame_${Date.now()}.jpg`);
    await fs.mkdir(path.dirname(tmpClean), { recursive: true });

    // Mock 1600x720 landscape image
    const mockLandscape = await sharp({
      create: {
        width: 1600,
        height: 720,
        channels: 4,
        background: { r: 50, g: 70, b: 90, alpha: 1 },
      },
    }).jpeg().toBuffer();

    const shot: LuxuryReelShotInput = {
      sourceBuffer: mockLandscape,
      roomName: 'Living Lounge',
      featureTitle: 'Contemporary Living Lounge',
      featureDetail: 'Curated Volumetric Proportions & Ambient Cove Illumination',
      cameraPerspective: 'ARCHITECTURAL ELEVATION (24MM)',
    };

    const project: LuxuryReelProjectInfo = {
      projectName: 'RS Heritage',
      city: 'Chandigarh',
      reraNumber: 'PBRERA-SAS80-PR0485',
    };

    // Test clean base visual
    await LuxuryReelDirector.prepareCleanBaseVisual(shot.sourceBuffer, tmpClean);
    const cleanMeta = await sharp(tmpClean).metadata();
    expect(cleanMeta.width).toBe(1080);
    expect(cleanMeta.height).toBe(1920);

    // Test complete editorial frame
    await LuxuryReelDirector.prepareEditorialFrame(shot, project, 0, 4, tmpFrame);
    const meta = await sharp(tmpFrame).metadata();
    expect(meta.width).toBe(1080);
    expect(meta.height).toBe(1920);

    await fs.unlink(tmpClean);
    await fs.unlink(tmpFrame);
  });
});
