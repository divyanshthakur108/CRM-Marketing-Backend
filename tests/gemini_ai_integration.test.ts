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
  Creative,
  Job,
  UsageLedger,
  MediaAsset,
} from '../src/models/index.js';
import { initAllIndexes } from '../src/models/initIndexes.js';
import { env, maskSecret } from '../src/config/env.js';
import { GeminiAIProvider } from '../src/modules/ai/providers/geminiProvider.js';
import { creativeEngineService } from '../src/modules/ai/creativeEngineService.js';
import { defaultStorage } from '../src/storage/localStorage.adapter.js';
import fs from 'fs/promises';
import path from 'path';

describe('Gemini AI Provider & Cost Control Integration Tests', () => {
  let app: Express;
  let mongod: MongoMemoryServer;

  // Organizations & Users
  let orgA: any;
  let orgB: any;
  let ownerTokenA: string;
  let managerTokenA: string;
  let approverTokenA: string;
  let ownerTokenB: string;
  let sampleProjectA: any;
  let sampleProjectB: any;
  let testPhotoAsset: any;

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
    vi.restoreAllMocks();
    await User.deleteMany({});
    await Organization.deleteMany({});
    await Membership.deleteMany({});
    await Project.deleteMany({});
    await PropertyUnit.deleteMany({});
    await Creative.deleteMany({});
    await Job.deleteMany({});
    await UsageLedger.deleteMany({});
    await MediaAsset.deleteMany({});

    const passwordHash = await bcrypt.hash('Password123!', 10);

    // Setup Tenant A
    orgA = await Organization.create({
      name: 'Prestige Falcon Estates',
      slug: 'prestige-falcon',
    });

    const ownerA = await User.create({
      email: 'owner@prestige.com',
      passwordHash,
      fullName: 'Pradeep Owner',
    });
    await Membership.create({
      organizationId: orgA._id,
      userId: ownerA._id,
      role: 'org_owner',
    });

    const managerA = await User.create({
      email: 'manager@prestige.com',
      passwordHash,
      fullName: 'Meera Marketing',
    });
    await Membership.create({
      organizationId: orgA._id,
      userId: managerA._id,
      role: 'marketing_manager',
    });

    const approverA = await User.create({
      email: 'approver@prestige.com',
      passwordHash,
      fullName: 'Ananya Client',
    });
    await Membership.create({
      organizationId: orgA._id,
      userId: approverA._id,
      role: 'client_approver',
    });

    // Setup Tenant B (Isolation Check)
    orgB = await Organization.create({
      name: 'Godrej Palm Grove',
      slug: 'godrej-palm',
    });
    const ownerB = await User.create({
      email: 'owner@godrej.com',
      passwordHash,
      fullName: 'Gautam Godrej',
    });
    await Membership.create({
      organizationId: orgB._id,
      userId: ownerB._id,
      role: 'org_owner',
    });

    // Projects
    sampleProjectA = await Project.create({
      organizationId: orgA._id,
      name: 'Prestige Falcon City',
      slug: 'prestige-falcon-city',
      category: 'RESIDENTIAL',
      subtype: 'Apartments',
      status: 'ACTIVE',
      reraNumber: 'PRM/KA/RERA/1251/310/PR/170915/000214',
      location: {
        address: 'Kanakapura Road',
        city: 'Bengaluru',
        state: 'Karnataka',
        pincode: '560062',
      },
      priceRange: { min: 12000000, max: 25000000, display: '₹1.2 Cr - ₹2.5 Cr' },
      amenities: ['Clubhouse', 'Swimming Pool', 'Badminton Court'],
    });

    sampleProjectB = await Project.create({
      organizationId: orgB._id,
      name: 'Godrej Woods',
      slug: 'godrej-woods',
      category: 'RESIDENTIAL',
      subtype: 'Villas',
      status: 'ACTIVE',
      reraNumber: 'UPRERAPRJ704730',
      location: {
        address: 'Sector 43',
        city: 'Noida',
        state: 'Uttar Pradesh',
        pincode: '201301',
      },
      priceRange: { min: 20000000, max: 40000000, display: '₹2.0 Cr - ₹4.0 Cr' },
    });

    // Create a local sample image file to simulate source photography
    const sampleBuffer = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64'
    );
    const stored = await defaultStorage.upload(
      {
        filename: 'sample-living-room.png',
        buffer: sampleBuffer,
        mimetype: 'image/png',
      },
      'media'
    );

    testPhotoAsset = await MediaAsset.create({
      organizationId: orgA._id,
      projectId: sampleProjectA._id,
      filename: 'sample-living-room.png',
      url: stored.url,
      storageKey: stored.key,
      mimetype: 'image/png',
      sizeBytes: sampleBuffer.length,
      type: 'IMAGE',
      category: 'INTERIOR',
      actualOrIllustrative: 'ACTUAL',
      rightsConsent: { confirmed: true },
      aspectRatio: '1:1',
      isApproved: true,
      approvalStatus: 'APPROVED',
      processingStatus: 'ready',
    });

    // Generate JWT tokens
    const logA1 = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'owner@prestige.com', password: 'Password123!' });
    ownerTokenA = logA1.body.data.accessToken;

    const logA2 = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'manager@prestige.com', password: 'Password123!' });
    managerTokenA = logA2.body.data.accessToken;

    const logA3 = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'approver@prestige.com', password: 'Password123!' });
    approverTokenA = logA3.body.data.accessToken;

    const logB1 = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'owner@godrej.com', password: 'Password123!' });
    ownerTokenB = logB1.body.data.accessToken;
  });

  // =========================================================================
  // 1. Security: Masking & No Secret Leaks
  // =========================================================================
  describe('Security & Secret Protection', () => {
    it('masks secrets properly without revealing raw key material', () => {
      expect(maskSecret(null)).toBe('[NOT CONFIGURED]');
      expect(maskSecret('')).toBe('[NOT CONFIGURED]');
      expect(maskSecret('12345678')).toBe('****');
      expect(maskSecret('AIzaSyD-1234567890abcdef')).toBe('AIza...cdef');
    });

    it('health endpoint returns configured status WITHOUT exposing GEMINI_API_KEY', async () => {
      const res = await request(app)
        .get('/api/v1/ai/health')
        .set('Authorization', `Bearer ${ownerTokenA}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('configured');
      expect(res.body.data).toHaveProperty('imageModel');
      expect(res.body.data).toHaveProperty('videoModel');
      expect(res.body.data).toHaveProperty('costPerImageUsd');
      expect(res.body.data).toHaveProperty('costPerVideoSecondUsd');
      expect(res.body.data).toHaveProperty('dailyCapUsd');

      // Crucial: Must NEVER contain any key material in payload
      const jsonString = JSON.stringify(res.body);
      expect(jsonString).not.toContain('GEMINI_API_KEY');
      expect(jsonString).not.toContain('AIzaSy');
      if (env.GEMINI_API_KEY) {
        expect(jsonString).not.toContain(env.GEMINI_API_KEY);
      }
    });

    it('sanitizes errors in provider to ensure raw key is never logged or thrown', () => {
      const provider = new GeminiAIProvider();
      const rawError = new Error(`Google API failed with key ${env.GEMINI_API_KEY || 'AIzaSyD-SecretKey1234'}`);
      const sanitized = (provider as any).sanitizeError(rawError);
      if (env.GEMINI_API_KEY && env.GEMINI_API_KEY.length > 5) {
        expect(sanitized).not.toContain(env.GEMINI_API_KEY);
      }
    });
  });

  // =========================================================================
  // 2. Missing Key Behavior
  // =========================================================================
  describe('Missing / Unconfigured Key Behavior', () => {
    it('returns configured=false when key is not present or invalid placeholder', () => {
      const originalKey = env.GEMINI_API_KEY;
      const originalProvider = env.AI_PROVIDER;
      try {
        (env as any).GEMINI_API_KEY = '';
        (env as any).AI_PROVIDER = 'gemini';
        const provider = new GeminiAIProvider();
        expect(provider.isConfigured()).toBe(false);
      } finally {
        (env as any).GEMINI_API_KEY = originalKey;
        (env as any).AI_PROVIDER = originalProvider;
      }
    });

    it('blocks paid AI motion reel generation if AI is not configured, while template reel works', async () => {
      const originalKey = env.GEMINI_API_KEY;
      const originalProvider = env.AI_PROVIDER;
      try {
        (env as any).GEMINI_API_KEY = '';
        (env as any).AI_PROVIDER = 'gemini';

        // 1. Paid AI motion request fails cleanly
        const aiRes = await request(app)
          .post(`/api/v1/ai/projects/${sampleProjectA._id}/generate-creatives`)
          .set('Authorization', `Bearer ${ownerTokenA}`)
          .send({ mode: 'ai_motion' });

        expect(aiRes.status).toBe(400);
        expect(aiRes.body.error.message).toContain('AI enhancement: not configured');

        // 2. Free Template reel request succeeds normally
        const templateRes = await request(app)
          .post(`/api/v1/ai/projects/${sampleProjectA._id}/generate-creatives`)
          .set('Authorization', `Bearer ${ownerTokenA}`)
          .send({ mode: 'template' });

        expect(templateRes.status).toBe(200);
        expect(templateRes.body.data.mode).toBe('template');
      } finally {
        (env as any).GEMINI_API_KEY = originalKey;
        (env as any).AI_PROVIDER = originalProvider;
      }
    });
  });

  // =========================================================================
  // 3. Cost Estimator & Credits Ledger
  // =========================================================================
  describe('Cost Estimation & Daily Cap Ledger', () => {
    it('accurately estimates cost based on verified rates: $0.060/s video and $0.030/image', async () => {
      const res = await request(app)
        .post('/api/v1/ai/estimate-cost')
        .set('Authorization', `Bearer ${ownerTokenA}`)
        .send({ clipCount: 5, secondsPerClip: 5, imageCount: 1 });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      const est = res.body.data;

      // 5 clips * 5s = 25s * $0.060 = $1.50
      expect(est.totalSeconds).toBe(25);
      expect(est.costPerSecondUsd).toBe(0.06);
      expect(est.videoCostUsd).toBeCloseTo(1.5, 2);

      // 1 image * $0.030 = $0.030
      expect(est.costPerImageUsd).toBe(0.03);
      expect(est.imageCostUsd).toBeCloseTo(0.03, 2);

      // Total = $1.53, Credits = 153
      expect(est.totalCostUsd).toBeCloseTo(1.53, 2);
      expect(est.requiredCredits).toBe(153);
      expect(est.canProceed).toBe(true);
    });

    it('enforces AI_DAILY_COST_CAP_USD and blocks requests when cap is reached', async () => {
      // Simulate existing daily usage of $24.95 against a $25.00 cap
      await UsageLedger.create({
        organizationId: orgA._id,
        creditType: 'VIDEO_REEL',
        amount: 2495,
        balanceAfter: 5,
        description: 'Simulated daily usage cap',
        aiModel: 'veo-2.0-generate-001',
        units: 24,
        estimatedCostUsd: 24.95,
        actualCostUsd: 24.95,
        status: 'DEDUCTED',
        createdAt: new Date(),
      });

      // Attempt another 5-clip reel ($1.50) -> Total $26.45 > $25.00 Cap
      const estRes = await request(app)
        .post('/api/v1/ai/estimate-cost')
        .set('Authorization', `Bearer ${ownerTokenA}`)
        .send({ clipCount: 5, secondsPerClip: 5 });

      expect(estRes.status).toBe(200);
      expect(estRes.body.data.canProceed).toBe(false);
      expect(estRes.body.data.remainingDailyCapUsd).toBeCloseTo(0.05, 2);

      // Attempting to generate should fail immediately due to cost cap without attempting ffmpeg rendering
      const genRes = await request(app)
        .post(`/api/v1/ai/projects/${sampleProjectA._id}/generate-creatives`)
        .set('Authorization', `Bearer ${ownerTokenA}`)
        .send({ mode: 'ai_motion' });

      expect(genRes.status).toBe(400);
      expect(genRes.body.error.message).toContain('Daily AI cost cap');
    });

    it('reserves credits before processing and releases credits on job failure', async () => {
      const dummyJobId = new Types.ObjectId();
      const idempotencyKey = `test-idemp-${Date.now()}`;

      // Reserve credits
      const ledgerEntry = await creativeEngineService.reserveAiCredits({
        organizationId: orgA._id,
        model: 'veo-2.0-generate-001',
        units: 25,
        amountCredits: 150,
        estimatedCostUsd: 1.5,
        description: 'AI motion reel 5 clips',
        jobId: dummyJobId.toString(),
        idempotencyKey,
      });
      expect(ledgerEntry.status).toBe('RESERVED');
      expect(ledgerEntry.estimatedCostUsd).toBe(1.5);

      // Release credits on simulated failure
      await creativeEngineService.releaseAiCredits(ledgerEntry._id as Types.ObjectId);
      const updated = await UsageLedger.findById(ledgerEntry._id);
      expect(updated?.status).toBe('RELEASED');
    });

    it('deducts credits on successful completion with idempotency', async () => {
      const dummyJobId = new Types.ObjectId();
      const idempotencyKey = `test-idemp-success-${Date.now()}`;

      const ledgerEntry = await creativeEngineService.reserveAiCredits({
        organizationId: orgA._id,
        model: 'veo-2.0-generate-001',
        units: 25,
        amountCredits: 150,
        estimatedCostUsd: 1.5,
        description: 'AI motion reel 5 clips',
        jobId: dummyJobId.toString(),
        idempotencyKey,
      });

      await creativeEngineService.confirmAiDeduction(ledgerEntry._id as Types.ObjectId, 1.5);
      const confirmed = await UsageLedger.findById(ledgerEntry._id);
      expect(confirmed?.status).toBe('DEDUCTED');
      expect(confirmed?.actualCostUsd).toBe(1.5);

      // Duplicate reservation with same idempotency key returns existing entry
      const duplicate = await creativeEngineService.reserveAiCredits({
        organizationId: orgA._id,
        model: 'veo-2.0-generate-001',
        units: 25,
        amountCredits: 150,
        estimatedCostUsd: 1.5,
        description: 'AI motion reel 5 clips',
        jobId: dummyJobId.toString(),
        idempotencyKey,
      });
      expect(duplicate._id.toString()).toBe(ledgerEntry._id.toString());
    });
  });

  // =========================================================================
  // 4. Role Restrictions & Access Control
  // =========================================================================
  describe('RBAC & Multi-tenant Cross-Organization Isolation', () => {
    it('restricts paid AI motion reel generation to org_owner and marketing_manager', async () => {
      // client_approver cannot trigger paid AI generation
      const res = await request(app)
        .post(`/api/v1/ai/projects/${sampleProjectA._id}/generate-creatives`)
        .set('Authorization', `Bearer ${approverTokenA}`)
        .send({ mode: 'ai_motion' });

      expect(res.status).toBe(403);
      expect(res.body.error.message).toContain('Insufficient permissions');
    });

    it('returns 404 when Tenant B tries to access Tenant A creative assets or jobs', async () => {
      // Create creative in Tenant A
      const creativeA = await Creative.create({
        organizationId: orgA._id,
        projectId: sampleProjectA._id,
        name: 'Skyline AI Motion Reel',
        type: 'REEL',
        format: '9:16',
        status: 'GENERATED',
        approvalStatus: 'PENDING_APPROVAL',
        headline: 'Exclusive Luxury Residences',
        caption: 'Luxury living on Kanakapura Road',
        subheadline: 'Kanakapura Road',
        renderedAssetUrl: '/storage/creatives/tenantA-reel.mp4',
        generatedBy: 'ai',
        cost: 1.5,
        metadata: {
          isIllustrative: true,
          label: 'AI-animated · Illustrative',
        },
      });

      // Tenant B requests Tenant A's creative
      const res = await request(app)
        .get(`/api/v1/ai/creatives/${creativeA._id}`)
        .set('Authorization', `Bearer ${ownerTokenB}`);

      expect(res.status).toBe(404);
    });
  });

  // ===================================
  // ======================================
  // 5. Submit / Poll / Download Flow & Safety / 429 Error Handling
  // =======================================
  describe('Submit, Poll, Download Flow & Resilience', () => {
    it('handles safety block responses without retry loops and marks blocked by provider', async () => {
      const provider = new GeminiAIProvider();
      vi.spyOn(provider, 'isConfigured').mockReturnValue(true);

      // Mock safety filter block in client
      const mockGenerateVideos = vi.fn().mockResolvedValue({
        name: 'operations/test-blocked-op-123',
        done: true,
        error: {
          code: 400,
          message: 'The prompt or input image was blocked by safety filters: HARM_CATEGORY_RESTRICTED',
        },
      });

      (provider as any).client = {
        models: {
          generateVideos: mockGenerateVideos,
        },
        operations: {
          getVideosOperation: vi.fn(),
        },
      };

      await expect(
        provider.imageToVideo({
          firstFrameUrl: testPhotoAsset.url,
          motionPrompt: 'Slow cinematic camera move only.',
          durationSeconds: 5,
        })
      ).rejects.toThrow(/blocked by provider/i);
    });

    it('retries with exponential backoff on 429 rate limit errors before succeeding', async () => {
      const provider = new GeminiAIProvider();
      vi.spyOn(provider, 'isConfigured').mockReturnValue(true);

      let attempts = 0;
      const mockGenerateVideos = vi.fn().mockImplementation(async () => {
        attempts++;
        if (attempts === 1) {
          const err: any = new Error('Resource has been exhausted (e.g. check quota)');
          err.status = 429;
          throw err;
        }
        return {
          name: 'operations/test-success-op-456',
          done: true,
          response: {
            generatedVideos: [
              {
                video: {
                  uri: 'https://generativelanguage.googleapis.com/v1beta/files/mock-veo-video.mp4',
                },
              },
            ],
          },
        };
      });

      // Mock download
      const tempPath = path.join(process.cwd(), 'scratch-test-video.mp4');
      await fs.writeFile(tempPath, Buffer.from('mock video binary content'));

      (provider as any).client = {
        models: {
          generateVideos: mockGenerateVideos,
        },
        operations: {
          getVideosOperation: vi.fn(),
        },
        files: {
          download: vi.fn().mockImplementation(async ({ downloadPath }) => {
            await fs.copyFile(tempPath, downloadPath);
          }),
        },
      };

      const result = await provider.imageToVideo({
        firstFrameUrl: testPhotoAsset.url,
        motionPrompt: 'Slow cinematic camera move only.',
        durationSeconds: 5,
      });

      expect(attempts).toBe(2);
      expect(result.model).toBe('veo-2.0-generate-001');
      expect(result.isIllustrative).toBe(true);
      expect(result.durationSeconds).toBe(5);

      // Clean scratch
      await fs.unlink(tempPath).catch(() => {});
    });

    it('labels all AI-enhanced photos with Illustrative and keeps original photo', async () => {
      const enhanceRes = await request(app)
        .post('/api/v1/ai/enhance-photo')
        .set('Authorization', `Bearer ${ownerTokenA}`)
        .send({
          mediaAssetId: testPhotoAsset._id.toString(),
          prompt: 'Enhance lighting balance and shadows only',
        });

      expect(enhanceRes.status).toBe(200);
      expect(enhanceRes.body.success).toBe(true);
      expect(enhanceRes.body.data.isIllustrative).toBe(true);
      expect(enhanceRes.body.data.originalUrl).toBe(testPhotoAsset.url);
      expect(enhanceRes.body.data.enhancedUrl).toBeDefined();

      // Ensure original asset still exists in DB
      const origInDb = await MediaAsset.findById(testPhotoAsset._id);
      expect(origInDb).not.toBeNull();
      expect(origInDb?.url).toBe(testPhotoAsset.url);
    });
  });
});
