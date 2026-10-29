import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import bcrypt from 'bcryptjs';
import { createApp } from '../src/app.js';
import { Organization } from '../src/models/Organization.js';
import { User } from '../src/models/User.js';
import { Membership } from '../src/models/Membership.js';
import { Project } from '../src/models/Project.js';
import { Plan } from '../src/models/Plan.js';
import { PlanItem } from '../src/models/PlanItem.js';
import { Creative } from '../src/models/Creative.js';
import { Approval } from '../src/models/Approval.js';
import { generateAccessToken } from '../src/utils/token.js';
import { initAllIndexes } from '../src/models/initIndexes.js';

describe('Phase 15: Role Matrix Tests (Role x Key Actions)', () => {
  let app: ReturnType<typeof createApp>;
  let mongod: MongoMemoryServer;

  let orgId: string;
  let projectId: string;
  let planItemId: string;
  let approvalId: string;

  // Tokens for each distinct role
  let tokenOwner: string;
  let tokenManager: string;
  let tokenCreator: string;
  let tokenApprover: string;
  let tokenAgent: string;
  let tokenViewer: string;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri());
    await initAllIndexes();

    app = createApp();

    const org = await Organization.create({
      name: 'Role Matrix Real Estate',
      slug: 'role-matrix-crm',
    });
    orgId = org._id.toString();

    const passwordHash = await bcrypt.hash('Password123!', 10);

    const roles = [
      { key: 'owner', role: 'org_owner', email: 'owner@matrix.com', name: 'Owner User' },
      { key: 'manager', role: 'marketing_manager', email: 'manager@matrix.com', name: 'Manager User' },
      { key: 'creator', role: 'creative_contributor', email: 'creator@matrix.com', name: 'Creator User' },
      { key: 'approver', role: 'client_approver', email: 'approver@matrix.com', name: 'Approver User' },
      { key: 'agent', role: 'sales_agent', email: 'agent@matrix.com', name: 'Agent User' },
      { key: 'viewer', role: 'viewer', email: 'viewer@matrix.com', name: 'Viewer User' },
    ];

    const tokens: Record<string, string> = {};

    for (const r of roles) {
      const u = await User.create({
        email: r.email,
        fullName: r.name,
        passwordHash,
      });

      await Membership.create({
        organizationId: org._id,
        userId: u._id,
        role: r.role,
        status: 'ACTIVE',
      });

      tokens[r.key] = generateAccessToken({
        userId: u._id.toString(),
        email: u.email,
        isPlatformAdmin: false,
        organizationId: orgId,
        role: r.role,
      });
    }

    tokenOwner = tokens.owner;
    tokenManager = tokens.manager;
    tokenCreator = tokens.creator;
    tokenApprover = tokens.approver;
    tokenAgent = tokens.agent;
    tokenViewer = tokens.viewer;

    // Seed shared project, plan item and approval
    const project = await Project.create({
      organizationId: org._id,
      name: 'Matrix Tower',
      slug: 'matrix-tower',
      category: 'COMMERCIAL',
      subtype: 'Office Space',
      priceRange: { min: 10000000, max: 20000000, display: '₹ 1 Cr - ₹ 2 Cr' },
      status: 'ACTIVE',
    });
    projectId = project._id.toString();

    const plan = await Plan.create({
      organizationId: org._id,
      month: 12,
      year: 2026,
      cycleName: 'December 2026 Plan',
      status: 'IN_REVIEW',
    });

    const planItem = await PlanItem.create({
      organizationId: org._id,
      planId: plan._id,
      projectId: project._id,
      title: 'Matrix Launch Post',
      type: 'POST_4x5',
      channel: 'INSTAGRAM',
      topic: 'Launch',
      creativeBrief: 'Teaser photo',
      scheduledDate: new Date(),
      scheduledTime: '10:00',
      scheduledAt: new Date(),
      status: 'PENDING_APPROVAL',
      version: 1,
    });
    planItemId = planItem._id.toString();

    const creative = await Creative.create({
      organizationId: org._id,
      planItemId: planItem._id,
      projectId: project._id,
      version: 1,
      format: '1:1',
      headline: 'Matrix Launch Post',
      caption: 'Exclusive launch for Role Matrix project',
      status: 'GENERATED',
      approvalStatus: 'PENDING_APPROVAL',
      factCheckPassed: true,
      factCheckIssues: [],
      reReviewRequired: false,
    });

    const approval = await Approval.create({
      organizationId: org._id,
      planItemId: planItem._id,
      creativeId: creative._id,
      status: 'PENDING',
    });
    approvalId = approval._id.toString();
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongod.stop();
  });

  describe('Key Action 1: Create Project (projects:create)', () => {
    it('allows org_owner to create project', async () => {
      const res = await request(app)
        .post('/api/v1/projects')
        .set('Authorization', `Bearer ${tokenOwner}`)
        .send({ name: 'Owner Tower', category: 'COMMERCIAL', subtype: 'Retail' });
      expect(res.status).toBe(201);
    });

    it('allows marketing_manager to create project', async () => {
      const res = await request(app)
        .post('/api/v1/projects')
        .set('Authorization', `Bearer ${tokenManager}`)
        .send({ name: 'Manager Complex', category: 'COMMERCIAL', subtype: 'Office' });
      expect(res.status).toBe(201);
    });

    it('blocks creative_contributor from creating project (403 Forbidden)', async () => {
      const res = await request(app)
        .post('/api/v1/projects')
        .set('Authorization', `Bearer ${tokenCreator}`)
        .send({ name: 'Blocked Complex', category: 'COMMERCIAL', subtype: 'Office' });
      expect(res.status).toBe(403);
    });

    it('blocks sales_agent from creating project (403 Forbidden)', async () => {
      const res = await request(app)
        .post('/api/v1/projects')
        .set('Authorization', `Bearer ${tokenAgent}`)
        .send({ name: 'Agent Blocked', category: 'COMMERCIAL', subtype: 'Office' });
      expect(res.status).toBe(403);
    });

    it('blocks viewer from creating project (403 Forbidden)', async () => {
      const res = await request(app)
        .post('/api/v1/projects')
        .set('Authorization', `Bearer ${tokenViewer}`)
        .send({ name: 'Viewer Blocked', category: 'COMMERCIAL', subtype: 'Office' });
      expect(res.status).toBe(403);
    });
  });

  describe('Key Action 2: Manage Budget (budget:write)', () => {
    it('allows org_owner to update budget', async () => {
      const res = await request(app)
        .put('/api/v1/budgets/2026-12')
        .set('Authorization', `Bearer ${tokenOwner}`)
        .send({
          overallCap: 5000000,
          projectAllocations: [{ projectId, projectName: 'Role Matrix Tower', amount: 5000000 }],
        });
      expect(res.status).toBe(200);
    });

    it('allows marketing_manager to update budget', async () => {
      const res = await request(app)
        .put('/api/v1/budgets/2026-12')
        .set('Authorization', `Bearer ${tokenManager}`)
        .send({
          overallCap: 4000000,
          projectAllocations: [{ projectId, projectName: 'Role Matrix Tower', amount: 4000000 }],
        });
      expect(res.status).toBe(200);
    });

    it('blocks creative_contributor from updating budget (403 Forbidden)', async () => {
      const res = await request(app)
        .put('/api/v1/budgets/2026-12')
        .set('Authorization', `Bearer ${tokenCreator}`)
        .send({
          overallCap: 4000000,
          projectAllocations: [{ projectId, projectName: 'Role Matrix Tower', amount: 4000000 }],
        });
      expect(res.status).toBe(403);
    });

    it('blocks client_approver from updating budget (403 Forbidden)', async () => {
      const res = await request(app)
        .put('/api/v1/budgets/2026-12')
        .set('Authorization', `Bearer ${tokenApprover}`)
        .send({
          overallCap: 4000000,
          projectAllocations: [{ projectId, projectName: 'Role Matrix Tower', amount: 4000000 }],
        });
      expect(res.status).toBe(403);
    });

    it('blocks sales_agent from updating budget (403 Forbidden)', async () => {
      const res = await request(app)
        .put('/api/v1/budgets/2026-12')
        .set('Authorization', `Bearer ${tokenAgent}`)
        .send({
          overallCap: 4000000,
          projectAllocations: [{ projectId, projectName: 'Role Matrix Tower', amount: 4000000 }],
        });
      expect(res.status).toBe(403);
    });
  });

  describe('Key Action 3: Creative & Plan Approvals (approvals:decide)', () => {
    it('allows client_approver to decide approval with checklist verification', async () => {
      const res = await request(app)
        .post(`/api/v1/approvals/${approvalId}/decide`)
        .set('Authorization', `Bearer ${tokenApprover}`)
        .send({
          decision: 'APPROVED',
          factChecklist: {
            priceVerified: true,
            bedroomsVerified: true,
            amenitiesVerified: true,
            ctaVerified: true,
            reraDisclaimerVerified: true,
          },
        });
      expect(res.status).toBe(200);
    });

    it('allows org_owner to decide approval', async () => {
      const res = await request(app)
        .post(`/api/v1/approvals/${approvalId}/decide`)
        .set('Authorization', `Bearer ${tokenOwner}`)
        .send({
          decision: 'CHANGES_REQUESTED',
          feedback: 'Change color scheme',
        });
      expect(res.status).toBe(200);
    });

    it('blocks creative_contributor from deciding approval (403 Forbidden)', async () => {
      const res = await request(app)
        .post(`/api/v1/approvals/${approvalId}/decide`)
        .set('Authorization', `Bearer ${tokenCreator}`)
        .send({ decision: 'APPROVED' });
      expect(res.status).toBe(403);
    });

    it('blocks sales_agent from deciding approval (403 Forbidden)', async () => {
      const res = await request(app)
        .post(`/api/v1/approvals/${approvalId}/decide`)
        .set('Authorization', `Bearer ${tokenAgent}`)
        .send({ decision: 'APPROVED' });
      expect(res.status).toBe(403);
    });

    it('blocks viewer from deciding approval (403 Forbidden)', async () => {
      const res = await request(app)
        .post(`/api/v1/approvals/${approvalId}/decide`)
        .set('Authorization', `Bearer ${tokenViewer}`)
        .send({ decision: 'APPROVED' });
      expect(res.status).toBe(403);
    });
  });

  describe('Key Action 4: Leads CRM (leads:write)', () => {
    it('allows sales_agent to create and advance leads', async () => {
      const res = await request(app)
        .post('/api/v1/leads')
        .set('Authorization', `Bearer ${tokenAgent}`)
        .send({
          name: 'Agent Inbound Lead',
          phone: '+91 97777 66666',
          stage: 'New',
          consentGiven: true,
        });
      expect(res.status).toBe(201);
    });

    it('allows marketing_manager to create leads', async () => {
      const res = await request(app)
        .post('/api/v1/leads')
        .set('Authorization', `Bearer ${tokenManager}`)
        .send({
          name: 'Manager Inbound Lead',
          phone: '+91 96666 55555',
          stage: 'New',
          consentGiven: true,
        });
      expect(res.status).toBe(201);
    });

    it('blocks creative_contributor from writing leads (403 Forbidden)', async () => {
      const res = await request(app)
        .post('/api/v1/leads')
        .set('Authorization', `Bearer ${tokenCreator}`)
        .send({
          name: 'Blocked Lead',
          phone: '+91 95555 44444',
          stage: 'New',
        });
      expect(res.status).toBe(403);
    });

    it('blocks viewer from writing leads (403 Forbidden)', async () => {
      const res = await request(app)
        .post('/api/v1/leads')
        .set('Authorization', `Bearer ${tokenViewer}`)
        .send({
          name: 'Viewer Lead',
          phone: '+91 94444 33333',
          stage: 'New',
        });
      expect(res.status).toBe(403);
    });
  });
});
