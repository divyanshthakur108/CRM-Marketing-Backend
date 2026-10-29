import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import express, { Express } from 'express';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import bcrypt from 'bcryptjs';
import { createApp } from '../src/app.js';
import { createRateLimiter } from '../src/middleware/rateLimiter.js';
import { notFoundHandler } from '../src/middleware/notFoundHandler.js';
import { errorHandler } from '../src/middleware/errorHandler.js';
import { Organization, User, Membership } from '../src/models/index.js';

describe('Phase 6: Backend API & Architecture Foundation', () => {
  let app: Express;
  let mongod: MongoMemoryServer;
  let testOrgId: string;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri());

    // Seed test tenant & credentials
    const org = await Organization.create({
      name: 'Apex Luxury Estates',
      slug: 'apex-luxury-test',
    });
    testOrgId = org._id.toString();

    const passwordHash = await bcrypt.hash('Password123!', 10);
    const user = await User.create({
      email: 'owner@apex-luxury.in',
      fullName: 'Vikramaditya Singhania',
      passwordHash,
    });

    await Membership.create({
      organizationId: org._id,
      userId: user._id,
      role: 'OWNER',
      status: 'ACTIVE',
    });

    app = createApp();
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongod.stop();
  });

  describe('1. Standard Format & Health Check', () => {
    it('returns 200 and standard success format { success: true, data, meta? } on GET /api/v1/health', async () => {
      const res = await request(app).get('/api/v1/health');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('success', true);
      expect(res.body).toHaveProperty('data');
      expect(res.body.data).toHaveProperty('status', 'ok');
      expect(res.body.data).toHaveProperty('db');
    });

    it('injects and echoes X-Request-Id correlation header', async () => {
      const customId = 'test-req-id-12345';
      const res = await request(app)
        .get('/api/v1/health')
        .set('X-Request-Id', customId);

      expect(res.status).toBe(200);
      expect(res.headers['x-request-id']).toBe(customId);
    });

    it('sets standard security headers via helmet', async () => {
      const res = await request(app).get('/api/v1/health');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
    });
  });

  describe('2. Validation & Error Handling (400 Invalid Input with Field Details)', () => {
    it('returns 400 with field details when request body fails validation', async () => {
      const invalidPayload = {
        email: 'not-an-email',
        password: '123', // shorter than 6 characters
      };

      const res = await request(app)
        .post('/api/v1/auth/login')
        .send(invalidPayload);

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('success', false);
      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toHaveProperty('code', 'VALIDATION_ERROR');
      expect(res.body.error).toHaveProperty('message', 'Validation failed');
      expect(Array.isArray(res.body.error.details)).toBe(true);

      const fieldNames = res.body.error.details.map((d: { field: string }) => d.field);
      expect(fieldNames).toContain('email');
      expect(fieldNames).toContain('password');
    });

    it('returns 400 when query parameter fails validation on GET /api/v1/health?verbose=invalid', async () => {
      const res = await request(app).get('/api/v1/health?verbose=invalid');

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.details[0].field).toBe('verbose');
    });
  });

  describe('3. Unknown Route Handling (404 in Standard Format)', () => {
    it('returns 404 in standard { success: false, error: { code, message } } format', async () => {
      const res = await request(app).get('/api/v1/non-existent-route-xyz');

      expect(res.status).toBe(404);
      expect(res.body).toEqual({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Cannot GET /api/v1/non-existent-route-xyz - Route not found',
        },
      });
    });
  });

  describe('4. Rate Limiting (429 Rate Limit Exceeded)', () => {
    it('returns 429 when rate limit is exceeded on a protected route', async () => {
      // Create an isolated sub-app with strict limit of 2 requests
      const testApp = express();
      const testLimiter = createRateLimiter({
        max: 2,
        windowMs: 10000,
        message: 'Rate limit test threshold exceeded',
      });

      testApp.use('/test-limited', testLimiter, (_req, res) => {
        res.json({ success: true, data: 'allowed' });
      });
      testApp.use(notFoundHandler);
      testApp.use(errorHandler);

      // Request 1: OK
      const res1 = await request(testApp).get('/test-limited');
      expect(res1.status).toBe(200);

      // Request 2: OK
      const res2 = await request(testApp).get('/test-limited');
      expect(res2.status).toBe(200);

      // Request 3: Exceeded -> 429
      const res3 = await request(testApp).get('/test-limited');
      expect(res3.status).toBe(429);
      expect(res3.body).toEqual({
        success: false,
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'Rate limit test threshold exceeded',
        },
      });
    });
  });

  describe('5. Authentication & Tenant Scoping (200 Success)', () => {
    it('successfully logs in with verified tenant credentials', async () => {
      const validPayload = {
        email: 'owner@apex-luxury.in',
        password: 'Password123!',
        organizationId: testOrgId,
      };

      const res = await request(app)
        .post('/api/v1/auth/login')
        .send(validPayload);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.user.email).toBe('owner@apex-luxury.in');
      expect(res.body.data.user.role).toBe('OWNER');
      expect(res.body.data.user.organizationId).toBe(testOrgId);
      expect(res.body.data).toHaveProperty('accessToken');
    });
  });

  describe('6. Gemini AI Creative & Content Generation', () => {
    it('generates a luxury real estate marketing image or fallback render', async () => {
      const res = await request(app)
        .post('/api/v1/ai/generate-image')
        .send({
          prompt: 'Panoramic sea-facing penthouse balcony at sunset with infinity glass railings',
          aspectRatio: '4:5',
          projectName: 'The Palm Residences',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('url');
      expect(res.body.data).toHaveProperty('key');
      expect(res.body.data.prompt).toContain('Panoramic sea-facing penthouse');
    });

    it('generates marketing hooks and captions in selected language', async () => {
      const res = await request(app)
        .post('/api/v1/ai/generate-copy')
        .send({
          projectName: 'The Palm Residences',
          category: 'Apartment',
          location: 'Worli Sea Face, Mumbai',
          language: 'English',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('hooks');
      expect(res.body.data.hooks.length).toBeGreaterThan(0);
      expect(res.body.data).toHaveProperty('captions');
      expect(res.body.data).toHaveProperty('hashtags');
    });
  });
});

