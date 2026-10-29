import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { Express } from 'express';
import mongoose, { Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import bcrypt from 'bcryptjs';
import path from 'path';
import fs from 'fs/promises';
import { spawn } from 'child_process';
import sharp from 'sharp';
import { createApp } from '../src/app.js';
import {
  Organization,
  User,
  Membership,
  Project,
  MediaAsset,
  Creative,
  Plan,
  PlanItem,
  Notification,
} from '../src/models/index.js';
import { initAllIndexes } from '../src/models/initIndexes.js';
import { defaultStorage } from '../src/storage/localStorage.adapter.js';
import { creativeEngineService } from '../src/modules/ai/creativeEngineService.js';

describe('Video Extension, Occasion Campaigns, and Media Isolation (Conditions 1-4)', () => {
  let app: Express;
  let mongod: MongoMemoryServer;

  // Tenant A (Client A: GDPL Mohali)
  let orgA: { _id: Types.ObjectId; name: string };
  let ownerTokenA: string;
  let projectA: any;
  let photoAssetA: any;
  let videoAssetA: any;

  // Tenant B (Client B: Competitor Developer)
  let orgB: { _id: Types.ObjectId; name: string };
  let ownerTokenB: string;
  let projectB: any;

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
    await MediaAsset.deleteMany({});
    await Creative.deleteMany({});
    await Plan.deleteMany({});
    await PlanItem.deleteMany({});
    await Notification.deleteMany({});

    const passwordHash = await bcrypt.hash('Password123!', 10);

    // 1. Setup Tenant A (GDPL Mohali)
    orgA = (await Organization.create({
      name: 'GDPL Mohali',
      slug: 'gdpl-mohali',
    })) as unknown as { _id: Types.ObjectId; name: string };

    const userA = await User.create({
      email: 'admin@gdplmohali.com',
      fullName: 'GDPL Lead Developer',
      passwordHash,
    });
    await Membership.create({
      organizationId: orgA._id,
      userId: userA._id,
      role: 'org_owner',
    });

    const loginA = await request(app).post('/api/v1/auth/login').send({
      email: 'admin@gdplmohali.com',
      password: 'Password123!',
    });
    ownerTokenA = loginA.body.data.accessToken;

    // Project A: Regal Heights Sector 91 Mohali
    projectA = await Project.create({
      organizationId: orgA._id,
      name: 'Regal Heights',
      slug: 'regal-heights-91',
      category: 'RESIDENTIAL',
      subtype: 'Luxury Apartments',
      location: {
        address: 'Sector 91',
        city: 'Mohali',
        state: 'Punjab',
        microMarket: 'Sector 91',
        pincode: '160091',
      },
      reraNumber: 'PBRERA-SAS81-PR0543',
      priceRange: {
        min: 12500000,
        max: 24500000,
        display: '₹ 1.25 Cr Onwards',
      },
      status: 'READY',
    });

    // 2. Setup Tenant B (Client B)
    orgB = (await Organization.create({
      name: 'Apex Horizon Realty',
      slug: 'apex-horizon',
    })) as unknown as { _id: Types.ObjectId; name: string };

    const userB = await User.create({
      email: 'owner@apexrealty.in',
      fullName: 'Apex Director',
      passwordHash,
    });
    await Membership.create({
      organizationId: orgB._id,
      userId: userB._id,
      role: 'org_owner',
    });

    const loginB = await request(app).post('/api/v1/auth/login').send({
      email: 'owner@apexrealty.in',
      password: 'Password123!',
    });
    ownerTokenB = loginB.body.data.accessToken;

    projectB = await Project.create({
      organizationId: orgB._id,
      name: 'Apex Tower',
      slug: 'apex-tower',
      category: 'COMMERCIAL',
      subtype: 'Office Complex',
      location: {
        address: 'Airport Road',
        city: 'Mohali',
        state: 'Punjab',
        microMarket: 'Sector 82',
        pincode: '160082',
      },
      reraNumber: 'PBRERA-SAS81-PR0999',
      priceRange: {
        min: 20000000,
        max: 50000000,
        display: '₹ 2.00 Cr Onwards',
      },
      status: 'READY',
    });

    // 3. Create real photo asset for Project A in local storage
    const samplePhotoBuf = await sharp({
      create: {
        width: 1200,
        height: 900,
        channels: 4,
        background: { r: 15, g: 23, b: 42, alpha: 1 },
      },
    })
      .jpeg()
      .toBuffer();

    const photoStorageKey = `projects/${projectA._id}/photo_${Date.now()}.jpg`;
    await defaultStorage.saveBuffer(photoStorageKey, samplePhotoBuf);

    photoAssetA = await MediaAsset.create({
      organizationId: orgA._id,
      projectId: projectA._id,
      filename: 'living_room_hero.jpg',
      storageKey: photoStorageKey,
      url: `/storage/${photoStorageKey}`,
      mimetype: 'image/jpeg',
      sizeBytes: samplePhotoBuf.length,
      type: 'IMAGE',
      category: 'INTERIOR',
      room: 'Living Room',
      actualOrIllustrative: 'ACTUAL',
      rightsConsent: { confirmed: true, at: new Date() },
      aspectRatio: '4:5',
      isApproved: true,
      approvalStatus: 'APPROVED',
      isCover: true,
      processingStatus: 'ready',
    });

    // 4. Create a 2-second real test MP4 video using ffmpeg
    const testVideoDir = path.join(process.cwd(), 'storage', 'temp');
    await fs.mkdir(testVideoDir, { recursive: true });
    const testVideoFile = path.join(testVideoDir, `test_walkthrough_${Date.now()}.mp4`);
    const ffmpegBin = creativeEngineService.resolveFfmpegBinary();

    await new Promise<void>((resolve, reject) => {
      const proc = spawn(ffmpegBin, [
        '-f', 'lavfi',
        '-i', 'testsrc=duration=2:size=1080x1920:rate=24',
        '-c:v', 'libx264',
        '-pix_fmt', 'yuv420p',
        '-y',
        testVideoFile,
      ]);
      proc.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`ffmpeg exited with code ${code}`));
      });
      proc.on('error', reject);
    });

    const videoBytes = await fs.readFile(testVideoFile);
    const videoStorageKey = `projects/${projectA._id}/walkthrough_${Date.now()}.mp4`;
    await defaultStorage.saveBuffer(videoStorageKey, videoBytes);

    videoAssetA = await MediaAsset.create({
      organizationId: orgA._id,
      projectId: projectA._id,
      filename: 'walkthrough_exterior.mp4',
      storageKey: videoStorageKey,
      url: `/storage/${videoStorageKey}`,
      mimetype: 'video/mp4',
      sizeBytes: videoBytes.length,
      type: 'VIDEO',
      category: 'VIDEOS',
      actualOrIllustrative: 'ACTUAL',
      rightsConsent: { confirmed: true, at: new Date() },
      aspectRatio: '9:16',
      duration: 2.0,
      isApproved: true,
      approvalStatus: 'APPROVED',
      processingStatus: 'ready',
    });
  });

  // =========================================================================
  // CONDITION 1: AI-Powered Video Extension
  // =========================================================================
  it('Condition 1: analyzes client video, generates natural continuation clip, and stitches seamlessly', async () => {
    const res = await request(app)
      .post(`/api/v1/ai/projects/${projectA._id}/extend-video`)
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .send({
        mediaAssetId: videoAssetA._id.toString(),
        customPrompt: 'Steady slow forward dolly through luxury living room with warm evening ambient lights',
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.creative).toBeDefined();

    const creative = res.body.data.creative;
    expect(creative.type).toBe('REEL');
    expect(creative.extensionType).toBe('AI_CONTINUATION');
    expect(creative.status).toBe('ready_for_review');
    expect(creative.approvalStatus).toBe('PENDING_APPROVAL');
    expect(creative.renderedAssetUrl).toContain('.mp4');
    expect(creative.posterFrameUrl).toBeDefined();

    // Verify scheduled post preparation
    expect(res.body.data.planItem).toBeDefined();
    expect(res.body.data.planItem.approvalStatus).toBe('PENDING_APPROVAL');
    expect(res.body.data.planItem.publishStatus).toBe('SCHEDULED');

    // Verify client notification was generated
    expect(res.body.data.notification).toBeDefined();
    expect(res.body.data.notification.title).toContain('Video Extension Ready for Review');
  }, 35000);

  // =========================================================================
  // CONDITION 2: AI-Generated Content Based on Occasions
  // =========================================================================
  it('Condition 2: retrieves presets and automatically generates Diwali occasion campaign (posters + reel)', async () => {
    // 1. Fetch presets
    const presetsRes = await request(app)
      .get('/api/v1/ai/occasions')
      .set('Authorization', `Bearer ${ownerTokenA}`);

    expect(presetsRes.status).toBe(200);
    expect(presetsRes.body.data.length).toBeGreaterThanOrEqual(6);
    const diwaliPreset = presetsRes.body.data.find((o: any) => o.key === 'diwali');
    expect(diwaliPreset).toBeDefined();
    expect(diwaliPreset.badge).toContain('DIWALI');

    // 2. Generate occasion campaign
    const genRes = await request(app)
      .post(`/api/v1/ai/projects/${projectA._id}/generate-occasion`)
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .send({
        occasion: 'diwali',
        customOffer: '*Diwali Special: Zero Stamp Duty & Gold Coin on Spot Booking',
        customHeadline: 'Regal Heights Festive Abode',
      });

    expect(genRes.status).toBe(201);
    expect(genRes.body.success).toBe(true);

    const { posterCreative, reelCreative, planItem, notification } = genRes.body.data;
    expect(posterCreative).toBeDefined();
    expect(posterCreative.type).toBe('POSTER');
    expect(posterCreative.occasion).toBe('diwali');
    expect(posterCreative.files.length).toBe(3); // 4:5, 1:1, 9:16

    expect(reelCreative).toBeDefined();
    expect(reelCreative.type).toBe('REEL');
    expect(reelCreative.occasion).toBe('diwali');

    // Verify scheduled post & notification created
    expect(planItem).toBeDefined();
    expect(notification).toBeDefined();
    expect(notification.message).toContain('Diwali');
  }, 40000);

  // =========================================================================
  // CONDITION 3: Separate Media Management for Every Client
  // =========================================================================
  it('Condition 3: enforces strict client & project isolation (Client B cannot access or extend Client A media)', async () => {
    // Client B attempts to extend Client A's video
    const crossTenantRes = await request(app)
      .post(`/api/v1/ai/projects/${projectA._id}/extend-video`)
      .set('Authorization', `Bearer ${ownerTokenB}`)
      .send({
        mediaAssetId: videoAssetA._id.toString(),
      });

    expect(crossTenantRes.status).toBe(404);
    expect(crossTenantRes.body.error.message).toContain('not found');

    // Client B attempts to generate occasion using Client A's project
    const crossOccasionRes = await request(app)
      .post(`/api/v1/ai/projects/${projectA._id}/generate-occasion`)
      .set('Authorization', `Bearer ${ownerTokenB}`)
      .send({
        occasion: 'diwali',
      });

    expect(crossOccasionRes.status).toBe(404);
  });

  // =========================================================================
  // CONDITION 4: Automated Content Preparation and Notifications
  // =========================================================================
  it('Condition 4: auto-prepares calendar PlanItem and in-app Notification with scheduled time and review link', async () => {
    const res = await request(app)
      .post(`/api/v1/ai/projects/${projectA._id}/generate-occasion`)
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .send({
        occasion: 'independence_day',
      });

    expect(res.status).toBe(201);
    const { planItem, notification } = res.body.data;

    // Check PlanItem database record
    const foundPlanItem = await PlanItem.findById(planItem._id);
    expect(foundPlanItem).toBeDefined();
    expect(foundPlanItem?.approvalStatus).toBe('PENDING_APPROVAL');
    expect(foundPlanItem?.publishStatus).toBe('SCHEDULED');
    expect(foundPlanItem?.scheduledDate).toBeInstanceOf(Date);

    // Check Notification database record
    const notif = await Notification.findById(notification._id);
    expect(notif).toBeDefined();
    expect(notif?.organizationId.toString()).toBe(orgA._id.toString());
    expect(notif?.metadata).toBeDefined();
    expect(String(notif?.metadata?.reviewUrl)).toContain('/creative-studio');
    expect(notif?.metadata?.scheduledDate).toBeDefined();
  }, 40000);
});
