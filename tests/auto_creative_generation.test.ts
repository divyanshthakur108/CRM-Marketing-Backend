import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { Express } from 'express';
import mongoose, { Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import bcrypt from 'bcryptjs';
import fs from 'fs';
import { createApp } from '../src/app.js';
import {
  Organization,
  User,
  Membership,
  Project,
  PropertyUnit,
  MediaAsset,
  Creative,
  Job,
  Subscription,
  Notification,
} from '../src/models/index.js';
import { initAllIndexes } from '../src/models/initIndexes.js';
import { defaultStorage } from '../src/storage/localStorage.adapter.js';
import { creativeEngineService } from '../src/modules/ai/creativeEngineService.js';

describe('Auto Creative Generation (Poster + Reel & Review Flow)', () => {
  let app: Express;
  let mongod: MongoMemoryServer;

  // Tenant A
  let orgA: { _id: Types.ObjectId; name: string };
  let ownerUserA: any;
  let ownerTokenA: string;

  // Tenant B
  let orgB: { _id: Types.ObjectId; name: string };
  let ownerTokenB: string;

  let projectA: any;
  let unitA: any;
  let heroMediaA: any;
  let extraMediaA: any;

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
    await Job.deleteMany({});
    await Subscription.deleteMany({});
    await Notification.deleteMany({});

    const passwordHash = await bcrypt.hash('Password123!', 10);

    // 1. Tenant A Setup
    orgA = (await Organization.create({
      name: 'Skyline Luxury Towers',
      slug: 'skyline-test-org',
    })) as unknown as { _id: Types.ObjectId; name: string };

    await Subscription.create({
      organizationId: orgA._id,
      plan: 'GROWTH',
      status: 'ACTIVE',
      creditsAllocated: 5000,
      creditsRemaining: 100,
    });

    ownerUserA = await User.create({
      email: 'owner@skyline.in',
      fullName: 'Skyline Owner',
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
      .send({ email: 'owner@skyline.in', password: 'Password123!' });
    ownerTokenA = loginResA.body.data.accessToken;

    // 2. Tenant B Setup
    orgB = (await Organization.create({
      name: 'Apex Competitor Org',
      slug: 'apex-test-org',
    })) as unknown as { _id: Types.ObjectId; name: string };

    const ownerUserB = await User.create({
      email: 'owner@apex.in',
      fullName: 'Apex Owner',
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
      .send({ email: 'owner@apex.in', password: 'Password123!' });
    ownerTokenB = loginResB.body.data.accessToken;

    // 3. Project A Setup
    projectA = await Project.create({
      organizationId: orgA._id,
      name: 'Skyline Azure Heights',
      slug: 'skyline-azure-heights',
      category: 'RESIDENTIAL',
      subtype: 'APARTMENT',
      status: 'DRAFT',
      version: 1,
      reraNumber: 'RERA-GRG-2026-999',
      location: {
        address: 'Golf Course Extension Road',
        city: 'Gurugram',
        microMarket: 'Sector 65',
        state: 'Haryana',
        pincode: '122001',
      },
      priceRange: {
        min: 15000000,
        max: 35000000,
        display: '₹1.5 Cr - ₹3.5 Cr',
      },
      amenities: ['Infinity Pool', 'Sky Lounge', 'Clubhouse'],
      details: {
        bhk: 3,
        carpetAreaSqFt: 1850,
      },
      ownerContacts: [
        {
          name: 'Sales Desk',
          phone: '+91 98765 43210',
          email: 'sales@skyline.in',
        },
      ],
    });

    unitA = await PropertyUnit.create({
      organizationId: orgA._id,
      projectId: projectA._id,
      unitNumber: 'Tower A - 1402',
      unitType: '3 BHK',
      price: 25000000,
      priceDisplay: '₹2.50 Cr*',
      carpetAreaSqFt: 1850,
      status: 'AVAILABLE',
      attributes: { bedrooms: 3, bathrooms: 3 },
    });

    // 4. Approved Media Assets with confirmed rights consent
    heroMediaA = await MediaAsset.create({
      organizationId: orgA._id,
      projectId: projectA._id,
      unitId: unitA._id,
      filename: 'hero-facade.jpg',
      storageKey: `projects/${projectA._id}/hero-facade.jpg`,
      url: `http://localhost:5000/storage/projects/${projectA._id}/hero-facade.jpg`,
      mimetype: 'image/jpeg',
      sizeBytes: 1024 * 300,
      type: 'IMAGE',
      category: 'EXTERIOR',
      roomType: '3 BHK',
      actualOrIllustrative: 'ACTUAL',
      rightsConsent: { confirmed: true, at: new Date() },
      isApproved: true,
      approvalStatus: 'APPROVED',
      isCover: true,
      processingStatus: 'ready',
    });

    extraMediaA = await MediaAsset.create({
      organizationId: orgA._id,
      projectId: projectA._id,
      unitId: unitA._id,
      filename: 'living-room.jpg',
      storageKey: `projects/${projectA._id}/living-room.jpg`,
      url: `http://localhost:5000/storage/projects/${projectA._id}/living-room.jpg`,
      mimetype: 'image/jpeg',
      sizeBytes: 1024 * 250,
      type: 'IMAGE',
      category: 'ROOMS',
      roomType: '3 BHK',
      actualOrIllustrative: 'ACTUAL',
      rightsConsent: { confirmed: true, at: new Date() },
      isApproved: true,
      approvalStatus: 'APPROVED',
      isCover: false,
      processingStatus: 'ready',
    });

    // An unapproved media asset that must NEVER be used
    await MediaAsset.create({
      organizationId: orgA._id,
      projectId: projectA._id,
      unitId: unitA._id,
      filename: 'unapproved-draft.jpg',
      storageKey: `projects/${projectA._id}/unapproved-draft.jpg`,
      url: `http://localhost:5000/storage/projects/${projectA._id}/unapproved-draft.jpg`,
      mimetype: 'image/jpeg',
      sizeBytes: 1024 * 100,
      type: 'IMAGE',
      category: 'EXTERIOR',
      rightsConsent: { confirmed: true, at: new Date() },
      isApproved: false,
      approvalStatus: 'PENDING',
      isCover: false,
      processingStatus: 'ready',
    });

    // Update project cover image
    projectA.coverImageUrl = heroMediaA.url;
    await projectA.save();
  });

  it('1. Idempotency: Submit twice creates only one job set with deterministic idempotency key', async () => {
    // Submit project once
    const res1 = await request(app)
      .post(`/api/v1/projects/${projectA._id}/submit`)
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .send({ version: 1 });

    expect(res1.status).toBe(200);

    const initialJobs = await Job.find({ organizationId: orgA._id });
    expect(initialJobs.length).toBeGreaterThan(0);
    const initialJobCount = initialJobs.length;

    // Submit project a second time (should be idempotent without duplicate jobs)
    const res2 = await request(app)
      .post(`/api/v1/projects/${projectA._id}/submit`)
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .send({ version: 2 });

    expect(res2.status).toBe(200);

    const secondJobs = await Job.find({ organizationId: orgA._id });
    expect(secondJobs.length).toBe(initialJobCount);
  });

  it('2. Insufficient credits blocks generation and creates in-app notification', async () => {
    // Exhaust organization credits
    await Subscription.updateOne(
      { organizationId: orgA._id },
      { $set: { creditsRemaining: 0 } }
    );

    const result = await creativeEngineService.enqueueProjectCreatives(orgA._id, projectA._id);
    expect(result.success).toBe(false);
    expect(result.reason).toBe('INSUFFICIENT_CREDITS');

    const notif = await Notification.findOne({
      organizationId: orgA._id,
      category: 'BUDGET_ALERT',
    });
    expect(notif).toBeDefined();
    expect(notif?.title).toContain('Insufficient Credits');
  });

  it('3. Unconsented or unapproved media is excluded from synthesis', async () => {
    await creativeEngineService.enqueueProjectCreatives(orgA._id, projectA._id);

    const creatives = await Creative.find({ organizationId: orgA._id });
    expect(creatives.length).toBeGreaterThan(0);

    for (const c of creatives) {
      // Find unapproved media asset
      const unapprovedAsset = await MediaAsset.findOne({
        organizationId: orgA._id,
        isApproved: false,
      });

      if (unapprovedAsset) {
        expect(c.sourceAssetIds.map((id) => id.toString())).not.toContain(
          unapprovedAsset._id.toString()
        );
      }
    }
  });

  it('4. Real poster files are created via sharp and readable on disk', async () => {
    await creativeEngineService.enqueueProjectCreatives(orgA._id, projectA._id);

    const poster = await Creative.findOne({
      organizationId: orgA._id,
      type: 'POSTER',
      projectId: projectA._id,
    });

    expect(poster).toBeDefined();
    expect(poster?.files.length).toBe(3); // 1:1, 4:5, 9:16

    // Verify files on disk
    for (const file of poster!.files) {
      expect(['1:1', '4:5', '9:16']).toContain(file.ratio);
      expect(file.storageKey).toBeDefined();
      const absPath = defaultStorage.getAbsolutePath(file.storageKey!);
      expect(fs.existsSync(absPath)).toBe(true);
      const stat = fs.statSync(absPath);
      expect(stat.size).toBeGreaterThan(1000); // Valid PNG buffer
    }

    // Verify facts snapshot has exact real values
    expect(poster?.factsSnapshot).toBeDefined();
    expect(poster?.factsSnapshot.projectName).toBe('Skyline Azure Heights');
    expect(poster?.factsSnapshot.location).toContain('Gurugram');
  });

  it('5. Source media changes mark existing creatives stale and request re-review', async () => {
    // Generate initial creative set
    await creativeEngineService.enqueueProjectCreatives(orgA._id, projectA._id);

    const initialCreative = await Creative.findOne({
      organizationId: orgA._id,
      projectId: projectA._id,
    });
    expect(initialCreative?.status).toBe('ready_for_review');

    // Update media asset
    await request(app)
      .patch(`/api/v1/media/${heroMediaA._id}`)
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .send({ tags: ['RENOVATED', 'UPDATED_FACADE'] });

    // Verify creative is marked stale
    const staleCreative = await Creative.findById(initialCreative!._id);
    expect(staleCreative?.status).toBe('stale');
    expect(staleCreative?.reReviewRequired).toBe(true);

    // Verify notification was sent
    const staleNotif = await Notification.findOne({
      organizationId: orgA._id,
      title: /Source Media Updated/,
    });
    expect(staleNotif).toBeDefined();
  });

  it('6. Tenant Isolation: Org B cannot access or review Org A creatives', async () => {
    await creativeEngineService.enqueueProjectCreatives(orgA._id, projectA._id);

    const creativeA = await Creative.findOne({
      organizationId: orgA._id,
      projectId: projectA._id,
    });

    // Org B attempts to read Org A creative -> 404
    const getRes = await request(app)
      .get(`/api/v1/ai/creatives/${creativeA!._id}`)
      .set('Authorization', `Bearer ${ownerTokenB}`);

    expect(getRes.status).toBe(404);

    // Org B attempts to approve Org A creative -> 404
    const approveRes = await request(app)
      .post(`/api/v1/ai/creatives/${creativeA!._id}/approve`)
      .set('Authorization', `Bearer ${ownerTokenB}`)
      .send({
        factChecklist: {
          projectName: true,
          unitType: true,
          price: true,
          location: true,
          amenities: true,
          contactDetails: true,
        },
      });

    expect(approveRes.status).toBe(404);
  });

  it('7. Review Flow: Approve requires all 6 checklist items, Request Changes requires comment', async () => {
    await creativeEngineService.enqueueProjectCreatives(orgA._id, projectA._id);

    const creative = await Creative.findOne({
      organizationId: orgA._id,
      projectId: projectA._id,
    });

    // A. Approve fails with 400 if checklist is incomplete
    const failedApprove = await request(app)
      .post(`/api/v1/ai/creatives/${creative!._id}/approve`)
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .send({
        factChecklist: {
          projectName: true,
          unitType: true,
          // price missing
          location: true,
          amenities: true,
          contactDetails: true,
        },
      });

    expect(failedApprove.status).toBe(400);
    expect(failedApprove.body.error.code).toBe('CHECKLIST_INCOMPLETE');

    // B. Approve succeeds when all 6 checklist items are verified
    const successfulApprove = await request(app)
      .post(`/api/v1/ai/creatives/${creative!._id}/approve`)
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .send({
        factChecklist: {
          projectName: true,
          unitType: true,
          price: true,
          location: true,
          amenities: true,
          contactDetails: true,
        },
      });

    expect(successfulApprove.status).toBe(200);
    expect(successfulApprove.body.data.approvalStatus).toBe('APPROVED');

    // C. Request changes requires comment
    const failedRequestChanges = await request(app)
      .post(`/api/v1/ai/creatives/${creative!._id}/request-changes`)
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .send({ comment: '' });

    expect(failedRequestChanges.status).toBe(400);
    expect(failedRequestChanges.body.error.code).toBe('COMMENT_REQUIRED');

    const successfulRequestChanges = await request(app)
      .post(`/api/v1/ai/creatives/${creative!._id}/request-changes`)
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .send({ comment: 'Please enhance the lighting of the master balcony.' });

    expect(successfulRequestChanges.status).toBe(200);
    expect(successfulRequestChanges.body.data.approvalStatus).toBe('CHANGES_REQUESTED');
  });
});
