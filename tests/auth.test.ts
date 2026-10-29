import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { Express } from 'express';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import bcrypt from 'bcryptjs';
import { createApp } from '../src/app.js';
import {
  Organization,
  User,
  Membership,
  RefreshToken,
  Project,
} from '../src/models/index.js';
import { initAllIndexes } from '../src/models/initIndexes.js';

describe('Phase 8: Authentication, Authorization & Tenant Isolation', () => {
  let app: Express;
  let mongod: MongoMemoryServer;

  // Test Entities
  let orgA: any;
  let orgB: any;
  let userOwnerA: any;
  let userViewerA: any;
  let userOwnerB: any;
  let projectOrgB: any;

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
    // Clear test collections
    await User.deleteMany({});
    await Organization.deleteMany({});
    await Membership.deleteMany({});
    await RefreshToken.deleteMany({});
    await Project.deleteMany({});

    const passwordHash = await bcrypt.hash('Password123!', 10);

    // 1. Setup Tenant A
    orgA = await Organization.create({
      name: 'Apex Luxury Estates',
      slug: 'apex-luxury',
    });

    userOwnerA = await User.create({
      email: 'owner@apex-luxury.in',
      fullName: 'Vikram Singhania',
      passwordHash,
    });

    await Membership.create({
      organizationId: orgA._id,
      userId: userOwnerA._id,
      role: 'org_owner',
      status: 'ACTIVE',
    });

    userViewerA = await User.create({
      email: 'viewer@apex-luxury.in',
      fullName: 'Aarav Sharma',
      passwordHash,
    });

    await Membership.create({
      organizationId: orgA._id,
      userId: userViewerA._id,
      role: 'viewer',
      status: 'ACTIVE',
    });

    // 2. Setup Tenant B
    orgB = await Organization.create({
      name: 'Zenith Commercial Group',
      slug: 'zenith-commercial',
    });

    userOwnerB = await User.create({
      email: 'owner@zenith-commercial.in',
      fullName: 'Rajesh Mehta',
      passwordHash,
    });

    await Membership.create({
      organizationId: orgB._id,
      userId: userOwnerB._id,
      role: 'org_owner',
      status: 'ACTIVE',
    });

    projectOrgB = await Project.create({
      organizationId: orgB._id,
      name: 'Zenith Logistics Hub',
      slug: 'zenith-logistics',
      category: 'COMMERCIAL',
      subtype: 'Warehouse',
      status: 'ACTIVE',
      reraNumber: 'RERA-TEST-2026-999',
      location: {
        address: '100 Logistics Park',
        city: 'Ahmedabad',
        microMarket: 'Sanand',
        state: 'Gujarat',
        pincode: '382110',
      },
      priceRange: { min: 10000000, max: 50000000, display: '₹1 Cr - ₹5 Cr' },
      details: { bedrooms: [1] },
      amenities: ['Cargo Bay'],
    });
  });

  describe('1. Workspace Signup / Registration', () => {
    it('creates a new workspace, user and organization owner via /signup', async () => {
      const payload = {
        name: 'Kabir Oberoi',
        email: 'kabir@oberoi-realty.in',
        organizationName: 'Oberoi Luxury Living',
        password: 'Password999!',
      };

      const res = await request(app)
        .post('/api/v1/auth/signup')
        .send(payload);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.user.email).toBe('kabir@oberoi-realty.in');
      expect(res.body.data.accessToken).toBeDefined();
    });

    it('rejects duplicate email during registration', async () => {
      const payload = {
        name: 'Duplicate Owner',
        email: 'owner@apex-luxury.in',
        organizationName: 'Duplicate Agency',
        password: 'Password999!',
      };

      const res = await request(app)
        .post('/api/v1/auth/signup')
        .send(payload);

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
    });
  });

  describe('2. Login & Credentials Security', () => {
    it('successfully logs in with valid credentials, returning accessToken and cookie', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: 'owner@apex-luxury.in',
          password: 'Password123!',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.user.email).toBe('owner@apex-luxury.in');
      expect(res.body.data.user.role).toBe('org_owner');
      expect(res.body.data).toHaveProperty('accessToken');

      const cookies = res.headers['set-cookie'];
      expect(cookies).toBeDefined();
      const cookieStr = Array.isArray(cookies) ? cookies.join(';') : cookies;
      expect(cookieStr).toContain('refreshToken=');
    });

    it('returns generic "Invalid credentials" (401) on wrong password', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: 'owner@apex-luxury.in',
          password: 'WrongPassword456!',
        });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
      expect(res.body.error.message).toBe('Invalid credentials');
    });

    it('returns generic "Invalid credentials" (401) for non-existent email', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: 'nonexistent@nowhere.com',
          password: 'Password123!',
        });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
      expect(res.body.error.message).toBe('Invalid credentials');
    });
  });

  describe('3. Token Rotation & Refresh', () => {
    it('refreshes access token and rotates refresh token cookie', async () => {
      // 1. Initial login
      const loginRes = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: 'owner@apex-luxury.in',
          password: 'Password123!',
        });

      const rawCookie = loginRes.headers['set-cookie'][0];
      const refreshTokenCookie = rawCookie.split(';')[0]; // refreshToken=...

      // 2. Call refresh using the cookie
      const refreshRes = await request(app)
        .post('/api/v1/auth/refresh')
        .set('Cookie', [refreshTokenCookie]);

      expect(refreshRes.status).toBe(200);
      expect(refreshRes.body.success).toBe(true);
      expect(refreshRes.body.data).toHaveProperty('accessToken');
      expect(refreshRes.body.data.user.email).toBe('owner@apex-luxury.in');

      // Verify a new rotated cookie was dispatched
      const newRawCookie = refreshRes.headers['set-cookie'][0];
      expect(newRawCookie).toBeDefined();

      // 3. Attempting to replay old refresh token should now fail (401)
      const replayRes = await request(app)
        .post('/api/v1/auth/refresh')
        .set('Cookie', [refreshTokenCookie]);

      expect(replayRes.status).toBe(401);
      expect(replayRes.body.error.code).toBe('INVALID_REFRESH_TOKEN');
    });
  });

  describe('4. GET /auth/me Profile & Tenant Resolution', () => {
    it('returns current user session and organization info with Bearer token', async () => {
      const loginRes = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: 'owner@apex-luxury.in',
          password: 'Password123!',
        });

      const token = loginRes.body.data.accessToken;

      const meRes = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${token}`);

      expect(meRes.status).toBe(200);
      expect(meRes.body.success).toBe(true);
      expect(meRes.body.data.user.email).toBe('owner@apex-luxury.in');
      expect(meRes.body.data.user.name).toBe('Vikram Singhania');
      expect(meRes.body.data.user.role).toBe('org_owner');
      expect(meRes.body.data.activeOrganization.name).toBe('Apex Luxury Estates');
    });

    it('returns 401 when Authorization header is missing', async () => {
      const res = await request(app).get('/api/v1/auth/me');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('AUTHENTICATION_REQUIRED');
    });
  });

  describe('5. Role-Based Access Control (RBAC): Viewer vs Owner', () => {
    it('allows an org_owner to call owner-only endpoint (invite member)', async () => {
      const loginOwner = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: 'owner@apex-luxury.in',
          password: 'Password123!',
        });

      const ownerToken = loginOwner.body.data.accessToken;

      const inviteRes = await request(app)
        .post('/api/v1/auth/invite')
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-organization-id', orgA._id.toString())
        .send({
          email: 'consultant@apex-luxury.in',
          role: 'marketing_manager',
        });

      expect(inviteRes.status).toBe(201);
      expect(inviteRes.body.success).toBe(true);
      expect(inviteRes.body.data.email).toBe('consultant@apex-luxury.in');
    });

    it('forbids a viewer from calling owner-only endpoint (403 Forbidden)', async () => {
      const loginViewer = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: 'viewer@apex-luxury.in',
          password: 'Password123!',
        });

      const viewerToken = loginViewer.body.data.accessToken;

      const inviteRes = await request(app)
        .post('/api/v1/auth/invite')
        .set('Authorization', `Bearer ${viewerToken}`)
        .set('x-organization-id', orgA._id.toString())
        .send({
          email: 'hacker@outside.in',
          role: 'org_owner',
        });

      // Viewer lacks 'members:invite' permission -> 403 Forbidden
      expect(inviteRes.status).toBe(403);
      expect(inviteRes.body.success).toBe(false);
      expect(inviteRes.body.error.code).toBe('INSUFFICIENT_PERMISSIONS');
    });
  });

  describe('6. Strict Tenant Isolation (Cross-Tenant Access Prevention)', () => {
    it('prevents user of Org A from accessing Org B by rejecting invalid organizationId (403 Forbidden)', async () => {
      // Login as user from Org A
      const loginRes = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: 'owner@apex-luxury.in',
          password: 'Password123!',
        });

      const tokenA = loginRes.body.data.accessToken;

      // User from Org A attempts to request resource or perform action under Org B
      const crossOrgRes = await request(app)
        .post('/api/v1/auth/invite')
        .set('Authorization', `Bearer ${tokenA}`)
        .set('x-organization-id', orgB._id.toString()) // Org B's ID
        .send({
          email: 'intruder@rogue.com',
          role: 'org_owner',
        });

      expect(crossOrgRes.status).toBe(403);
      expect(crossOrgRes.body.success).toBe(false);
      expect(crossOrgRes.body.error.code).toBe('TENANT_ACCESS_DENIED');
      expect(crossOrgRes.body.error.message).toContain('You do not have active access to this organization');
    });
  });

  describe('7. Password Reset Lifecycle', () => {
    it('dispatches forgot-password reset token and enables password update', async () => {
      // 1. Request forgot-password
      const forgotRes = await request(app)
        .post('/api/v1/auth/forgot-password')
        .send({ email: 'owner@apex-luxury.in' });

      expect(forgotRes.status).toBe(200);
      expect(forgotRes.body.success).toBe(true);

      // Verify token in DB
      const user = await User.findOne({ email: 'owner@apex-luxury.in' });
      expect(user!.resetPasswordToken).toBeDefined();

      // Retrieve stored token or simulate reset request
      const rawToken = 'simulated_raw_reset_token_dev_123';
      const crypto = await import('crypto');
      const hashed = crypto.createHash('sha256').update(rawToken).digest('hex');
      user!.resetPasswordToken = hashed;
      user!.resetPasswordExpires = new Date(Date.now() + 60 * 60 * 1000);
      await user!.save();

      // 2. Reset password
      const resetRes = await request(app)
        .post('/api/v1/auth/reset-password')
        .send({
          token: rawToken,
          password: 'NewStrongPassword789!',
        });

      expect(resetRes.status).toBe(200);
      expect(resetRes.body.success).toBe(true);

      // 3. Old password should fail
      const oldLogin = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: 'owner@apex-luxury.in',
          password: 'Password123!',
        });
      expect(oldLogin.status).toBe(401);

      // 4. New password succeeds
      const newLogin = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: 'owner@apex-luxury.in',
          password: 'NewStrongPassword789!',
        });
      expect(newLogin.status).toBe(200);
      expect(newLogin.body.data.user.email).toBe('owner@apex-luxury.in');
    });
  });

  describe('8. Logout', () => {
    it('revokes refresh token and clears session cookie', async () => {
      const loginRes = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: 'owner@apex-luxury.in',
          password: 'Password123!',
        });

      const rawCookie = loginRes.headers['set-cookie'][0];
      const refreshTokenCookie = rawCookie.split(';')[0];

      const logoutRes = await request(app)
        .post('/api/v1/auth/logout')
        .set('Cookie', [refreshTokenCookie]);

      expect(logoutRes.status).toBe(200);
      expect(logoutRes.body.success).toBe(true);

      // Verify cookie cleared
      const setCookies = logoutRes.headers['set-cookie'];
      const clearedStr = Array.isArray(setCookies) ? setCookies.join(';') : setCookies;
      expect(clearedStr).toContain('refreshToken=;');
    });
  });

  describe('9. CORS Origin Policy', () => {
    it('allows CORS origin from http://localhost:5174 in development', async () => {
      const res = await request(app)
        .options('/api/v1/auth/signup')
        .set('Origin', 'http://localhost:5174')
        .set('Access-Control-Request-Method', 'POST');

      expect(res.status).toBe(204);
      expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5174');
      expect(res.headers['access-control-allow-credentials']).toBe('true');
    });

    it('allows CORS origin from http://localhost:5173 in development', async () => {
      const res = await request(app)
        .options('/api/v1/auth/login')
        .set('Origin', 'http://localhost:5173')
        .set('Access-Control-Request-Method', 'POST');

      expect(res.status).toBe(204);
      expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    });
  });
});
