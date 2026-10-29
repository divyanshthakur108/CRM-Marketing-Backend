import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { createApp } from '../src/app.js';
import { User } from '../src/models/User.js';
import { Organization } from '../src/models/Organization.js';
import { Membership } from '../src/models/Membership.js';
import { Invitation } from '../src/models/Invitation.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { seedAdmin } from '../src/scripts/seedAdmin.js';
import { env } from '../src/config/env.js';
import { hashToken } from '../src/utils/token.js';

describe('Admin Organization Creation, Client Invite & Onboarding Flow', () => {
  let mongoServer: MongoMemoryServer;
  let app: ReturnType<typeof createApp>;

  let adminAccessToken: string;
  let orgOwnerAccessToken: string;
  let orgOwnerOrgId: string;
  let otherOrgOwnerAccessToken: string;
  let otherOrgId: string;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    const uri = mongoServer.getUri();
    await mongoose.connect(uri);

    app = createApp();

    // 1. Seed Platform Admin
    await seedAdmin();

    // 2. Log in Platform Admin
    const adminLoginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({
        email: env.ADMIN_EMAIL,
        password: env.ADMIN_PASSWORD,
      });
    expect(adminLoginRes.status).toBe(200);
    adminAccessToken = adminLoginRes.body.data.accessToken;

    // 3. Seed Existing Org A (Apex Luxury Estates) and Owner
    const passwordHash = await bcrypt.hash('Password123!', 10);
    const orgA = await Organization.create({
      name: 'Apex Luxury Estates',
      slug: 'apex-luxury',
      status: 'ACTIVE',
      onboarding: {
        status: 'pending',
        currentStep: 1,
        data: {},
      },
    });
    orgOwnerOrgId = orgA._id.toString();

    const userA = await User.create({
      email: 'owner@apex-luxury.in',
      fullName: 'Apex Owner',
      passwordHash,
      isPlatformAdmin: false,
      status: 'active',
    });

    await Membership.create({
      organizationId: orgA._id,
      userId: userA._id,
      role: 'org_owner',
      status: 'ACTIVE',
    });

    const ownerLoginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({
        email: 'owner@apex-luxury.in',
        password: 'Password123!',
      });
    expect(ownerLoginRes.status).toBe(200);
    orgOwnerAccessToken = ownerLoginRes.body.data.accessToken;

    // 4. Seed Existing Org B (Zenith Commercial) and Owner
    const orgB = await Organization.create({
      name: 'Zenith Commercial',
      slug: 'zenith-commercial',
      status: 'ACTIVE',
      onboarding: {
        status: 'completed',
        currentStep: 4,
        data: {},
        submittedAt: new Date(),
      },
    });
    otherOrgId = orgB._id.toString();

    const userB = await User.create({
      email: 'owner@zenith-commercial.in',
      fullName: 'Zenith Owner',
      passwordHash,
      isPlatformAdmin: false,
      status: 'active',
    });

    await Membership.create({
      organizationId: orgB._id,
      userId: userB._id,
      role: 'org_owner',
      status: 'ACTIVE',
    });

    const otherLoginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({
        email: 'owner@zenith-commercial.in',
        password: 'Password123!',
      });
    expect(otherLoginRes.status).toBe(200);
    otherOrgOwnerAccessToken = otherLoginRes.body.data.accessToken;
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  // =========================================================================
  // 1. Admin Seed Script Verification
  // =========================================================================
  describe('1. Platform Admin Seed Script', () => {
    it('creates platform admin user with isPlatformAdmin=true and status=active', async () => {
      const admin = await User.findOne({ email: env.ADMIN_EMAIL.toLowerCase() });
      expect(admin).not.toBeNull();
      expect(admin!.isPlatformAdmin).toBe(true);
      expect(admin!.status).toBe('active');
    });

    it('is safe to rerun multiple times without errors', async () => {
      await expect(seedAdmin()).resolves.not.toThrow();
      const adminCount = await User.countDocuments({ email: env.ADMIN_EMAIL.toLowerCase() });
      expect(adminCount).toBe(1);
    });
  });

  // =========================================================================
  // 2. Admin Route Protection & RBAC
  // =========================================================================
  describe('2. Admin Route Protection (Non-Admin 403 Forbidden)', () => {
    it('rejects unauthenticated requests to admin routes with 401', async () => {
      const res = await request(app).get('/api/v1/admin/organizations');
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('rejects non-admin users (org_owner) from GET /admin/organizations with 403', async () => {
      const res = await request(app)
        .get('/api/v1/admin/organizations')
        .set('Authorization', `Bearer ${orgOwnerAccessToken}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('PLATFORM_ADMIN_REQUIRED');
    });

    it('rejects non-admin users from POST /admin/organizations with 403', async () => {
      const res = await request(app)
        .post('/api/v1/admin/organizations')
        .set('Authorization', `Bearer ${orgOwnerAccessToken}`)
        .send({
          organizationName: 'Unauthorized Org',
          clientName: 'Fake User',
          clientEmail: 'fake@unauthorized.in',
        });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    });
  });

  // =========================================================================
  // 3. Admin Creates Organization + Client User + 48h Invitation
  // =========================================================================
  describe('3. Admin Organization & Client Creation', () => {
    let createdOrgId: string;
    let inviteToken: string;
    const testClientEmail = 'rohan@sobha-developers.in';

    it('creates organization with pending onboarding, invited client user, and 48h invitation token hash', async () => {
      const res = await request(app)
        .post('/api/v1/admin/organizations')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({
          organizationName: 'Sobha Luxury Developers',
          clientName: 'Rohan Sobha',
          clientEmail: testClientEmail,
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.organization.name).toBe('Sobha Luxury Developers');
      expect(res.body.data.organization.onboarding.status).toBe('pending');
      expect(res.body.data.client.email).toBe(testClientEmail);
      expect(res.body.data.client.status).toBe('invited');
      expect(res.body.data).toHaveProperty('inviteToken');

      createdOrgId = res.body.data.organization.id;
      inviteToken = res.body.data.inviteToken;

      // Verify DB storage of invitation: only tokenHash stored!
      const invitation = await Invitation.findOne({ email: testClientEmail });
      expect(invitation).not.toBeNull();
      expect(invitation!.status).toBe('PENDING');
      expect(invitation!.tokenHash).toBe(hashToken(inviteToken));

      // Verify expiration is roughly 48 hours in the future
      const now = Date.now();
      const expires = new Date(invitation!.expiresAt).getTime();
      const diffHours = (expires - now) / (1000 * 60 * 60);
      expect(diffHours).toBeGreaterThan(47);
      expect(diffHours).toBeLessThanOrEqual(48.1);

      // Verify audit log entry was written
      const auditLog = await AuditLog.findOne({
        action: 'ORGANIZATION_CREATE',
        resourceId: createdOrgId,
      });
      expect(auditLog).not.toBeNull();
      expect(auditLog!.details).toHaveProperty('clientEmail', testClientEmail);
    });

    it('rejects duplicate client email with 409 Conflict', async () => {
      const res = await request(app)
        .post('/api/v1/admin/organizations')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({
          organizationName: 'Sobha Alternate Corp',
          clientName: 'Rohan Sobha Duplicate',
          clientEmail: testClientEmail, // already created above
        });

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('CLIENT_EMAIL_EXISTS');
    });

    it('allows admin to list organizations with pagination and search', async () => {
      const res = await request(app)
        .get('/api/v1/admin/organizations?search=Sobha&page=1&limit=10')
        .set('Authorization', `Bearer ${adminAccessToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.organizations.length).toBeGreaterThanOrEqual(1);
      const found = res.body.data.organizations.find((o: any) => o.name === 'Sobha Luxury Developers');
      expect(found).toBeDefined();
      expect(found.onboarding.status).toBe('pending');
      expect(found.client.email).toBe(testClientEmail);
      expect(found.client.status).toBe('invited');
    });

    it('blocks invited user from logging in before accepting invitation (403 Forbidden)', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: testClientEmail,
          password: 'AnyPassword123!',
        });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('ACCOUNT_INVITED');
    });

    it('rejects expired invitation token with 400 Bad Request', async () => {
      // Create an expired invitation for testing
      const expiredRawToken = 'expired_raw_token_xyz_123';
      const expiredTokenHash = hashToken(expiredRawToken);

      await Invitation.create({
        organizationId: new mongoose.Types.ObjectId(createdOrgId),
        email: 'expired@test.in',
        role: 'org_owner',
        token: expiredTokenHash,
        tokenHash: expiredTokenHash,
        status: 'PENDING',
        expiresAt: new Date(Date.now() - 1000 * 60 * 60), // expired 1 hour ago
      });

      const res = await request(app)
        .post(`/api/v1/auth/invitations/${expiredRawToken}/accept`)
        .send({
          password: 'ValidPassword123!',
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INVALID_INVITATION_TOKEN');
    });

    it('allows client to accept valid invitation, set password, and activates user', async () => {
      const res = await request(app)
        .post(`/api/v1/auth/invitations/${inviteToken}/accept`)
        .send({
          password: 'NewSecurePassword123!',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.user.email).toBe(testClientEmail);
      expect(res.body.data.user.role).toBe('org_owner');
      expect(res.body.data.user.onboardingStatus).toBe('pending');
      expect(res.body.data).toHaveProperty('accessToken');

      // Verify user status is now active in DB
      const user = await User.findOne({ email: testClientEmail });
      expect(user!.status).toBe('active');

      // Verify invitation status is now ACCEPTED
      const inv = await Invitation.findOne({ tokenHash: hashToken(inviteToken) });
      expect(inv!.status).toBe('ACCEPTED');
    });

    it('rejects reusing the same invitation token (single-use enforcement)', async () => {
      const res = await request(app)
        .post(`/api/v1/auth/invitations/${inviteToken}/accept`)
        .send({
          password: 'AnotherPassword123!',
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INVALID_INVITATION_TOKEN');
    });

    it('allows newly activated client to log in and returns role and onboarding status', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: testClientEmail,
          password: 'NewSecurePassword123!',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.user.email).toBe(testClientEmail);
      expect(res.body.data.user.role).toBe('org_owner');
      expect(res.body.data.user.onboardingStatus).toBe('pending');
    });

    it('allows admin to disable organization and blocks login for disabled users', async () => {
      const patchRes = await request(app)
        .patch(`/api/v1/admin/organizations/${createdOrgId}/status`)
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({ status: 'disabled' });

      expect(patchRes.status).toBe(200);
      expect(patchRes.body.data.status).toBe('DISABLED');

      // Try logging in with disabled client
      const loginRes = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: testClientEmail,
          password: 'NewSecurePassword123!',
        });

      expect(loginRes.status).toBe(403);
      expect(loginRes.body.success).toBe(false);

      // Re-enable organization for cleanliness
      await request(app)
        .patch(`/api/v1/admin/organizations/${createdOrgId}/status`)
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({ status: 'active' });
    });
  });

  // =========================================================================
  // 4. Onboarding 4-Step Flow & Tenant Isolation
  // =========================================================================
  describe('4. Onboarding Flow (org_owner only, scoped by organizationId)', () => {
    it('blocks user from Org B from reading Org A onboarding (Tenant Isolation)', async () => {
      const res = await request(app)
        .get('/api/v1/onboarding')
        .set('Authorization', `Bearer ${otherOrgOwnerAccessToken}`)
        .set('x-organization-id', orgOwnerOrgId); // Org B owner requesting Org A ID

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    });

    it('allows Org A owner to get initial onboarding status', async () => {
      const res = await request(app)
        .get('/api/v1/onboarding')
        .set('Authorization', `Bearer ${orgOwnerAccessToken}`)
        .set('x-organization-id', orgOwnerOrgId);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.currentStep).toBe(1);
      expect(res.body.data.status).toBe('pending');
      expect(res.body.data).toHaveProperty('data');
    });

    it('saves Step 1 (Company Details) as draft and advances currentStep to 2', async () => {
      const step1Payload = {
        companyName: 'Apex Luxury Estates Ltd.',
        legalEntityName: 'Apex Realty Developers LLP',
        registrationNumber: 'U45200MH2020PTC123456',
        contactPhone: '+91 98200 98200',
        contactEmail: 'contact@apex-luxury.in',
        officeAddress: 'Level 42, Apex Sky Tower, Worli',
        city: 'Mumbai',
        state: 'Maharashtra',
        pincode: '400018',
      };

      const res = await request(app)
        .put('/api/v1/onboarding/steps/1')
        .set('Authorization', `Bearer ${orgOwnerAccessToken}`)
        .set('x-organization-id', orgOwnerOrgId)
        .send(step1Payload);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.currentStep).toBe(2);
      expect(res.body.data.status).toBe('in_progress');
      expect(res.body.data.data.step1.companyName).toBe('Apex Luxury Estates Ltd.');
    });

    it('rejects invalid Step 1 data failing Zod validation (400 Bad Request)', async () => {
      const invalidPayload = {
        companyName: 'A', // too short (< 2)
        contactPhone: '',
      };

      const res = await request(app)
        .put('/api/v1/onboarding/steps/1')
        .set('Authorization', `Bearer ${orgOwnerAccessToken}`)
        .set('x-organization-id', orgOwnerOrgId)
        .send(invalidPayload);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('STEP_VALIDATION_ERROR');
    });

    it('saves Step 2 (Category & First Project)', async () => {
      const step2Payload = {
        developerCategory: 'Ultra-Luxury Residential',
        firstProjectName: 'Emerald Bay Penthouse Towers',
        projectType: 'Luxury Waterfront Residences',
        reraRegistrationNumber: 'P51800098765',
        city: 'Mumbai',
        expectedLaunchDate: '2026-12-01',
      };

      const res = await request(app)
        .put('/api/v1/onboarding/steps/2')
        .set('Authorization', `Bearer ${orgOwnerAccessToken}`)
        .set('x-organization-id', orgOwnerOrgId)
        .send(step2Payload);

      expect(res.status).toBe(200);
      expect(res.body.data.currentStep).toBe(3);
      expect(res.body.data.data.step2.firstProjectName).toBe('Emerald Bay Penthouse Towers');
    });

    it('saves Step 3 (Brand Guidelines)', async () => {
      const step3Payload = {
        brandName: 'Apex Luxury Estates',
        tagline: 'Architecting Unrivaled Grandeur',
        primaryColor: '#000000',
        secondaryColor: '#D4AF37',
        disclaimerFormat: 'RERA Registration No. P51800098765 available on maharera.mahaonline.gov.in',
      };

      const res = await request(app)
        .put('/api/v1/onboarding/steps/3')
        .set('Authorization', `Bearer ${orgOwnerAccessToken}`)
        .set('x-organization-id', orgOwnerOrgId)
        .send(step3Payload);

      expect(res.status).toBe(200);
      expect(res.body.data.currentStep).toBe(4);
      expect(res.body.data.data.step3.brandName).toBe('Apex Luxury Estates');
    });

    it('fails final submission if step 4 is missing (400 Bad Request)', async () => {
      const res = await request(app)
        .post('/api/v1/onboarding/submit')
        .set('Authorization', `Bearer ${orgOwnerAccessToken}`)
        .set('x-organization-id', orgOwnerOrgId);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('ONBOARDING_INCOMPLETE');
    });

    it('saves Step 4 (Marketing Goals & Monthly Budget)', async () => {
      const step4Payload = {
        primaryGoal: 'High-Intent HNI Lead Generation',
        targetAudienceType: 'Ultra-High-Net-Worth Individuals & C-Suite Executives',
        targetCpl: 4500,
        monthlyBudget: 2500000,
        preferredChannels: ['META', 'WHATSAPP'],
      };

      const res = await request(app)
        .put('/api/v1/onboarding/steps/4')
        .set('Authorization', `Bearer ${orgOwnerAccessToken}`)
        .set('x-organization-id', orgOwnerOrgId)
        .send(step4Payload);

      expect(res.status).toBe(200);
      expect(res.body.data.data.step4.monthlyBudget).toBe(2500000);
    });

    it('submits onboarding successfully when all 4 steps are complete', async () => {
      const res = await request(app)
        .post('/api/v1/onboarding/submit')
        .set('Authorization', `Bearer ${orgOwnerAccessToken}`)
        .set('x-organization-id', orgOwnerOrgId);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('completed');
      expect(res.body.data).toHaveProperty('submittedAt');

      // Verify database persistence
      const org = await Organization.findById(orgOwnerOrgId);
      expect(org!.onboarding.status).toBe('completed');
      expect(org!.onboarding.submittedAt).toBeDefined();
    });

    it('rejects modifying steps after onboarding is completed (400 Bad Request)', async () => {
      const res = await request(app)
        .put('/api/v1/onboarding/steps/1')
        .set('Authorization', `Bearer ${orgOwnerAccessToken}`)
        .set('x-organization-id', orgOwnerOrgId)
        .send({
          companyName: 'New Company',
          contactPhone: '+91 99999 99999',
          officeAddress: 'New Address',
          city: 'Mumbai',
          state: 'MH',
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('ONBOARDING_ALREADY_COMPLETED');
    });
  });
});
