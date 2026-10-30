import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { Express } from 'express';
import mongoose, { Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createApp } from '../src/app.js';
import { Organization, User, Membership, Project, MediaAsset, Subscription } from '../src/models/index.js';
import { initAllIndexes } from '../src/models/initIndexes.js';
import { captionService } from '../src/modules/ai/captionService.js';
import { presenterScriptService } from '../src/modules/ai/presenterScriptService.js';
import { buildShowcaseBackgroundSvg, buildShowcaseForegroundSvg, ShowcasePosterData } from '../src/modules/ai/showcasePosterRenderer.js';
import { generateAccessToken } from '../src/utils/token.js';

describe('Dual-Style Posters, 5-Step Captions & Presenter Walkthrough Video', () => {
  let app: Express;
  let mongod: MongoMemoryServer;
  let orgId: Types.ObjectId;
  let userId: Types.ObjectId;
  let token: string;
  let project: any;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri());
    await initAllIndexes();
    app = createApp();

    orgId = new Types.ObjectId();
    userId = new Types.ObjectId();

    await Organization.create({
      _id: orgId,
      name: 'GDPL Mohali Test Org',
      slug: 'gdpl-test',
    });

    await User.create({
      _id: userId,
      email: 'owner@gdpl.test',
      passwordHash: 'dummyhash',
      fullName: 'Marketing Lead',
      firstName: 'Marketing',
      lastName: 'Lead',
    });

    await Membership.create({
      organizationId: orgId,
      userId,
      role: 'org_owner',
      status: 'ACTIVE',
    });

    await Subscription.create({
      organizationId: orgId,
      plan: 'GROWTH',
      status: 'ACTIVE',
      creditsAllocated: 5000,
      creditsRemaining: 5000,
    });

    token = generateAccessToken({
      userId: userId.toString(),
      email: 'owner@gdpl.test',
      organizationId: orgId.toString(),
      role: 'org_owner',
    });

    project = await Project.create({
      organizationId: orgId,
      name: 'The Grand Residency Mohali',
      slug: 'the-grand-residency-mohali',
      category: 'RESIDENTIAL',
      subtype: 'Sky Villas',
      status: 'ACTIVE',
      priceRange: {
        display: '₹ 1.85 Cr',
        min: 18500000,
        max: 25000000,
      },
      reraNumber: 'PBRERA-SAS80-PR0912',
      location: {
        address: 'Sector 66, Airport Road',
        city: 'Mohali',
        state: 'Punjab',
      },
      details: {
        bhk: '4 BHK',
        priceRange: '₹ 1.85 Cr',
      },
    });
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongod.stop();
  });

  describe('1. Dual-Style Poster SVG Rendering', () => {
    const mockData = (stylePreset: 'HERITAGE_LUXURY' | 'HIGH_GROWTH_ROI'): ShowcasePosterData => ({
      category: 'RESIDENTIAL',
      projectName: 'The Grand Residency Mohali',
      city: 'Mohali',
      state: 'Punjab',
      unitType: '4 BHK',
      hasPrice: true,
      priceDisplay: '₹ 1.85 Cr',
      bedrooms: '4 BHK',
      orgName: 'GDPL MOHALI',
      isAllActualPhotos: true,
      stylePreset,
    });

    it('renders HERITAGE_LUXURY background SVG with warm gold accents', () => {
      const bg = buildShowcaseBackgroundSvg(1080, 1350, 24, 'HERITAGE_LUXURY');
      expect(bg).toContain('#FAF8F5');
      expect(bg).toContain('#D97706');
    });

    it('renders HIGH_GROWTH_ROI background SVG with electric cyan glow', () => {
      const bg = buildShowcaseBackgroundSvg(1080, 1350, 24, 'HIGH_GROWTH_ROI');
      expect(bg).toContain('#070B14');
      expect(bg).toContain('#06B6D4');
      expect(bg).toContain('cyanGlow');
    });

    it('renders foreground SVG with style-specific tokens', () => {
      const fgLuxury = buildShowcaseForegroundSvg({
        width: 1080,
        height: 1350,
        ratio: '4:5',
        data: mockData('HERITAGE_LUXURY'),
        heroTag: 'LIVING ROOM',
        thumbTags: ['BEDROOM', 'KITCHEN'],
        heroBox: { x: 48, y: 240, w: 984, h: 490 },
        thumbBoxes: [
          { x: 48, y: 742, w: 320, h: 150 },
          { x: 380, y: 742, w: 320, h: 150 },
        ],
      });
      expect(fgLuxury).toContain('The Grand Residency Mohali');
      expect(fgLuxury).toContain('#D97706'); // Gold accent

      const fgRoi = buildShowcaseForegroundSvg({
        width: 1080,
        height: 1350,
        ratio: '4:5',
        data: mockData('HIGH_GROWTH_ROI'),
        heroTag: 'HIGH-STREET',
        thumbTags: ['RETAIL', 'CORRIDOR'],
        heroBox: { x: 48, y: 240, w: 984, h: 490 },
        thumbBoxes: [
          { x: 48, y: 742, w: 320, h: 150 },
          { x: 380, y: 742, w: 320, h: 150 },
        ],
      });
      expect(fgRoi).toContain('The Grand Residency Mohali');
      expect(fgRoi).toContain('#06B6D4'); // Cyan accent
      expect(fgRoi).toContain('#0B1325'); // Dark card background
    });
  });

  describe('2. Presenter Script Generator (4-Act Structure)', () => {
    it('generates a 4-act presenter script with lower-thirds and speech', async () => {
      const script = await presenterScriptService.generateScript({
        projectName: 'The Grand Residency Mohali',
        city: 'Mohali',
        state: 'Punjab',
        sectorOrLocation: 'Sector 66, Airport Road',
        bhk: '4 BHK',
        areaSqFt: 2850,
        priceDisplay: '₹ 1.85 Cr',
        stylePreset: 'HERITAGE_LUXURY',
      });

      expect(script.acts).toHaveLength(4);
      expect(script.acts[0].actNumber).toBe(1);
      expect(script.acts[0].speech.length).toBeGreaterThan(20);
      expect(script.acts[0].lowerThird.headline).toBeTruthy();
      expect(script.acts[1].actTitle).toContain('Living');
      expect(script.headline).toBeTruthy();
      expect(script.caption).toBeTruthy();
      expect(script.hashtags.length).toBeGreaterThan(0);
    });
  });

  describe('3. 5-Step AI Caption & Ad Copy Generator', () => {
    it('generates 3 platform-ready variants following the 5-step winning formula', async () => {
      const captions = await captionService.generateCaptions({
        projectName: 'The Grand Residency Mohali',
        city: 'Mohali',
        state: 'Punjab',
        sectorOrLocation: 'Sector 66',
        bhk: '4 BHK',
        priceDisplay: '₹ 1.85 Cr',
        reraNumber: 'PBRERA-SAS80-PR0912',
      });

      expect(captions.variants).toHaveLength(3);

      const luxury = captions.variants.find((v) => v.style === 'HERITAGE_LUXURY');
      expect(luxury).toBeDefined();
      expect(luxury!.hook).toContain('Welcome to The Grand Residency');
      expect(luxury!.legalAndHashtags).toContain('PBRERA-SAS80-PR0912');
      expect(luxury!.fullCopy).toContain('PBRERA');

      const roi = captions.variants.find((v) => v.style === 'HIGH_GROWTH_ROI');
      expect(roi).toBeDefined();
      expect(roi!.hook).toContain('HIGH ROI');

      const reel = captions.variants.find((v) => v.style === 'SHORT_REEL');
      expect(reel).toBeDefined();
      expect(reel!.cta).toContain('DM');
    });
  });

  describe('4. API Endpoints for Captions & Presenter Video', () => {
    it('POST /api/v1/ai/projects/:id/generate-captions returns 3 caption variants', async () => {
      const res = await request(app)
        .post(`/api/v1/ai/projects/${project._id}/generate-captions`)
        .set('Authorization', `Bearer ${token}`)
        .send({ stylePreset: 'HERITAGE_LUXURY' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.variants).toHaveLength(3);
    });
  });
});
