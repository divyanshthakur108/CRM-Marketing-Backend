import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { Express } from 'express';
import mongoose, { Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import bcrypt from 'bcryptjs';
import { createApp } from '../src/app.js';
import {
  Organization,
  User,
  Membership,
  Project,
  Plan,
  PlanItem,
  Creative,
  Campaign,
  PublishedPost,
  MetaConnection,
  Job,
} from '../src/models/index.js';
import { initAllIndexes } from '../src/models/initIndexes.js';
import { encryptToken, decryptToken } from '../src/utils/crypto.js';
import { mockMetaAdapter } from '../src/modules/meta/adapters/mockMetaAdapter.js';
import { publishingService } from '../src/modules/publishing/publishingService.js';
import { jobQueue } from '../src/queue/jobQueue.js';
import { processNextJob } from '../src/worker.js';

describe('Phase 12: Meta Connection, Publishing and Failure Recovery', () => {
  let app: Express;
  let mongod: MongoMemoryServer;

  // Test Entities
  let orgA: { _id: Types.ObjectId; name: string };
  let ownerTokenA: string;
  let managerTokenA: string;
  let viewerTokenA: string;
  let sampleProject: any;
  let samplePlanItem: any;
  let sampleCreative: any;

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
    mockMetaAdapter.resetCallCounts();

    await User.deleteMany({});
    await Organization.deleteMany({});
    await Membership.deleteMany({});
    await Project.deleteMany({});
    await Plan.deleteMany({});
    await PlanItem.deleteMany({});
    await Creative.deleteMany({});
    await Campaign.deleteMany({});
    await PublishedPost.deleteMany({});
    await MetaConnection.deleteMany({});
    await Job.deleteMany({});

    const passwordHash = await bcrypt.hash('Password123!', 10);

    // Setup Tenant
    orgA = (await Organization.create({
      name: 'Skyline Luxury Developments',
      slug: 'skyline-luxury',
    })) as unknown as { _id: Types.ObjectId; name: string };

    const ownerUser = await User.create({
      email: 'owner@skylinedev.com',
      passwordHash,
      fullName: 'Vikram Skyline Owner',
      isEmailVerified: true,
    });

    const managerUser = await User.create({
      email: 'manager@skylinedev.com',
      passwordHash,
      fullName: 'Aarav Marketing Lead',
      isEmailVerified: true,
    });

    const viewerUser = await User.create({
      email: 'viewer@skylinedev.com',
      passwordHash,
      fullName: 'Rohan Sales Viewer',
      isEmailVerified: true,
    });

    await Membership.create([
      { organizationId: orgA._id, userId: ownerUser._id, role: 'org_owner', isDefault: true },
      { organizationId: orgA._id, userId: managerUser._id, role: 'marketing_manager', isDefault: true },
      { organizationId: orgA._id, userId: viewerUser._id, role: 'viewer', isDefault: true },
    ]);

    // Setup sample Project
    sampleProject = await Project.create({
      organizationId: orgA._id,
      name: 'Skyline Crown Residences',
      slug: 'skyline-crown-residences',
      category: 'RESIDENTIAL',
      subtype: 'High-Rise Apartments',
      status: 'ACTIVE',
      reraNumber: 'PRM/KA/RERA/1251/310/PR/200124/003456',
      location: {
        address: 'Golf Course Extension Road',
        city: 'Gurugram',
        microMarket: 'Sector 62',
        state: 'Haryana',
        pincode: '122002',
      },
      priceRange: {
        min: 25000000,
        max: 65000000,
        display: '₹2.5 Cr - ₹6.5 Cr',
      },
      details: {
        totalUnits: 120,
        bhkConfigs: ['3 BHK', '4 BHK'],
      },
    });

    // Setup sample Plan
    const samplePlan = await Plan.create({
      organizationId: orgA._id,
      month: 11,
      year: 2026,
      cycleName: 'November 2026 Luxury Portfolio Plan',
      status: 'APPROVED',
      timezone: 'Asia/Kolkata',
    });

    // Setup sample Plan Item
    samplePlanItem = await PlanItem.create({
      organizationId: orgA._id,
      planId: samplePlan._id,
      projectId: sampleProject._id,
      projectName: sampleProject.name,
      title: 'Luxury 3 BHK Launch Announcement',
      type: 'POST_4x5',
      channel: 'INSTAGRAM',
      scheduledDate: new Date('2026-11-12'),
      scheduledTime: '18:00',
      topic: 'Pristine Golf View Homes',
      creativeBrief: 'Experience Elevated Living with bespoke 3 & 4 BHK residences',
      approvalStatus: 'APPROVED',
      publishStatus: 'SCHEDULED',
      version: 1,
    });

    // Setup sample Creative
    sampleCreative = await Creative.create({
      organizationId: orgA._id,
      projectId: sampleProject._id,
      planItemId: samplePlanItem._id,
      version: 1,
      format: '4:5',
      headline: 'Experience Elevated Living at Skyline Crown',
      caption: 'Discover bespoke 3 & 4 BHK residences starting ₹2.5 Cr on Golf Course Extension Road.',
      renderedAssetUrl: 'https://cdn.realcrm.in/assets/skyline_crown_hero.jpg',
      language: 'English',
      status: 'GENERATED',
      approvalStatus: 'APPROVED',
      factCheckPassed: true,
    });

    samplePlanItem.creativeId = sampleCreative._id;
    await samplePlanItem.save();

    // Authenticate test users
    const ownerLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'owner@skylinedev.com', password: 'Password123!' });
    ownerTokenA = ownerLogin.body.data.accessToken;

    const managerLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'manager@skylinedev.com', password: 'Password123!' });
    managerTokenA = managerLogin.body.data.accessToken;

    const viewerLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'viewer@skylinedev.com', password: 'Password123!' });
    viewerTokenA = viewerLogin.body.data.accessToken;
  });

  describe('1. Token Cryptography & AES-256-GCM Verification', () => {
    it('encrypts and decrypts tokens deterministically using AES-256-GCM', () => {
      const originalToken = 'EAAB_LIVE_SECRET_META_TOKEN_1234567890_XYZ';
      const encrypted = encryptToken(originalToken);

      expect(encrypted).toBeDefined();
      expect(encrypted).toContain(':');
      expect(encrypted).not.toEqual(originalToken);

      const decrypted = decryptToken(encrypted);
      expect(decrypted).toEqual(originalToken);
    });
  });

  describe('2. Meta Connection Flow (Connect URL, Callback, Encrypted Storage, Status & Disconnect)', () => {
    it('generates Meta OAuth connect URL with tenant state', async () => {
      const res = await request(app)
        .get('/api/v1/meta/connect-url')
        .set('Authorization', `Bearer ${managerTokenA}`)
        .set('X-Organization-Id', orgA._id.toString());

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.url).toContain('dialog/oauth');
      expect(res.body.data.adapterMode).toBe('mock');
    });

    it('handles OAuth callback, stores encrypted access token and verifies raw token is not exposed', async () => {
      const res = await request(app)
        .post('/api/v1/meta/callback')
        .set('Authorization', `Bearer ${managerTokenA}`)
        .set('X-Organization-Id', orgA._id.toString())
        .send({ code: 'valid_mock_auth_code_98765' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.facebookPage.connected).toBe(true);
      expect(res.body.data.adAccount.connected).toBe(true);

      // Verify DB record directly: token must be stored encrypted (AES-256-GCM format iv:tag:data)
      const conn = await MetaConnection.findOne({ organizationId: orgA._id });
      expect(conn).toBeDefined();
      expect(conn!.facebookPage.accessToken).toBeDefined();
      expect(conn!.facebookPage.accessToken).toContain(':');
      expect(conn!.facebookPage.accessToken).not.toContain('EAAB_MOCK'); // encrypted

      // Decrypted matches
      const rawDecrypted = decryptToken(conn!.facebookPage.accessToken!);
      expect(rawDecrypted).toContain('EAAB_MOCK');
    });

    it('returns connection status with masked tokens and honest disclaimer', async () => {
      // Connect first
      await request(app)
        .post('/api/v1/meta/callback')
        .set('Authorization', `Bearer ${managerTokenA}`)
        .set('X-Organization-Id', orgA._id.toString())
        .send({ code: 'auth_code_for_status_check' });

      const res = await request(app)
        .get('/api/v1/meta/status')
        .set('Authorization', `Bearer ${viewerTokenA}`)
        .set('X-Organization-Id', orgA._id.toString());

      expect(res.status).toBe(200);
      expect(res.body.data.connected).toBe(true);
      expect(res.body.data.facebookPage.connected).toBe(true);
      expect(res.body.data.disclaimer).toContain('Meta App Review');
      // Token is masked preview, not raw
      expect(res.body.data.facebookPage.tokenPreview).toContain('...');
    });

    it('disconnects Meta integration cleanly and clears tokens', async () => {
      // Connect
      await request(app)
        .post('/api/v1/meta/callback')
        .set('Authorization', `Bearer ${managerTokenA}`)
        .set('X-Organization-Id', orgA._id.toString())
        .send({ code: 'auth_code_for_disconnect' });

      // Disconnect
      const res = await request(app)
        .post('/api/v1/meta/disconnect')
        .set('Authorization', `Bearer ${managerTokenA}`)
        .set('X-Organization-Id', orgA._id.toString());

      expect(res.status).toBe(200);
      expect(res.body.data.disconnected).toBe(true);

      const statusRes = await request(app)
        .get('/api/v1/meta/status')
        .set('Authorization', `Bearer ${viewerTokenA}`)
        .set('X-Organization-Id', orgA._id.toString());

      expect(statusRes.body.data.connected).toBe(false);
      expect(statusRes.body.data.facebookPage.connected).toBe(false);
    });
  });

  describe('3. Organic Publishing & Unapproved Content Rejection', () => {
    beforeEach(async () => {
      // Connect Meta accounts for the tenant
      await request(app)
        .post('/api/v1/meta/callback')
        .set('Authorization', `Bearer ${managerTokenA}`)
        .set('X-Organization-Id', orgA._id.toString())
        .send({ code: 'conn_code_organic' });
    });

    it('rejects publishing an unapproved creative with 422 Unprocessable Entity', async () => {
      // Mark creative as PENDING_APPROVAL
      sampleCreative.approvalStatus = 'PENDING_APPROVAL';
      await sampleCreative.save();

      const res = await request(app)
        .post('/api/v1/publishing/organic')
        .set('Authorization', `Bearer ${managerTokenA}`)
        .set('X-Organization-Id', orgA._id.toString())
        .send({ planItemId: samplePlanItem._id.toString() });

      expect(res.status).toBe(422);
      expect(res.body.error.message).toContain('Unapproved items cannot be published');
    });

    it('publishes approved creative via mock adapter, saves external post ID and updates plan item', async () => {
      // Creative is APPROVED
      const res = await request(app)
        .post('/api/v1/publishing/organic')
        .set('Authorization', `Bearer ${managerTokenA}`)
        .set('X-Organization-Id', orgA._id.toString())
        .send({ planItemId: samplePlanItem._id.toString() });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.metaPostId).toMatch(/^mock_post_/);
      expect(res.body.data.postUrl).toContain('facebook.com');
      expect(res.body.data.status).toBe('PUBLISHED');

      // Verify PlanItem updated in DB
      const updatedItem = await PlanItem.findById(samplePlanItem._id);
      expect(updatedItem!.publishStatus).toBe('PUBLISHED');
      expect(updatedItem!.externalPostId).toEqual(res.body.data.metaPostId);

      // Verify PublishedPost collection has record
      const postRecord = await PublishedPost.findOne({ planItemId: samplePlanItem._id });
      expect(postRecord).toBeDefined();
      expect(postRecord!.status).toBe('PUBLISHED');
    });

    it('lists publishing logs and allows retrying a post', async () => {
      // Create a published post
      await request(app)
        .post('/api/v1/publishing/organic')
        .set('Authorization', `Bearer ${managerTokenA}`)
        .set('X-Organization-Id', orgA._id.toString())
        .send({ planItemId: samplePlanItem._id.toString() });

      const logsRes = await request(app)
        .get('/api/v1/publishing/logs')
        .set('Authorization', `Bearer ${managerTokenA}`)
        .set('X-Organization-Id', orgA._id.toString());

      expect(logsRes.status).toBe(200);
      expect(logsRes.body.data.length).toBeGreaterThanOrEqual(1);

      const logId = logsRes.body.data[0]._id;
      const retryRes = await request(app)
        .post(`/api/v1/publishing/logs/${logId}/retry`)
        .set('Authorization', `Bearer ${managerTokenA}`)
        .set('X-Organization-Id', orgA._id.toString());

      expect(retryRes.status).toBe(200);
      expect(retryRes.body.data.metaPostId).toBeDefined();
    });
  });

  describe('4. Housing Policy Checks (HUD / Meta Fair Housing Compliance)', () => {
    it('blocks illegal age targeting for real estate ads (minAge > 18 or maxAge < 65)', async () => {
      const res = await request(app)
        .post('/api/v1/campaigns/deploy')
        .set('Authorization', `Bearer ${managerTokenA}`)
        .set('X-Organization-Id', orgA._id.toString())
        .send({
          projectId: sampleProject._id.toString(),
          creativeId: sampleCreative._id.toString(),
          name: 'Targeted High Net Worth Buyers',
          dailyBudget: 2500,
          targeting: {
            minAge: 30, // Prohibited by Fair Housing policy
            maxAge: 55, // Prohibited
          },
        });

      expect(res.status).toBe(422);
      expect(res.body.error.message).toContain('Age restrictions are prohibited for Housing ads');
    });

    it('blocks gender-specific targeting for real estate ads', async () => {
      const res = await request(app)
        .post('/api/v1/campaigns/deploy')
        .set('Authorization', `Bearer ${managerTokenA}`)
        .set('X-Organization-Id', orgA._id.toString())
        .send({
          projectId: sampleProject._id.toString(),
          creativeId: sampleCreative._id.toString(),
          name: 'Men-Only Real Estate Campaign',
          dailyBudget: 2500,
          targeting: {
            genders: ['MALE'], // Prohibited
          },
        });

      expect(res.status).toBe(422);
      expect(res.body.error.message).toContain('Gender-based targeting is prohibited for Housing ads');
    });

    it('blocks ZIP code / PIN code targeting to prevent discriminatory redlining', async () => {
      const res = await request(app)
        .post('/api/v1/campaigns/deploy')
        .set('Authorization', `Bearer ${managerTokenA}`)
        .set('X-Organization-Id', orgA._id.toString())
        .send({
          projectId: sampleProject._id.toString(),
          creativeId: sampleCreative._id.toString(),
          name: 'Zip Code Filtered Campaign',
          dailyBudget: 2500,
          targeting: {
            zipCodes: ['122001', '122002'],
          },
        });

      expect(res.status).toBe(422);
      expect(res.body.error.message).toContain('ZIP code level targeting is prohibited');
    });
  });

  describe('5. Paid Ad Multi-Step Deployment & Failure Recovery', () => {
    beforeEach(async () => {
      await request(app)
        .post('/api/v1/meta/callback')
        .set('Authorization', `Bearer ${managerTokenA}`)
        .set('X-Organization-Id', orgA._id.toString())
        .send({ code: 'conn_code_ads' });
    });

    it('deploys paid ad through 4 steps: CAMPAIGN -> AD_SET -> CREATIVE -> AD starting in PAUSED state', async () => {
      const res = await request(app)
        .post('/api/v1/campaigns/deploy')
        .set('Authorization', `Bearer ${managerTokenA}`)
        .set('X-Organization-Id', orgA._id.toString())
        .send({
          projectId: sampleProject._id.toString(),
          creativeId: sampleCreative._id.toString(),
          name: 'Skyline Crown Phase 1 Launch',
          dailyBudget: 3000,
          objective: 'LEAD_GEN',
          targeting: {
            minAge: 18,
            maxAge: 65,
            cities: ['Gurugram', 'New Delhi'],
          },
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      const campaign = res.body.data;

      expect(campaign.status).toBe('PAUSED'); // Must start PAUSED
      expect(campaign.metaCampaignId).toMatch(/^mock_camp_/);
      expect(campaign.metaAdSetId).toMatch(/^mock_adset_/);
      expect(campaign.metaCreativeId).toMatch(/^mock_crea_/);
      expect(campaign.metaAdId).toMatch(/^mock_ad_/);
      expect(campaign.completedSteps).toEqual(['CAMPAIGN', 'AD_SET', 'CREATIVE', 'AD']);
      expect(campaign.needsAction).toBe(false);

      // Verify mock adapter call counts
      expect(mockMetaAdapter.calls.campaign).toBe(1);
      expect(mockMetaAdapter.calls.adSet).toBe(1);
      expect(mockMetaAdapter.calls.creative).toBe(1);
      expect(mockMetaAdapter.calls.ad).toBe(1);
    });

    it('simulated timeout after campaign creation resumes without creating a second campaign', async () => {
      // 1. Simulate failure during Step 2 (AD_SET) - Step 1 (CAMPAIGN) will succeed
      mockMetaAdapter.setSimulatedFailure('AD_SET', 'Simulated Meta API 504 Gateway Timeout during AdSet');

      // Trigger deployment
      const initialRes = await request(app)
        .post('/api/v1/campaigns/deploy')
        .set('Authorization', `Bearer ${managerTokenA}`)
        .set('X-Organization-Id', orgA._id.toString())
        .send({
          projectId: sampleProject._id.toString(),
          creativeId: sampleCreative._id.toString(),
          name: 'Timeout Resumption Test Campaign',
          dailyBudget: 3500,
        });

      // Failed at step 2
      expect(initialRes.status).toBe(500);

      // Verify the campaign state in MongoDB:
      // It must have saved the created metaCampaignId and recorded completedSteps = ['CAMPAIGN']
      const failedCampaign = await Campaign.findOne({
        name: 'Timeout Resumption Test Campaign',
        organizationId: orgA._id,
      });

      expect(failedCampaign).toBeDefined();
      expect(failedCampaign!.metaCampaignId).toBeDefined();
      expect(failedCampaign!.metaCampaignId).toMatch(/^mock_camp_/);
      const initialCampaignId = failedCampaign!.metaCampaignId;
      expect(failedCampaign!.completedSteps).toEqual(['CAMPAIGN']);
      expect(failedCampaign!.needsAction).toBe(true);
      expect(failedCampaign!.lastErrorStep).toBe('AD_SET');
      expect(failedCampaign!.lastErrorMessage).toContain('504 Gateway Timeout');

      // Verify MockAdapter call count for campaign is 1
      expect(mockMetaAdapter.calls.campaign).toBe(1);

      // 2. Clear simulation failure so retry/resume can succeed
      mockMetaAdapter.setSimulatedFailure(null);

      // 3. Resume deployment via API
      const resumeRes = await request(app)
        .post(`/api/v1/campaigns/${failedCampaign!._id}/resume`)
        .set('Authorization', `Bearer ${managerTokenA}`)
        .set('X-Organization-Id', orgA._id.toString());

      expect(resumeRes.status).toBe(200);
      expect(resumeRes.body.success).toBe(true);
      const resumedCampaign = resumeRes.body.data;

      // CRITICAL ASSERTION: Step 1 must NOT be recreated! metaCampaignId must be identical
      expect(resumedCampaign.metaCampaignId).toEqual(initialCampaignId);
      expect(mockMetaAdapter.calls.campaign).toBe(1); // STILL 1! Never called createCampaign again!

      // Remaining steps must have completed
      expect(resumedCampaign.metaAdSetId).toBeDefined();
      expect(resumedCampaign.metaCreativeId).toBeDefined();
      expect(resumedCampaign.metaAdId).toBeDefined();
      expect(resumedCampaign.completedSteps).toEqual(['CAMPAIGN', 'AD_SET', 'CREATIVE', 'AD']);
      expect(resumedCampaign.needsAction).toBe(false);
    });

    it('allows toggling campaign delivery status between PAUSED and ACTIVE', async () => {
      // Deploy valid campaign
      const deployRes = await request(app)
        .post('/api/v1/campaigns/deploy')
        .set('Authorization', `Bearer ${managerTokenA}`)
        .set('X-Organization-Id', orgA._id.toString())
        .send({
          projectId: sampleProject._id.toString(),
          creativeId: sampleCreative._id.toString(),
          name: 'Status Toggle Campaign',
          dailyBudget: 2000,
        });

      const campaignId = deployRes.body.data._id;
      expect(deployRes.body.data.status).toBe('PAUSED');

      // Activate
      const activateRes = await request(app)
        .patch(`/api/v1/campaigns/${campaignId}/status`)
        .set('Authorization', `Bearer ${managerTokenA}`)
        .set('X-Organization-Id', orgA._id.toString())
        .send({ status: 'ACTIVE' });

      expect(activateRes.status).toBe(200);
      expect(activateRes.body.data.status).toBe('ACTIVE');

      // Pause again
      const pauseRes = await request(app)
        .patch(`/api/v1/campaigns/${campaignId}/status`)
        .set('Authorization', `Bearer ${managerTokenA}`)
        .set('X-Organization-Id', orgA._id.toString())
        .send({ status: 'PAUSED' });

      expect(pauseRes.status).toBe(200);
      expect(pauseRes.body.data.status).toBe('PAUSED');
    });
  });

  describe('6. Background Worker Publishing Queue Execution', () => {
    beforeEach(async () => {
      await request(app)
        .post('/api/v1/meta/callback')
        .set('Authorization', `Bearer ${managerTokenA}`)
        .set('X-Organization-Id', orgA._id.toString())
        .send({ code: 'conn_code_worker' });
    });

    it('background worker claims and executes PUBLISH_ORGANIC job', async () => {
      // Enqueue a PUBLISH_ORGANIC job
      await jobQueue.enqueueJob({
        organizationId: orgA._id.toString(),
        idempotencyKey: `publish-organic-${samplePlanItem._id}`,
        jobType: 'PUBLISH_ORGANIC',
        queueName: 'media-rendering',
        payload: {
          planItemId: samplePlanItem._id.toString(),
          organizationId: orgA._id.toString(),
        },
      });

      // Worker claims and processes
      const executedJob = await processNextJob('media-rendering');
      expect(executedJob).toBeDefined();
      expect(executedJob!.status).toBe('COMPLETED');
      expect(executedJob!.result?.metaPostId).toMatch(/^mock_post_/);

      // Verify post recorded in collection
      const post = await PublishedPost.findOne({ planItemId: samplePlanItem._id });
      expect(post).toBeDefined();
      expect(post!.status).toBe('PUBLISHED');
    });
  });
});
