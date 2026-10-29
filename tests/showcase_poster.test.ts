import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { Express } from 'express';
import mongoose, { Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import bcrypt from 'bcryptjs';
import sharp from 'sharp';
import path from 'path';
import fs from 'fs/promises';
import { createApp } from '../src/app.js';
import {
  Organization,
  User,
  Membership,
  Project,
  PropertyUnit,
  MediaAsset,
  Creative,
  Subscription,
  BrandProfile,
} from '../src/models/index.js';
import { initAllIndexes } from '../src/models/initIndexes.js';
import { defaultStorage } from '../src/storage/localStorage.adapter.js';
import {
  selectShowcasePhotos,
  buildShowcaseFacts,
  renderShowcasePoster,
  buildShowcaseForegroundSvg,
} from '../src/modules/ai/showcasePosterRenderer.js';
import { creativeEngineService } from '../src/modules/ai/creativeEngineService.js';

describe('Showcase Poster Generator & Pipeline', () => {
  let app: Express;
  let mongod: MongoMemoryServer;

  // Tenant A
  let orgA: any;
  let ownerUserA: any;
  let ownerTokenA: string;

  // Tenant B
  let orgB: any;
  let ownerUserB: any;
  let ownerTokenB: string;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri());
    await initAllIndexes();
    app = createApp();
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongod.stop();
  });

  beforeEach(async () => {
    await User.deleteMany({});
    await Organization.deleteMany({});
    await Membership.deleteMany({});
    await Project.deleteMany({});
    await PropertyUnit.deleteMany({});
    await MediaAsset.deleteMany({});
    await Creative.deleteMany({});
    await Subscription.deleteMany({});
    await BrandProfile.deleteMany({});

    const passwordHash = await bcrypt.hash('Password123!', 10);

    // Tenant A
    orgA = await Organization.create({
      name: 'Oberoi Prestige Group',
      slug: 'oberoi-prestige',
    });

    await Subscription.create({
      organizationId: orgA._id,
      plan: 'GROWTH',
      status: 'ACTIVE',
      creditsAllocated: 5000,
      creditsRemaining: 1000,
    });

    ownerUserA = await User.create({
      email: 'owner@oberoi.in',
      fullName: 'Oberoi Admin',
      passwordHash,
    });

    await Membership.create({
      organizationId: orgA._id,
      userId: ownerUserA._id,
      role: 'org_owner',
      status: 'ACTIVE',
    });

    const loginResA = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'owner@oberoi.in', password: 'Password123!' });
    ownerTokenA = loginResA.body.data.accessToken;

    // Tenant B
    orgB = await Organization.create({
      name: 'Godrej Competitor',
      slug: 'godrej-competitor',
    });

    ownerUserB = await User.create({
      email: 'owner@godrej.in',
      fullName: 'Godrej Admin',
      passwordHash,
    });

    await Membership.create({
      organizationId: orgB._id,
      userId: ownerUserB._id,
      role: 'org_owner',
      status: 'ACTIVE',
    });

    const loginResB = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'owner@godrej.in', password: 'Password123!' });
    ownerTokenB = loginResB.body.data.accessToken;
  });

  // Helper to create valid project documents satisfying schema
  async function createTestProject(data: Partial<any> = {}) {
    const slugSuffix = Math.random().toString(36).substring(2, 8);
    const defaults = {
      organizationId: orgA._id,
      name: 'Oberoi Sky City',
      slug: `oberoi-sky-city-${slugSuffix}`,
      category: 'RESIDENTIAL',
      subtype: 'Luxury Apartment',
      status: 'ACTIVE',
      version: 1,
      reraNumber: 'MAHARERA-P51800000123',
      location: {
        address: 'Western Express Highway',
        city: 'Mumbai',
        microMarket: 'Borivali East',
        state: 'Maharashtra',
        pincode: '400066',
      },
      priceRange: {
        min: 24500000,
        max: 35000000,
        display: '₹ 2.45 Cr*',
      },
      amenities: ['Infinity Pool', 'Clubhouse', 'Gym'],
      details: {},
    };

    return Project.create({
      ...defaults,
      ...data,
      location: { ...defaults.location, ...data.location },
      priceRange: { ...defaults.priceRange, ...data.priceRange },
      details: { ...defaults.details, ...data.details },
    });
  }

  // Helper to create valid image asset buffer in storage
  async function createMockPhoto(params: {
    orgId: Types.ObjectId;
    projectId: Types.ObjectId;
    unitId?: Types.ObjectId;
    filename: string;
    category?: string;
    room?: string;
    tags?: string[];
    isCover?: boolean;
    sortOrder?: number;
    actualOrIllustrative?: 'ACTUAL' | 'ILLUSTRATIVE';
  }) {
    const key = `projects/${params.projectId.toString()}/${params.filename}`;
    const buffer = await sharp({
      create: {
        width: 1200,
        height: 800,
        channels: 4,
        background: { r: 13, g: 148, b: 136, alpha: 1 },
      },
    })
      .jpeg()
      .toBuffer();

    await defaultStorage.saveBuffer(key, buffer);

    return MediaAsset.create({
      organizationId: params.orgId,
      projectId: params.projectId,
      unitId: params.unitId,
      filename: params.filename,
      storageKey: key,
      url: `/storage/${key}`,
      mimetype: 'image/jpeg',
      sizeBytes: buffer.length,
      type: 'IMAGE',
      category: params.category || 'EXTERIOR',
      room: params.room,
      tags: params.tags || [],
      actualOrIllustrative: params.actualOrIllustrative || 'ACTUAL',
      rightsConsent: { confirmed: true, at: new Date() },
      isApproved: true,
      approvalStatus: 'APPROVED',
      isCover: params.isCover || false,
      sortOrder: params.sortOrder || 0,
      processingStatus: 'ready',
    });
  }

  // =========================================================================
  // 1. FULL PROJECT DATA: 4 Photos, Price, RERA, All Actual Photos
  // =========================================================================
  it('generates Showcase poster in 4:5, 1:1, 9:16 with verified facts and exact dimensions', async () => {
    const project = await createTestProject({
      name: 'Oberoi Sky City Tower A',
      details: {
        allInclusive: true,
        termsNote: 'Govt taxes extra',
        bhk: 4,
        carpetAreaSqFt: 3200,
        possessionStatus: 'READY TO MOVE',
      },
      ownerContacts: [
        { name: 'Exclusive Sales Desk', phone: '+91 99887 76655', email: 'sales@oberoi.in' },
      ],
    });

    const unit = await PropertyUnit.create({
      organizationId: orgA._id,
      projectId: project._id,
      unitNumber: 'Tower A - 3201',
      unitType: '4 BHK',
      price: 24500000,
      priceDisplay: '₹ 2.45 Cr*',
      carpetAreaSqFt: 3200,
      status: 'AVAILABLE',
    });

    // 4 Distinct Approved Actual Photos
    const hero = await createMockPhoto({
      orgId: orgA._id,
      projectId: project._id,
      unitId: unit._id,
      filename: 'living-room.jpg',
      room: 'Living Area',
      isCover: true,
      actualOrIllustrative: 'ACTUAL',
    });

    const kitchen = await createMockPhoto({
      orgId: orgA._id,
      projectId: project._id,
      unitId: unit._id,
      filename: 'mod-kitchen.jpg',
      room: 'Modular Kitchen',
      tags: ['kitchen'],
      actualOrIllustrative: 'ACTUAL',
    });

    const bedroom = await createMockPhoto({
      orgId: orgA._id,
      projectId: project._id,
      unitId: unit._id,
      filename: 'master-bedroom.jpg',
      room: 'Master Bedroom',
      tags: ['bedroom'],
      actualOrIllustrative: 'ACTUAL',
    });

    const bathroom = await createMockPhoto({
      orgId: orgA._id,
      projectId: project._id,
      unitId: unit._id,
      filename: 'spa-bath.jpg',
      room: 'Spa Bathroom',
      tags: ['bathroom'],
      actualOrIllustrative: 'ACTUAL',
    });

    const candidateMedia = [hero, kitchen, bedroom, bathroom];
    const selectedPhotos = selectShowcasePhotos(candidateMedia, { unitId: unit._id });

    expect(selectedPhotos.hero.asset._id.toString()).toBe(hero._id.toString());
    expect(selectedPhotos.thumbs.length).toBe(3);
    expect(selectedPhotos.isAllActual).toBe(true);

    const posterData = buildShowcaseFacts({
      project,
      unit,
      organization: orgA,
      brand: null,
      isAllActualPhotos: selectedPhotos.isAllActual,
    });

    expect(posterData.category).toBe('RESIDENTIAL');
    expect(posterData.projectName).toBe('Oberoi Sky City Tower A');
    expect(posterData.hasPrice).toBe(true);
    expect(posterData.priceDisplay).toBe('₹ 2.45 Cr*');
    expect(posterData.priceNote).toBe('All-Inclusive Onwards');
    expect(posterData.bedrooms).toBe('4 BHK');
    expect(posterData.possession).toBe('READY TO MOVE');
    expect(posterData.reraNumber).toBe('MAHARERA-P51800000123');
    expect(posterData.isAllActualPhotos).toBe(true);
    expect(posterData.orgName).toBe('Oberoi Prestige Group');

    // Render all 3 ratios
    const ratios: Array<{ ratio: '4:5' | '1:1' | '9:16'; w: number; h: number }> = [
      { ratio: '4:5', w: 1080, h: 1350 },
      { ratio: '1:1', w: 1080, h: 1080 },
      { ratio: '9:16', w: 1080, h: 1920 },
    ];

    const samplesDir = path.resolve('storage', 'samples');
    await fs.mkdir(samplesDir, { recursive: true });

    for (const r of ratios) {
      const { pngBuffer, jpegBuffer } = await renderShowcasePoster({
        ratio: r.ratio,
        width: r.w,
        height: r.h,
        data: posterData,
        selectedPhotos,
      });

      expect(pngBuffer.length).toBeGreaterThan(10000);
      expect(jpegBuffer.length).toBeGreaterThan(10000);

      const metadata = await sharp(pngBuffer).metadata();
      expect(metadata.width).toBe(r.w);
      expect(metadata.height).toBe(r.h);
      expect(metadata.format).toBe('png');

      // Save sample 1
      await fs.writeFile(path.join(samplesDir, `sample_project1_full_${r.ratio.replace(':', 'x')}.png`), pngBuffer);
    }

    // Verify SVG Overlay content assertions
    const fgSvg = buildShowcaseForegroundSvg({
      width: 1080,
      height: 1350,
      ratio: '4:5',
      data: posterData,
      heroTag: selectedPhotos.hero.tag,
      thumbTags: selectedPhotos.thumbs.map((t) => t.tag),
      heroBox: { x: 48, y: 240, w: 984, h: 490 },
      thumbBoxes: [
        { x: 48, y: 742, w: 320, h: 150 },
        { x: 380, y: 742, w: 320, h: 150 },
        { x: 712, y: 742, w: 320, h: 150 },
      ],
    });

    expect(fgSvg).toContain('RESIDENTIAL');
    expect(fgSvg).toContain('Oberoi Sky City Tower A');
    expect(fgSvg).toContain('Mumbai, Maharashtra • 4 BHK Luxury Apartment • 3,200 Sq. Ft.');
    expect(fgSvg).toContain('INVESTMENT');
    expect(fgSvg).toContain('₹ 2.45 Cr*');
    expect(fgSvg).toContain('All-Inclusive Onwards');
    expect(fgSvg).toContain('Request Details');
    expect(fgSvg).toContain('Book a Visit →');
    expect(fgSvg).toContain('RERA Registered (RERA No. MAHARERA-P51800000123)');
    expect(fgSvg).toContain('Verified Authentic On-Site Photography');
    expect(fgSvg).toContain('Subject to availability');
    expect(fgSvg).not.toContain('AI Real Estate CRM Demo');
  });

  // =========================================================================
  // 2. PROJECT MISSING PRICE: Hide Investment Block, Expand Chips
  // =========================================================================
  it('hides INVESTMENT block and expands chips when price is missing', async () => {
    const project = await createTestProject({
      name: 'DLF Cyber Corporate Park',
      category: 'COMMERCIAL',
      subtype: 'Office Space',
      location: { city: 'Gurugram', state: 'Haryana' },
      priceRange: { min: 0, max: 0, display: 'Price on Request' },
      details: {
        areaSqFt: 15000,
        possessionStatus: 'READY TO MOVE',
      },
    });

    const photo = await createMockPhoto({
      orgId: orgA._id,
      projectId: project._id,
      filename: 'office-lobby.jpg',
      room: 'Main Lobby',
      actualOrIllustrative: 'ACTUAL',
    });

    const photo2 = await createMockPhoto({
      orgId: orgA._id,
      projectId: project._id,
      filename: 'office-conference.jpg',
      room: 'Conference Hall',
      actualOrIllustrative: 'ACTUAL',
    });

    const selectedPhotos = selectShowcasePhotos([photo, photo2]);
    const posterData = buildShowcaseFacts({
      project,
      unit: null,
      organization: orgA,
      brand: null,
      isAllActualPhotos: true,
    });

    expect(posterData.hasPrice).toBe(false);
    expect(posterData.priceDisplay).toBe('');

    const fgSvg = buildShowcaseForegroundSvg({
      width: 1080,
      height: 1350,
      ratio: '4:5',
      data: posterData,
      heroTag: 'MAIN LOBBY',
      thumbTags: ['CONFERENCE HALL'],
      heroBox: { x: 48, y: 240, w: 984, h: 490 },
      thumbBoxes: [{ x: 48, y: 742, w: 984, h: 150 }],
    });

    expect(fgSvg).not.toContain('INVESTMENT');
    expect(fgSvg).not.toContain('All-Inclusive Onwards');
    expect(fgSvg).toContain('COMMERCIAL');
    expect(fgSvg).toContain('DLF Cyber Corporate Park');

    // Save sample 2 (Commercial missing price, 2 photos)
    const samplesDir = path.resolve('storage', 'samples');
    const { pngBuffer: p2Buffer } = await renderShowcasePoster({
      ratio: '4:5',
      width: 1080,
      height: 1350,
      data: posterData,
      selectedPhotos,
    });
    await fs.writeFile(path.join(samplesDir, 'sample_project2_commercial_4x5.png'), p2Buffer);
  });

  // =========================================================================
  // 3. PROJECT MISSING RERA: Never claim RERA
  // =========================================================================
  it('omits RERA statement when reraNumber is not present', async () => {
    const project = await createTestProject({
      name: 'Green Villa Estate',
      category: 'RESIDENTIAL',
      subtype: 'Villa',
      reraNumber: '', // missing
      location: { city: 'Pune', state: 'Maharashtra' },
    });

    const photo = await createMockPhoto({
      orgId: orgA._id,
      projectId: project._id,
      filename: 'villa-exterior.jpg',
      room: 'Facade',
    });

    const selectedPhotos = selectShowcasePhotos([photo]);
    const posterData = buildShowcaseFacts({
      project,
      unit: null,
      organization: orgA,
      brand: null,
      isAllActualPhotos: true,
    });

    expect(posterData.reraNumber).toBeFalsy();

    const fgSvg = buildShowcaseForegroundSvg({
      width: 1080,
      height: 1350,
      ratio: '4:5',
      data: posterData,
      heroTag: 'FACADE',
      thumbTags: [],
      heroBox: { x: 48, y: 240, w: 984, h: 620 },
      thumbBoxes: [],
    });

    expect(fgSvg).not.toContain('RERA');
    expect(fgSvg).toContain('Subject to availability');
  });

  // =========================================================================
  // 4. PROJECT WITH 2 PHOTOS: Hero + 1 Thumb Stretched Full Width
  // =========================================================================
  it('renders hero + 1 thumb stretched to full width when only 2 photos exist', async () => {
    const project = await createTestProject({
      name: 'Sky Deck Duplex',
      category: 'RESIDENTIAL',
    });

    const p1 = await createMockPhoto({
      orgId: orgA._id,
      projectId: project._id,
      filename: 'hero.jpg',
      room: 'Drawing Hall',
      isCover: true,
    });

    const p2 = await createMockPhoto({
      orgId: orgA._id,
      projectId: project._id,
      filename: 'terrace.jpg',
      room: 'Sky Deck',
    });

    const selectedPhotos = selectShowcasePhotos([p1, p2]);
    expect(selectedPhotos.thumbs.length).toBe(1);

    const posterData = buildShowcaseFacts({
      project,
      unit: null,
      organization: orgA,
      brand: null,
      isAllActualPhotos: true,
    });

    const { pngBuffer } = await renderShowcasePoster({
      ratio: '4:5',
      width: 1080,
      height: 1350,
      data: posterData,
      selectedPhotos,
    });

    const metadata = await sharp(pngBuffer).metadata();
    expect(metadata.width).toBe(1080);
    expect(metadata.height).toBe(1350);
  });

  // =========================================================================
  // 5. PROJECT WITH VERY LONG NAME: Auto-fit 2-line title wrapping
  // =========================================================================
  it('auto-fits and wraps very long project names into 2 lines cleanly', async () => {
    const project = await createTestProject({
      name: 'The Ultra Luxurious Grand Imperial Presidential Signature Residences & Golf Country Club',
      category: 'RESIDENTIAL',
      location: { city: 'Bengaluru', state: 'Karnataka' },
      priceRange: { min: 45000000, max: 80000000, display: '₹ 4.50 Cr' },
      reraNumber: '', // no RERA
    });

    const photo = await createMockPhoto({
      orgId: orgA._id,
      projectId: project._id,
      filename: 'estate.jpg',
      actualOrIllustrative: 'ILLUSTRATIVE',
    });

    const selectedPhotos = selectShowcasePhotos([photo]);
    const posterData = buildShowcaseFacts({
      project,
      unit: null,
      organization: orgA,
      brand: null,
      isAllActualPhotos: selectedPhotos.isAllActual,
    });

    const fgSvg = buildShowcaseForegroundSvg({
      width: 1080,
      height: 1350,
      ratio: '4:5',
      data: posterData,
      heroTag: 'LIVING AREA',
      thumbTags: [],
      heroBox: { x: 48, y: 240, w: 984, h: 620 },
      thumbBoxes: [],
    });

    // Check title wrapping produced 2 <text> tags for the title lines
    const titleMatches = fgSvg.match(/font-weight="800" fill="#0F172A"/g);
    expect(titleMatches?.length).toBe(2);

    // Save sample 3 (Long name, missing RERA, illustrative)
    const samplesDir = path.resolve('storage', 'samples');
    const { pngBuffer: p3Buffer } = await renderShowcasePoster({
      ratio: '4:5',
      width: 1080,
      height: 1350,
      data: posterData,
      selectedPhotos,
    });
    await fs.writeFile(path.join(samplesDir, 'sample_project3_longname_4x5.png'), p3Buffer);
  });

  // =========================================================================
  // 6. ILLUSTRATIVE PHOTO: Omit Verified Authentic Photography claim
  // =========================================================================
  it('omits Verified Authentic Photography claim when any photo is illustrative', async () => {
    const project = await createTestProject({
      name: 'Future Horizon Heights',
      category: 'RESIDENTIAL',
    });

    const actualPhoto = await createMockPhoto({
      orgId: orgA._id,
      projectId: project._id,
      filename: 'actual-site.jpg',
      actualOrIllustrative: 'ACTUAL',
    });

    const illustrativePhoto = await createMockPhoto({
      orgId: orgA._id,
      projectId: project._id,
      filename: 'render-concept.jpg',
      actualOrIllustrative: 'ILLUSTRATIVE',
    });

    const selectedPhotos = selectShowcasePhotos([actualPhoto, illustrativePhoto]);
    expect(selectedPhotos.isAllActual).toBe(false);

    const posterData = buildShowcaseFacts({
      project,
      unit: null,
      organization: orgA,
      brand: null,
      isAllActualPhotos: selectedPhotos.isAllActual,
    });

    const fgSvg = buildShowcaseForegroundSvg({
      width: 1080,
      height: 1350,
      ratio: '4:5',
      data: posterData,
      heroTag: 'LIVING AREA',
      thumbTags: ['INTERIOR'],
      heroBox: { x: 48, y: 240, w: 984, h: 490 },
      thumbBoxes: [{ x: 48, y: 742, w: 984, h: 150 }],
    });

    expect(fgSvg).not.toContain('Verified Authentic On-Site Photography');
    expect(fgSvg).toContain('Subject to availability');
  });

  // =========================================================================
  // 7. ZERO USABLE PHOTOS: Throws 'needs photos'
  // =========================================================================
  it('throws "needs photos" error when zero usable photos exist', () => {
    expect(() => selectShowcasePhotos([])).toThrow(/needs photos/i);
  });

  // =========================================================================
  // 8. MEDIA ISOLATION & UNIT FILTERING
  // =========================================================================
  it('excludes photos belonging to another unit and ensures distinct photo selections', async () => {
    const project = await createTestProject({
      name: 'Emerald Towers',
      category: 'RESIDENTIAL',
    });

    const unit1 = await PropertyUnit.create({
      organizationId: orgA._id,
      projectId: project._id,
      unitNumber: '101',
      unitType: '2 BHK',
      price: 15000000,
      carpetAreaSqFt: 1100,
    });

    const unit2 = await PropertyUnit.create({
      organizationId: orgA._id,
      projectId: project._id,
      unitNumber: '201',
      unitType: '3 BHK',
      price: 22000000,
      carpetAreaSqFt: 1600,
    });

    const photoUnit1 = await createMockPhoto({
      orgId: orgA._id,
      projectId: project._id,
      unitId: unit1._id,
      filename: 'unit1-hall.jpg',
      room: 'Unit 1 Living',
    });

    const photoUnit2 = await createMockPhoto({
      orgId: orgA._id,
      projectId: project._id,
      unitId: unit2._id,
      filename: 'unit2-hall.jpg',
      room: 'Unit 2 Living',
    });

    const projectPhoto = await createMockPhoto({
      orgId: orgA._id,
      projectId: project._id,
      filename: 'clubhouse.jpg',
      room: 'Clubhouse',
    });

    // Requesting photos specifically for Unit 1
    const selected = selectShowcasePhotos([photoUnit1, photoUnit2, projectPhoto], {
      unitId: unit1._id,
    });

    const selectedIds = [selected.hero.asset._id.toString(), ...selected.thumbs.map((t) => t.asset._id.toString())];
    expect(selectedIds).toContain(photoUnit1._id.toString());
    expect(selectedIds).not.toContain(photoUnit2._id.toString());
    expect(selectedIds).toContain(projectPhoto._id.toString());
  });

  // =========================================================================
  // 9. CROSS-ORGANIZATION ACCESS IS BLOCKED (404 / UNAUTHORIZED)
  // =========================================================================
  it('blocks cross-organization creative regeneration and returns 404', async () => {
    const projectA = await createTestProject({
      organizationId: orgA._id,
      name: 'Private Manor',
      category: 'RESIDENTIAL',
    });

    const creativeA = await Creative.create({
      organizationId: orgA._id,
      projectId: projectA._id,
      type: 'POSTER',
      format: '4:5',
      renderedAssetUrl: '/storage/sample.png',
      posterFrameUrl: '/storage/sample.png',
      files: [{ ratio: '4:5', url: '/storage/sample.png' }],
      sourceAssetIds: [],
      status: 'ready_for_review',
      approvalStatus: 'PENDING_APPROVAL',
      version: 1,
      headline: 'Private Manor Poster',
      caption: 'Luxury Manor',
      cost: 1,
      generatedBy: 'template',
      isIllustrative: false,
      factCheckPassed: false,
      factCheckIssues: [],
      reReviewRequired: false,
      history: [],
    });

    // Org B attempts to regenerate Org A's creative
    const resB = await request(app)
      .post(`/api/v1/ai/creatives/${creativeA._id}/regenerate`)
      .set('Authorization', `Bearer ${ownerTokenB}`)
      .send();

    expect(resB.status).toBe(404);
  });

  // =========================================================================
  // 10. REGENERATION LIFECYCLE: New version, reset approval, posterFrameUrl
  // =========================================================================
  it('regenerates poster into v2, resets approval to PENDING_APPROVAL, and updates posterFrameUrl', async () => {
    const projectA = await createTestProject({
      organizationId: orgA._id,
      name: 'Lodha Park View',
      category: 'RESIDENTIAL',
      location: { city: 'Mumbai', state: 'Maharashtra' },
    });

    const photoA = await createMockPhoto({
      orgId: orgA._id,
      projectId: projectA._id,
      filename: 'lodha-hall.jpg',
      room: 'Grand Hall',
    });

    const creativeA = await Creative.create({
      organizationId: orgA._id,
      projectId: projectA._id,
      type: 'POSTER',
      format: '4:5',
      renderedAssetUrl: '/storage/sample_v1.png',
      posterFrameUrl: '/storage/sample_v1.png',
      files: [{ ratio: '4:5', url: '/storage/sample_v1.png' }],
      sourceAssetIds: [photoA._id],
      status: 'APPROVED',
      approvalStatus: 'APPROVED',
      version: 1,
      headline: 'Lodha Park View Poster',
      caption: 'Luxury residences',
      cost: 1,
      generatedBy: 'template',
      isIllustrative: false,
      factCheckPassed: true,
      factCheckIssues: [],
      reReviewRequired: false,
      history: [],
    });

    const res = await request(app)
      .post(`/api/v1/ai/creatives/${creativeA._id}/regenerate`)
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .send();

    expect(res.status).toBe(200);
    expect(res.body.data.version).toBe(2);
    expect(res.body.data.approvalStatus).toBe('PENDING_APPROVAL');
    expect(res.body.data.status).toBe('ready_for_review');
    expect(res.body.data.posterFrameUrl).toBeTruthy();
    expect(res.body.data.renderedAssetUrl).toBeTruthy();
    expect(res.body.data.history.length).toBe(1);
    expect(res.body.data.history[0].version).toBe(1);
  });
});
