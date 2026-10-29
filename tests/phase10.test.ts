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
  Budget,
  Plan,
  PlanItem,
  Approval,
} from '../src/models/index.js';
import { initAllIndexes } from '../src/models/initIndexes.js';

describe('Phase 10: Budget, Monthly Plan & Approvals Integration', () => {
  let app: Express;
  let mongod: MongoMemoryServer;

  // Test Entities
  let orgA: { _id: Types.ObjectId; name: string };
  let ownerTokenA: string;
  let managerTokenA: string;
  let approverTokenA: string;
  let viewerTokenA: string;
  let sampleProject: any;

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
    await Budget.deleteMany({});
    await Plan.deleteMany({});
    await PlanItem.deleteMany({});
    await Approval.deleteMany({});

    const passwordHash = await bcrypt.hash('Password123!', 10);

    // 1. Setup Tenant
    orgA = (await Organization.create({
      name: 'Skyline Premier Developments',
      slug: 'skyline-premier',
    })) as unknown as { _id: Types.ObjectId; name: string };

    // 2. Setup Users with distinct roles
    const ownerUser = await User.create({
      email: 'owner@skyline.in',
      fullName: 'Vikramaditya Oberoi',
      passwordHash,
    });
    await Membership.create({
      organizationId: orgA._id,
      userId: ownerUser._id,
      role: 'org_owner',
    });

    const managerUser = await User.create({
      email: 'manager@skyline.in',
      fullName: 'Sunita Rao',
      passwordHash,
    });
    await Membership.create({
      organizationId: orgA._id,
      userId: managerUser._id,
      role: 'marketing_manager',
    });

    const approverUser = await User.create({
      email: 'approver@skyline.in',
      fullName: 'Rohit Mehta',
      passwordHash,
    });
    await Membership.create({
      organizationId: orgA._id,
      userId: approverUser._id,
      role: 'client_approver',
    });

    const viewerUser = await User.create({
      email: 'viewer@skyline.in',
      fullName: 'Kavita Joshi',
      passwordHash,
    });
    await Membership.create({
      organizationId: orgA._id,
      userId: viewerUser._id,
      role: 'viewer',
    });

    // 3. Acquire auth tokens
    const loginOwner = await request(app).post('/api/v1/auth/login').send({
      email: 'owner@skyline.in',
      password: 'Password123!',
    });
    ownerTokenA = loginOwner.body.data.accessToken;

    const loginManager = await request(app).post('/api/v1/auth/login').send({
      email: 'manager@skyline.in',
      password: 'Password123!',
    });
    managerTokenA = loginManager.body.data.accessToken;

    const loginApprover = await request(app).post('/api/v1/auth/login').send({
      email: 'approver@skyline.in',
      password: 'Password123!',
    });
    approverTokenA = loginApprover.body.data.accessToken;

    const loginViewer = await request(app).post('/api/v1/auth/login').send({
      email: 'viewer@skyline.in',
      password: 'Password123!',
    });
    viewerTokenA = loginViewer.body.data.accessToken;

    // 4. Seed sample project for tenant
    sampleProject = await Project.create({
      organizationId: orgA._id,
      name: 'Skyline Solitaire',
      slug: 'skyline-solitaire',
      category: 'RESIDENTIAL',
      subtype: 'Apartments',
      status: 'ACTIVE',
      priceRange: {
        min: 20000000,
        max: 50000000,
        display: '₹2.0 Cr - ₹5.0 Cr',
      },
      location: {
        city: 'Mumbai',
        microMarket: 'Worli',
      },
    });
  });

  describe('1. Budget Management (GET/PUT /budgets/:month)', () => {
    it('returns default budget template auto-populated with tenant projects', async () => {
      const res = await request(app)
        .get('/api/v1/budgets/2026-11')
        .set('Authorization', `Bearer ${managerTokenA}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.month).toBe(11);
      expect(res.body.data.year).toBe(2026);
      expect(res.body.data.overallCap).toBe(500000);
      expect(res.body.data.projectAllocations.length).toBeGreaterThanOrEqual(1);
      expect(res.body.data.projectAllocations[0].projectName).toBe('Skyline Solitaire');
    });

    it('saves valid budget allocations within the overall cap', async () => {
      const res = await request(app)
        .put('/api/v1/budgets/2026-11')
        .set('Authorization', `Bearer ${managerTokenA}`)
        .send({
          overallCap: 600000,
          currency: 'INR',
          projectAllocations: [
            {
              projectId: sampleProject._id.toString(),
              projectName: sampleProject.name,
              amount: 450000,
              metaAds: 225000,
              googleAds: 150000,
              linkedinAds: 50000,
              directWhatsapp: 25000,
            },
          ],
        })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.overallCap).toBe(600000);
      expect(res.body.data.projectAllocations[0].amount).toBe(450000);
      expect(res.body.data.projectAllocations[0].metaAds).toBe(225000);
    });

    it('rejects allocations that exceed the cap with 409 Conflict', async () => {
      const res = await request(app)
        .put('/api/v1/budgets/2026-11')
        .set('Authorization', `Bearer ${managerTokenA}`)
        .send({
          overallCap: 400000,
          currency: 'INR',
          projectAllocations: [
            {
              projectId: sampleProject._id.toString(),
              amount: 550000, // Exceeds 400000 cap!
            },
          ],
        })
        .expect(409);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('BUDGET_CAP_EXCEEDED');
      expect(res.body.error.message).toContain('Allocations exceed budget cap');
    });
  });

  describe('2. Rule-Based Monthly Plan Generation (POST /plans/generate)', () => {
    it('generates a draft monthly plan with items spread across strategic days and timezone', async () => {
      const res = await request(app)
        .post('/api/v1/plans/generate')
        .set('Authorization', `Bearer ${managerTokenA}`)
        .send({
          month: '2026-11',
          projectId: sampleProject._id.toString(),
          overrideExisting: true,
        })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data.plan.status).toBe('DRAFT');
      expect(res.body.data.plan.itemsCount).toBeGreaterThanOrEqual(8);
      expect(res.body.data.items.length).toBeGreaterThanOrEqual(8);

      // Verify timezone and schedule attributes
      const firstItem = res.body.data.items[0];
      expect(firstItem.timezone).toBe('Asia/Kolkata');
      expect(firstItem.scheduledAt).toBeDefined();
      expect(firstItem.version).toBe(1);
      expect(firstItem.approvalStatus).toBe('DRAFT');
      expect(firstItem.publishStatus).toBe('SCHEDULED');
      expect(firstItem.topic).toBeDefined();
      expect(firstItem.creativeBrief).toBeDefined();
    });
  });

  describe('3. Plan Items CRUD, Rescheduling, Optimistic Locking & Pausing', () => {
    let generatedPlanId: string;
    let generatedItemId: string;

    beforeEach(async () => {
      const planRes = await request(app)
        .post('/api/v1/plans/generate')
        .set('Authorization', `Bearer ${managerTokenA}`)
        .send({
          month: 11,
          year: 2026,
          overrideExisting: true,
        });
      generatedPlanId = planRes.body.data.plan._id;
      generatedItemId = planRes.body.data.items[0]._id;
    });

    it('reschedules an item, updating its date, time and returning updated status', async () => {
      const res = await request(app)
        .patch(`/api/v1/plan-items/${generatedItemId}/reschedule`)
        .set('Authorization', `Bearer ${managerTokenA}`)
        .send({
          scheduledDate: '2026-11-20',
          scheduledTime: '15:30',
          timezone: 'Asia/Kolkata',
          version: 1,
        })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.scheduledTime).toBe('15:30');
      expect(res.body.data.version).toBe(2);
      expect(res.body.data.publishStatus).toBe('SCHEDULED');
    });

    it('rejects stale item update with 409 Conflict when version mismatches', async () => {
      // First update brings version to 2
      await request(app)
        .patch(`/api/v1/plan-items/${generatedItemId}`)
        .set('Authorization', `Bearer ${managerTokenA}`)
        .send({
          title: 'Updated title version 2',
          version: 1,
        })
        .expect(200);

      // Second update still presenting version: 1 should be rejected as stale
      const res = await request(app)
        .patch(`/api/v1/plan-items/${generatedItemId}`)
        .set('Authorization', `Bearer ${managerTokenA}`)
        .send({
          title: 'Stale update attempt',
          version: 1, // Stale! Current version is 2
        })
        .expect(409);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('CONCURRENT_UPDATE_CONFLICT');
      expect(res.body.error.message).toContain('Stale update rejected');
    });

    it('pauses and resumes a scheduled plan item', async () => {
      const pauseRes = await request(app)
        .patch(`/api/v1/plan-items/${generatedItemId}/pause`)
        .set('Authorization', `Bearer ${managerTokenA}`)
        .expect(200);

      expect(pauseRes.body.data.publishStatus).toBe('PAUSED');

      const resumeRes = await request(app)
        .patch(`/api/v1/plan-items/${generatedItemId}/resume`)
        .set('Authorization', `Bearer ${managerTokenA}`)
        .expect(200);

      expect(resumeRes.body.data.publishStatus).toBe('SCHEDULED');
    });
  });

  describe('4. Plan Flow & Decision Tracking (Draft -> In Review -> Changes Requested -> Approved)', () => {
    let planId: string;

    beforeEach(async () => {
      const planRes = await request(app)
        .post('/api/v1/plans/generate')
        .set('Authorization', `Bearer ${managerTokenA}`)
        .send({
          month: 11,
          year: 2026,
          overrideExisting: true,
        });
      planId = planRes.body.data.plan._id;
    });

    it('submits plan for review, transitioning plan to IN_REVIEW and items to PENDING_APPROVAL', async () => {
      const res = await request(app)
        .post(`/api/v1/plans/${planId}/submit`)
        .set('Authorization', `Bearer ${managerTokenA}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('IN_REVIEW');

      // Verify associated items transitioned to PENDING_APPROVAL
      const itemsRes = await request(app)
        .get(`/api/v1/plan-items?planId=${planId}`)
        .set('Authorization', `Bearer ${managerTokenA}`);

      expect(itemsRes.body.data.every((i: any) => i.approvalStatus === 'PENDING_APPROVAL')).toBe(true);

      // Verify Approval record created
      const approvals = await Approval.find({ planId });
      expect(approvals.length).toBe(1);
      expect(approvals[0].status).toBe('PENDING');
    });

    it('blocks viewer role from approving marketing plan (403 Forbidden)', async () => {
      const res = await request(app)
        .post(`/api/v1/plans/${planId}/approve`)
        .set('Authorization', `Bearer ${viewerTokenA}`)
        .send({ comments: 'Attempted viewer approval' })
        .expect(403);

      expect(res.body.success).toBe(false);
    });

    it('allows manager/approver to request changes with comments and records in approvals', async () => {
      await request(app)
        .post(`/api/v1/plans/${planId}/submit`)
        .set('Authorization', `Bearer ${managerTokenA}`);

      const res = await request(app)
        .post(`/api/v1/plans/${planId}/request-changes`)
        .set('Authorization', `Bearer ${approverTokenA}`)
        .send({
          comments: 'Please increase WhatsApp broadcast frequency in week 3 for Diwali festive rush.',
        })
        .expect(200);

      expect(res.body.data.status).toBe('CHANGES_REQUESTED');

      // Verify decision logged in Approvals
      const approvalLog = await Approval.findOne({
        planId,
        status: 'CHANGES_REQUESTED',
      });
      expect(approvalLog).toBeDefined();
      expect(approvalLog?.comments[0].text).toContain('Diwali festive rush');
    });

    it('allows authorized client_approver to approve plan, marking items APPROVED and logging decision', async () => {
      await request(app)
        .post(`/api/v1/plans/${planId}/submit`)
        .set('Authorization', `Bearer ${managerTokenA}`);

      const res = await request(app)
        .post(`/api/v1/plans/${planId}/approve`)
        .set('Authorization', `Bearer ${approverTokenA}`)
        .send({ comments: 'Plan fully approved for production launch.' })
        .expect(200);

      expect(res.body.data.status).toBe('APPROVED');

      // Verify items approved
      const items = await PlanItem.find({ planId });
      expect(items.every((i) => i.approvalStatus === 'APPROVED')).toBe(true);

      // Verify final decision logged in Approvals collection
      const finalApproval = await Approval.findOne({
        planId,
        status: 'APPROVED',
      });
      expect(finalApproval).toBeDefined();
      expect(finalApproval?.decidedByName).toBe('approver@skyline.in');
    });
  });

  describe('5. Approvals Queue & Statutory Checklist Verification', () => {
    it('retrieves approval queue and allows deciding creative approval with checklist verification', async () => {
      // 1. Fetch queue (triggers auto-provisioning of sample creative approvals)
      const listRes = await request(app)
        .get('/api/v1/approvals')
        .set('Authorization', `Bearer ${approverTokenA}`)
        .expect(200);

      expect(listRes.body.success).toBe(true);
      expect(listRes.body.data.length).toBeGreaterThanOrEqual(1);

      const itemToDecide = listRes.body.data[0];

      // 2. Decide with all 5 statutory facts verified
      const decideRes = await request(app)
        .post(`/api/v1/approvals/${itemToDecide._id}/decide`)
        .set('Authorization', `Bearer ${approverTokenA}`)
        .send({
          decision: 'APPROVED',
          factChecklist: {
            priceVerified: true,
            bedroomsVerified: true,
            amenitiesVerified: true,
            ctaVerified: true,
            reraDisclaimerVerified: true,
          },
          feedback: 'Verified against Maharashtra RERA portal registration.',
        })
        .expect(200);

      expect(decideRes.body.success).toBe(true);
      expect(decideRes.body.data.status).toBe('APPROVED');
      expect(decideRes.body.data.factChecklist.reraDisclaimerVerified).toBe(true);
    });

    it('rejects approval if statutory checklist is incomplete', async () => {
      const listRes = await request(app)
        .get('/api/v1/approvals')
        .set('Authorization', `Bearer ${approverTokenA}`);

      const itemToDecide = listRes.body.data[0];

      const res = await request(app)
        .post(`/api/v1/approvals/${itemToDecide._id}/decide`)
        .set('Authorization', `Bearer ${approverTokenA}`)
        .send({
          decision: 'APPROVED',
          factChecklist: {
            priceVerified: true,
            bedroomsVerified: false, // Incomplete!
            amenitiesVerified: true,
            ctaVerified: true,
            reraDisclaimerVerified: true,
          },
        })
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toContain('All 5 statutory facts must be verified');
    });
  });
});
