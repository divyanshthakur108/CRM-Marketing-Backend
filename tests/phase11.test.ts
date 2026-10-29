import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
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
  PropertyUnit,
  Plan,
  PlanItem,
  Creative,
  Approval,
  Job,
  UsageLedger,
  Notification,
} from '../src/models/index.js';
import { initAllIndexes } from '../src/models/initIndexes.js';
import { getAIProvider, MockAIProvider } from '../src/modules/ai/providers/index.js';
import { FactChecker } from '../src/modules/ai/factChecker.js';
import { jobQueue } from '../src/queue/jobQueue.js';
import { processNextJob } from '../src/worker.js';
import { rollingScheduler } from '../src/scheduler/rollingScheduler.js';
import { creativeService } from '../src/modules/ai/creativeService.js';

describe('Phase 11: AI Creatives, Captions, Job Queue & Rolling Scheduler', () => {
  let app: Express;
  let mongod: MongoMemoryServer;

  // Test Entities
  let orgA: { _id: Types.ObjectId; name: string };
  let ownerTokenA: string;
  let managerTokenA: string;
  let approverTokenA: string;
  let sampleProject: any;
  let samplePlan: any;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri());
    await initAllIndexes();
    app = createApp();
  });

  afterAll(async () => {
    vi.useRealTimers();
    await mongoose.disconnect();
    await mongod.stop();
  });

  beforeEach(async () => {
    vi.useRealTimers();
    await User.deleteMany({});
    await Organization.deleteMany({});
    await Membership.deleteMany({});
    await Project.deleteMany({});
    await PropertyUnit.deleteMany({});
    await Plan.deleteMany({});
    await PlanItem.deleteMany({});
    await Creative.deleteMany({});
    await Approval.deleteMany({});
    await Job.deleteMany({});
    await UsageLedger.deleteMany({});
    await Notification.deleteMany({});

    const passwordHash = await bcrypt.hash('Password123!', 10);

    // 1. Setup Tenant
    orgA = (await Organization.create({
      name: 'Skyline Luxury Developments',
      slug: 'skyline-luxury',
    })) as unknown as { _id: Types.ObjectId; name: string };

    const ownerUser = await User.create({
      email: 'owner@skylinedev.com',
      passwordHash,
      fullName: 'Vikram Skyline',
    });
    await Membership.create({
      organizationId: orgA._id,
      userId: ownerUser._id,
      role: 'org_owner',
    });

    const managerUser = await User.create({
      email: 'manager@skylinedev.com',
      passwordHash,
      fullName: 'Rohit Manager',
    });
    await Membership.create({
      organizationId: orgA._id,
      userId: managerUser._id,
      role: 'marketing_manager',
    });

    const approverUser = await User.create({
      email: 'approver@skylinedev.com',
      passwordHash,
      fullName: 'Ananya Approver',
    });
    await Membership.create({
      organizationId: orgA._id,
      userId: approverUser._id,
      role: 'client_approver',
    });

    // 2. Setup Project & Units
    sampleProject = await Project.create({
      organizationId: orgA._id,
      name: 'Skyline Waterfront Towers',
      slug: 'skyline-waterfront-towers',
      category: 'RESIDENTIAL',
      subtype: 'High-Rise Apartments',
      status: 'ACTIVE',
      reraNumber: 'PRM/KA/RERA/1251/310/PR/200124/003456',
      location: {
        address: '10 Marine Drive Corridor',
        city: 'Mumbai',
        microMarket: 'Worli Sea Face',
        state: 'Maharashtra',
        pincode: '400018',
      },
      priceRange: {
        min: 25000000,
        max: 55000000,
        display: '₹2.5 Cr - ₹5.5 Cr',
      },
      details: {
        bhkConfigs: ['3 BHK', '4 BHK'],
      },
      amenities: ['Infinity Pool', 'Gymnasium', 'Concierge Service', 'Sky Deck'],
    });

    await PropertyUnit.create([
      {
        organizationId: orgA._id,
        projectId: sampleProject._id,
        unitNumber: 'TowerA-1402',
        unitType: '3 BHK Luxury Suite',
        carpetAreaSqFt: 1850,
        price: 28500000,
        status: 'AVAILABLE',
        attributes: { bhk: 3 },
      },
      {
        organizationId: orgA._id,
        projectId: sampleProject._id,
        unitNumber: 'TowerB-2201',
        unitType: '4 BHK Sky Penthouse',
        carpetAreaSqFt: 2900,
        price: 52000000,
        status: 'AVAILABLE',
        attributes: { bhk: 4 },
      },
    ]);

    // 3. Setup Monthly Plan
    samplePlan = await Plan.create({
      organizationId: orgA._id,
      month: 11,
      year: 2026,
      cycleName: 'November 2026 Luxury Portfolio Plan',
      status: 'APPROVED',
      timezone: 'Asia/Kolkata',
    });

    // Obtain JWT tokens
    const loginOwner = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'owner@skylinedev.com', password: 'Password123!' });
    ownerTokenA = loginOwner.body.data.accessToken;

    const loginManager = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'manager@skylinedev.com', password: 'Password123!' });
    managerTokenA = loginManager.body.data.accessToken;

    const loginApprover = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'approver@skylinedev.com', password: 'Password123!' });
    approverTokenA = loginApprover.body.data.accessToken;
  });

  // =========================================================================
  // 1. Provider Interface & Deterministic MockProvider
  // =========================================================================
  describe('1. AI Provider Interface & Deterministic MockProvider', () => {
    it('selects MockAIProvider when AI_PROVIDER=mock and returns deterministic outputs', async () => {
      const provider = getAIProvider();
      expect(provider).toBeInstanceOf(MockAIProvider);
      expect(provider.name).toBe('mock');

      // Caption Generation
      const caption = await provider.generateCaption({
        projectName: 'Skyline Waterfront Towers',
        city: 'Mumbai',
        micromarket: 'Worli Sea Face',
        priceDisplay: '₹2.5 Cr - ₹5.5 Cr',
        reraNumber: 'PRM/KA/RERA/1251/310/PR/200124/003456',
        bhkConfigs: ['3 BHK', '4 BHK'],
        language: 'English',
      });

      expect(caption.headline).toContain('Skyline Waterfront Towers');
      expect(caption.caption).toContain('Worli Sea Face');
      expect(caption.caption).toContain('3 BHK, 4 BHK');
      expect(caption.caption).toContain('₹2.5 Cr - ₹5.5 Cr');
      expect(caption.caption).toContain('PRM/KA/RERA/1251/310/PR/200124/003456');
      expect(caption.hashtags).toContain('#LuxuryRealEstate');

      // Image Generation
      const image = await provider.generateImage({
        prompt: 'Luxury penthouse living room with panoramic sea views',
        aspectRatio: '4:5',
        projectName: 'Skyline Waterfront Towers',
      });
      expect(image.format).toBe('4:5');
      expect(image.url).toBeDefined();
      expect(image.model).toBe('mock-image-engine-v1');

      // Video Generation
      const video = await provider.imageToVideo({
        imageUrl: image.url,
        aspectRatio: '9:16',
        durationSeconds: 15,
      });
      expect(video.format).toBe('9:16');
      expect(video.durationSeconds).toBe(15);
      expect(video.videoUrl).toContain('mock-video-reel-9x16');
    });

    it('generates Hinglish and Hindi captions deterministically', async () => {
      const provider = getAIProvider();

      const hinglish = await provider.generateCaption({
        projectName: 'Skyline Waterfront Towers',
        city: 'Mumbai',
        language: 'Hinglish',
        priceDisplay: '₹2.5 Cr',
      });
      expect(hinglish.language).toBe('Hinglish');
      expect(hinglish.headline).toContain('Luxury living ka ultimate destination');

      const hindi = await provider.generateCaption({
        projectName: 'Skyline Waterfront Towers',
        city: 'Mumbai',
        language: 'Hindi',
        priceDisplay: '₹2.5 Cr',
      });
      expect(hindi.language).toBe('Hindi');
      expect(hindi.headline).toContain('जीवनशैली');
    });
  });

  // =========================================================================
  // 2. Fact-Check Step: Verified Facts vs. Unverified Claims
  // =========================================================================
  describe('2. Fact-Check Step: Verification Against Project Master Data', () => {
    it('passes verification when generated text uses strictly approved facts', async () => {
      const facts = await FactChecker.buildVerifiedFacts(sampleProject);
      expect(facts.allowedBhk).toEqual(expect.arrayContaining([3, 4]));
      expect(facts.minPrice).toBe(25000000);
      expect(facts.maxPrice).toBe(55000000);

      const compliantText =
        'Experience 3 BHK and 4 BHK residences at Skyline Waterfront Towers starting from ₹2.85 Cr. RERA Reg: PRM/KA/RERA/1251/310/PR/200124/003456. Infinity Pool available.';
      const result = FactChecker.verifyText(compliantText, facts);

      expect(result.passed).toBe(true);
      expect(result.issues).toHaveLength(0);
      expect(result.verifiedFacts.length).toBeGreaterThan(0);
    });

    it('flags unverified BHK configuration, out-of-range price, and fake RERA number', async () => {
      const facts = await FactChecker.buildVerifiedFacts(sampleProject);

      const fraudulentCopy =
        'Exclusive 6 BHK Sky Villa for just ₹1.2 Cr! Approved under RERA Reg: RERA/FAKE/999999. Featuring a private Helipad.';
      const result = FactChecker.verifyText(fraudulentCopy, facts);

      expect(result.passed).toBe(false);
      expect(result.issues).toEqual(
        expect.arrayContaining([
          expect.stringContaining('6 BHK is not in approved configurations'),
          expect.stringContaining('falls outside approved price range'),
          expect.stringContaining('does not match approved RERA'),
          expect.stringContaining('"helipad" is not in approved project amenities'),
        ])
      );
    });
  });

  // =========================================================================
  // 3. Job Queue with Atomic Claim, Retries & Idempotency
  // =========================================================================
  describe('3. Job Queue (Atomic Claim, Backoff Retries & Idempotency)', () => {
    it('enforces unique idempotencyKey and rejects duplicates across identical queue dispatches', async () => {
      const idempotencyKey = 'creative-render:item-101';

      const job1 = await jobQueue.enqueueJob({
        organizationId: orgA._id,
        idempotencyKey,
        jobType: 'GENERATE_CREATIVE',
        payload: { test: 1 },
      });

      const job2 = await jobQueue.enqueueJob({
        organizationId: orgA._id,
        idempotencyKey,
        jobType: 'GENERATE_CREATIVE',
        payload: { test: 2 },
      });

      expect(job1._id.toString()).toBe(job2._id.toString());
      const totalJobs = await Job.countDocuments({ organizationId: orgA._id });
      expect(totalJobs).toBe(1);
    });

    it('atomically claims pending jobs and marks them RUNNING', async () => {
      await jobQueue.enqueueJob({
        organizationId: orgA._id,
        idempotencyKey: 'atomic-test-1',
        jobType: 'GENERATE_CREATIVE',
        payload: { run: true },
      });

      const claimed = await jobQueue.claimNextJob('media-rendering');
      expect(claimed).not.toBeNull();
      expect(claimed?.status).toBe('RUNNING');
      expect(claimed?.attempts).toBe(1);
      expect(claimed?.startedAt).toBeDefined();

      // Immediate second claim should find no ready pending jobs
      const secondClaim = await jobQueue.claimNextJob('media-rendering');
      expect(secondClaim).toBeNull();
    });

    it('applies exponential backoff on failure and marks permanently FAILED after max attempts', async () => {
      const job = await jobQueue.enqueueJob({
        organizationId: orgA._id,
        idempotencyKey: 'retry-test-1',
        jobType: 'GENERATE_CREATIVE',
        payload: { errorCase: true },
        maxAttempts: 2,
      });

      // Attempt 1 Failure -> retries with nextRunAt in future
      const claimed1 = await jobQueue.claimNextJob('media-rendering');
      expect(claimed1?.attempts).toBe(1);

      const retriedJob = await jobQueue.failJob(job._id, 'Transient API timeout');
      expect(retriedJob?.status).toBe('PENDING');
      expect(retriedJob?.nextRunAt).toBeDefined();
      expect(retriedJob?.nextRunAt!.getTime()).toBeGreaterThan(Date.now());

      // Fast forward past backoff window to simulate retry execution
      retriedJob!.nextRunAt = new Date(Date.now() - 1000);
      await retriedJob!.save();

      // Attempt 2 Failure -> reaches maxAttempts and fails permanently
      const claimed2 = await jobQueue.claimNextJob('media-rendering');
      expect(claimed2?.attempts).toBe(2);

      const finalFailedJob = await jobQueue.failJob(job._id, 'Fatal rendering exception');
      expect(finalFailedJob?.status).toBe('FAILED');
      expect(finalFailedJob?.completedAt).toBeDefined();
    });
  });

  // =========================================================================
  // 4. Worker Execution: Telemetry & In-App Notifications
  // =========================================================================
  describe('4. Worker Execution: Creative Synthesis, Usage Ledger & Notifications', () => {
    it('worker claims and finishes creative generation job, logging usage and notifying team', async () => {
      const planItem = await PlanItem.create({
        organizationId: orgA._id,
        planId: samplePlan._id,
        projectId: sampleProject._id,
        projectName: sampleProject.name,
        title: 'Penthouse Spotlight Reel',
        type: 'REEL_9x16',
        channel: 'INSTAGRAM',
        scheduledDate: new Date('2026-11-12'),
        scheduledTime: '18:00',
        topic: 'Architectural Panorama',
        creativeBrief: 'Grand living room ceiling with Arabian sea view',
        approvalStatus: 'APPROVED',
        publishStatus: 'SCHEDULED',
      });

      await jobQueue.enqueueJob({
        organizationId: orgA._id,
        idempotencyKey: `gen-creative:${planItem._id.toString()}`,
        jobType: 'GENERATE_CREATIVE',
        payload: {
          planItemId: planItem._id.toString(),
          organizationId: orgA._id.toString(),
        },
      });

      // Execute worker unit iteration
      const processedJob = await processNextJob('media-rendering');
      expect(processedJob).not.toBeNull();
      expect(processedJob?.status).toBe('COMPLETED');

      // Verify Creative created with version 1
      const creative = await Creative.findOne({ planItemId: planItem._id });
      expect(creative).not.toBeNull();
      expect(creative?.version).toBe(1);
      expect(creative?.format).toBe('9:16');
      expect(creative?.approvalStatus).toBe('PENDING_APPROVAL');
      expect(creative?.factCheckPassed).toBe(true);

      // Verify Telemetry recorded in usageLedger
      const usage = await UsageLedger.find({ organizationId: orgA._id });
      expect(usage.length).toBeGreaterThanOrEqual(2);
      expect(usage.some((u) => u.creditType === 'IMAGE_RENDER')).toBe(true);
      expect(usage.some((u) => u.creditType === 'AI_COPY')).toBe(true);

      // Verify In-App Notification generated
      const notifications = await Notification.find({ organizationId: orgA._id });
      expect(notifications.length).toBeGreaterThanOrEqual(1);
      expect(notifications[0].category).toBe('APPROVAL_REQUIRED');
      expect(notifications[0].title).toContain('AI Creative v1 Ready for Review');
    });
  });

  // =========================================================================
  // 5. Rolling Scheduler: Fake Clock Window & Duplicate Prevention
  // =========================================================================
  describe('5. Rolling Scheduler (Fake Clock, Lead Window & Deduplication)', () => {
    it('enqueues exactly one creative job within lead window and running scheduler twice creates no duplicate', async () => {
      // Set fake clock to November 1, 2026
      const fakeNow = new Date('2026-11-01T00:00:00.000Z');
      vi.useFakeTimers();
      vi.setSystemTime(fakeNow);

      // Item 1: Scheduled November 4 (within 7 days lead window) + APPROVED -> SHOULD ENQUEUE
      const itemEligible = await PlanItem.create({
        organizationId: orgA._id,
        planId: samplePlan._id,
        projectId: sampleProject._id,
        projectName: sampleProject.name,
        title: 'Lead Window Eligible Item',
        type: 'POST_4x5',
        channel: 'BOTH',
        scheduledDate: new Date('2026-11-04T12:00:00.000Z'),
        scheduledTime: '12:00',
        topic: 'Early Bird Release',
        creativeBrief: 'Spotlight on launch pricing',
        approvalStatus: 'APPROVED',
        publishStatus: 'SCHEDULED',
      });

      // Item 2: Scheduled November 20 (outside 7 days lead window) -> SHOULD NOT ENQUEUE
      await PlanItem.create({
        organizationId: orgA._id,
        planId: samplePlan._id,
        projectId: sampleProject._id,
        projectName: sampleProject.name,
        title: 'Far Future Item',
        type: 'POST_4x5',
        channel: 'BOTH',
        scheduledDate: new Date('2026-11-20T12:00:00.000Z'),
        scheduledTime: '12:00',
        topic: 'Future release',
        creativeBrief: 'Upcoming',
        approvalStatus: 'APPROVED',
        publishStatus: 'SCHEDULED',
      });

      // Item 3: Inside window but DRAFT (not approved) -> SHOULD NOT ENQUEUE
      await PlanItem.create({
        organizationId: orgA._id,
        planId: samplePlan._id,
        projectId: sampleProject._id,
        projectName: sampleProject.name,
        title: 'Unapproved Item',
        type: 'POST_4x5',
        channel: 'BOTH',
        scheduledDate: new Date('2026-11-03T12:00:00.000Z'),
        scheduledTime: '12:00',
        topic: 'Draft',
        creativeBrief: 'Draft',
        approvalStatus: 'DRAFT',
        publishStatus: 'SCHEDULED',
      });

      // Run 1: Should evaluate and enqueue exactly 1 job for Item 1
      const run1 = await rollingScheduler.runRollingScheduler(fakeNow);
      expect(run1.enqueuedJobsCount).toBe(1);
      expect(run1.enqueuedItemIds).toContain(itemEligible._id.toString());

      const jobsAfterRun1 = await Job.find({ organizationId: orgA._id });
      expect(jobsAfterRun1).toHaveLength(1);
      expect(jobsAfterRun1[0].idempotencyKey).toBe(`gen-creative:${itemEligible._id.toString()}`);

      // Run 2: Running the scheduler twice creates NO duplicate job!
      const run2 = await rollingScheduler.runRollingScheduler(fakeNow);
      expect(run2.enqueuedJobsCount).toBe(0);
      expect(run2.skippedCount).toBe(1);

      const jobsAfterRun2 = await Job.find({ organizationId: orgA._id });
      expect(jobsAfterRun2).toHaveLength(1);
    });
  });

  // =========================================================================
  // 6. Rescheduling Recalculation & Job Cancellation
  // =========================================================================
  describe('6. Rescheduling Recalculation & Stale Job Cancellation', () => {
    it('moving an item outside the lead window cancels its pending job', async () => {
      const fakeNow = new Date('2026-11-01T00:00:00.000Z');
      vi.useFakeTimers();
      vi.setSystemTime(fakeNow);

      const item = await PlanItem.create({
        organizationId: orgA._id,
        planId: samplePlan._id,
        projectId: sampleProject._id,
        title: 'Reschedule Target Item',
        type: 'POST_4x5',
        channel: 'INSTAGRAM',
        scheduledDate: new Date('2026-11-05T10:00:00.000Z'),
        scheduledTime: '10:00',
        topic: 'Initial Topic',
        creativeBrief: 'Initial Brief',
        approvalStatus: 'APPROVED',
        publishStatus: 'SCHEDULED',
        version: 1,
      });

      // Enqueue job as it is within 7 days
      await rollingScheduler.runRollingScheduler(fakeNow);
      const pendingJob = await Job.findOne({
        organizationId: orgA._id,
        'payload.planItemId': item._id.toString(),
        status: 'PENDING',
      });
      expect(pendingJob).not.toBeNull();

      // Generate fresh manager token for fake system time
      const loginRes = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'manager@skylinedev.com', password: 'Password123!' });
      const currentManagerToken = loginRes.body.data.accessToken;

      // Reschedule outside the window (e.g. November 28) via API
      const res = await request(app)
        .patch(`/api/v1/plan-items/${item._id}/reschedule`)
        .set('Authorization', `Bearer ${currentManagerToken}`)
        .set('x-organization-id', orgA._id.toString())
        .send({
          scheduledDate: '2026-11-28',
          scheduledTime: '10:00',
          version: 1,
        });

      expect(res.status).toBe(200);

      // Verify that the pending job was cancelled!
      const cancelledJob = await Job.findById(pendingJob?._id);
      expect(cancelledJob?.status).toBe('FAILED');
      expect(cancelledJob?.errorMessage).toContain('outside generation lead window');
    });
  });

  // =========================================================================
  // 7. Creative Versions, Approvals & Revision Resets
  // =========================================================================
  describe('7. Creative Versions, Approval Flow & Revision Reset', () => {
    it('generates version 1, approves it, then requesting revision creates version 2 and resets approval', async () => {
      const planItem = await PlanItem.create({
        organizationId: orgA._id,
        planId: samplePlan._id,
        projectId: sampleProject._id,
        title: 'Version Progression Test',
        type: 'POST_4x5',
        channel: 'INSTAGRAM',
        scheduledDate: new Date('2026-11-10'),
        scheduledTime: '18:00',
        topic: 'Master Bedroom Suite',
        creativeBrief: 'Focus on Italian marble and wide terrace balcony',
        approvalStatus: 'APPROVED',
        publishStatus: 'SCHEDULED',
      });

      // 1. Generate Creative v1
      const v1Res = await request(app)
        .post('/api/v1/ai/creatives/generate')
        .set('Authorization', `Bearer ${managerTokenA}`)
        .set('x-organization-id', orgA._id.toString())
        .send({
          planItemId: planItem._id.toString(),
          aspectRatio: '4:5',
          language: 'English',
        });

      expect(v1Res.status).toBe(201);
      const creativeV1 = v1Res.body.data;
      expect(creativeV1.version).toBe(1);
      expect(creativeV1.approvalStatus).toBe('PENDING_APPROVAL');

      // 2. Approver grants statutory approval for Version 1
      const approvalItem = await Approval.findOne({
        organizationId: orgA._id,
        creativeId: creativeV1._id,
      });
      expect(approvalItem).not.toBeNull();

      const approveRes = await request(app)
        .post(`/api/v1/approvals/${approvalItem?._id}/decide`)
        .set('Authorization', `Bearer ${approverTokenA}`)
        .set('x-organization-id', orgA._id.toString())
        .send({
          decision: 'APPROVED',
          factChecklist: {
            priceVerified: true,
            bedroomsVerified: true,
            amenitiesVerified: true,
            ctaVerified: true,
            reraDisclaimerVerified: true,
          },
          feedback: 'Cleared by compliance team.',
        });

      expect(approveRes.status).toBe(200);

      // Verify creative is now APPROVED
      const approvedCreative = await Creative.findById(creativeV1._id);
      expect(approvedCreative?.approvalStatus).toBe('APPROVED');

      // 3. User requests a revision on this creative
      const revisionRes = await request(app)
        .post(`/api/v1/ai/creatives/${creativeV1._id}/revision`)
        .set('Authorization', `Bearer ${managerTokenA}`)
        .set('x-organization-id', orgA._id.toString())
        .send({
          revisionNotes: 'Highlight the skyline sunset and add private elevator mention.',
        });

      expect(revisionRes.status).toBe(200);
      const creativeV2 = revisionRes.body.data;

      // Verification: A revision request creates version 2 and requires fresh approval!
      expect(creativeV2.version).toBe(2);
      expect(creativeV2.approvalStatus).toBe('PENDING_APPROVAL');
      expect(creativeV2.history).toHaveLength(1);
      expect(creativeV2.history[0].version).toBe(1);

      // Verify linked Approval reset back to PENDING
      const updatedApproval = await Approval.findOne({
        organizationId: orgA._id,
        creativeId: creativeV1._id,
      });
      expect(updatedApproval?.status).toBe('PENDING');
      expect(updatedApproval?.comments.some((c) => c.text.includes('Revision requested'))).toBe(true);
    });
  });

  // =========================================================================
  // 8. Property Master Data Changes Flag Creative for Re-Review
  // =========================================================================
  describe('8. Master Property Data Change Flags Creatives for Re-Review', () => {
    it('updating project price range flags all existing project creatives for re-review', async () => {
      // 1. Create approved creative
      const creative = await Creative.create({
        organizationId: orgA._id,
        projectId: sampleProject._id,
        format: '4:5',
        headline: 'Luxury Living at Skyline',
        caption: 'Prices starting from ₹2.5 Cr.',
        hashtags: ['#Skyline'],
        status: 'APPROVED',
        approvalStatus: 'APPROVED',
        version: 1,
        factCheckPassed: true,
        reReviewRequired: false,
      });

      const approval = await Approval.create({
        organizationId: orgA._id,
        entityType: 'CREATIVE',
        creativeId: creative._id,
        title: 'Waterfront Campaign',
        status: 'APPROVED',
      });

      // 2. Project master data changes price range via API
      const patchRes = await request(app)
        .patch(`/api/v1/projects/${sampleProject._id}`)
        .set('Authorization', `Bearer ${ownerTokenA}`)
        .set('x-organization-id', orgA._id.toString())
        .send({
          priceRange: {
            min: 30000000,
            max: 65000000,
            display: '₹3.0 Cr - ₹6.5 Cr',
          },
        });

      expect(patchRes.status).toBe(200);

      // 3. Verify creative is flagged for re-review and approval status changed to CHANGES_REQUESTED
      const updatedCreative = await Creative.findById(creative._id);
      expect(updatedCreative?.reReviewRequired).toBe(true);
      expect(updatedCreative?.approvalStatus).toBe('CHANGES_REQUESTED');

      const updatedApproval = await Approval.findById(approval._id);
      expect(updatedApproval?.status).toBe('CHANGES_REQUESTED');

      // 4. Verify in-app notification created
      const notifs = await Notification.find({
        organizationId: orgA._id,
        category: 'RERA_COMPLIANCE',
      });
      expect(notifs.length).toBeGreaterThanOrEqual(1);
      expect(notifs[0].title).toContain('Project Data Changed');
    });
  });
});
