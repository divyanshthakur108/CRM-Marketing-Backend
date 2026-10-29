import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { Express } from 'express';
import mongoose, { Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { createApp } from '../src/app.js';
import {
  Organization,
  User,
  Membership,
  Project,
  MediaAsset,
  Creative,
} from '../src/models/index.js';
import { initAllIndexes } from '../src/models/initIndexes.js';

describe('Media Module Specification & Feature Compliance Tests', () => {
  let app: Express;
  let mongod: MongoMemoryServer;

  let orgA: { _id: Types.ObjectId; name: string };
  let orgB: { _id: Types.ObjectId; name: string };
  let ownerTokenA: string;
  let ownerTokenB: string;
  let testProjectA: any;

  // Real PNG header: 89 50 4E 47 0D 0A 1A 0A
  const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  // Real MP4 ftyp header: 00 00 00 20 66 74 79 70 69 73 6f 6d
  const MP4_MAGIC = Buffer.from([0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);

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

    const passwordHash = await bcrypt.hash('Password123!', 10);

    // Tenant A
    orgA = (await Organization.create({
      name: 'Godrej Properties',
      slug: 'godrej-properties',
    })) as unknown as { _id: Types.ObjectId; name: string };

    const userA = await User.create({
      email: 'owner@godrej.in',
      fullName: 'Anand Godrej',
      passwordHash,
    });

    await Membership.create({
      organizationId: orgA._id,
      userId: userA._id,
      role: 'org_owner',
      status: 'ACTIVE',
    });

    // Tenant B
    orgB = (await Organization.create({
      name: 'Oberoi Realty',
      slug: 'oberoi-realty',
    })) as unknown as { _id: Types.ObjectId; name: string };

    const userB = await User.create({
      email: 'owner@oberoi.in',
      fullName: 'Vikas Oberoi',
      passwordHash,
    });

    await Membership.create({
      organizationId: orgB._id,
      userId: userB._id,
      role: 'org_owner',
      status: 'ACTIVE',
    });

    // Obtain JWT tokens
    const resA = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'owner@godrej.in', password: 'Password123!' });
    ownerTokenA = resA.body.data.accessToken;

    const resB = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'owner@oberoi.in', password: 'Password123!' });
    ownerTokenB = resB.body.data.accessToken;

    testProjectA = await Project.create({
      organizationId: orgA._id,
      name: 'Godrej Woods',
      slug: 'godrej-woods',
      category: 'RESIDENTIAL',
      subtype: 'Apartment',
      status: 'DRAFT',
      reraNumber: 'UPRERAPRJ704730',
      location: {
        address: 'Sector 43',
        city: 'Noida',
        microMarket: 'Central Noida',
        state: 'Uttar Pradesh',
        pincode: '201301',
      },
      priceRange: { min: 20000000, max: 50000000, display: '₹2 Cr - ₹5 Cr' },
      amenities: ['Clubhouse', 'Swimming Pool'],
    });
  });

  // 1. WRONG TYPE & SIZE REJECTION
  describe('1. Validation & Security Gates: Wrong Type, Oversized & Spoofed Extensions', () => {
    it('rejects unpermitted file extensions and Windows executables with 400', async () => {
      // Windows PE executable magic bytes: 'MZ' (0x4D, 0x5A)
      const exeBuffer = Buffer.concat([Buffer.from([0x4d, 0x5a, 0x90, 0x00]), crypto.randomBytes(64)]);

      const res = await request(app)
        .post('/api/v1/media')
        .set('Authorization', `Bearer ${ownerTokenA}`)
        .set('x-organization-id', orgA._id.toString())
        .attach('file', exeBuffer, {
          filename: 'setup.exe',
          contentType: 'application/x-msdownload',
        })
        .field('projectId', testProjectA._id.toString())
        .field('category', 'EXTERIOR');

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toMatch(/executable|disallowed|Invalid file type/i);
    });

    it('rejects spoofed extension (text file disguised as .png) with 400', async () => {
      // File has .png extension and image/png content-type, but contains plain text without PNG magic bytes
      const spoofedBuffer = Buffer.from('This is pure ASCII text pretending to be an image.');

      const res = await request(app)
        .post('/api/v1/media')
        .set('Authorization', `Bearer ${ownerTokenA}`)
        .set('x-organization-id', orgA._id.toString())
        .attach('file', spoofedBuffer, {
          filename: 'elevation.png',
          contentType: 'image/png',
        })
        .field('projectId', testProjectA._id.toString())
        .field('category', 'EXTERIOR');

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toMatch(/signature|MIME type|extension/i);
    });

    it('rejects SVG files containing active script injections with 400', async () => {
      const maliciousSvg = Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg"><script>alert("XSS")</script><circle cx="50" cy="50" r="40"/></svg>'
      );

      const res = await request(app)
        .post('/api/v1/media')
        .set('Authorization', `Bearer ${ownerTokenA}`)
        .set('x-organization-id', orgA._id.toString())
        .attach('file', maliciousSvg, {
          filename: 'floorplan_vector.svg',
          contentType: 'image/svg+xml',
        })
        .field('projectId', testProjectA._id.toString())
        .field('category', 'FLOOR_PLANS');

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toMatch(/scripting|disallowed|invalid file type/i);
    });
  });

  // 2. CROSS-ORGANIZATION TENANT ISOLATION
  describe('2. Cross-Organization Tenant Isolation', () => {
    it('returns 404 when Org B attempts to access Org A media files or metadata', async () => {
      // 1. Upload valid image under Org A
      const validPng = Buffer.concat([PNG_MAGIC, crypto.randomBytes(512)]);
      const uploadRes = await request(app)
        .post('/api/v1/media')
        .set('Authorization', `Bearer ${ownerTokenA}`)
        .set('x-organization-id', orgA._id.toString())
        .attach('file', validPng, {
          filename: 'confidential_elevation.png',
          contentType: 'image/png',
        })
        .field('projectId', testProjectA._id.toString())
        .field('category', 'EXTERIOR')
        .field('rightsConsent', 'true');

      expect(uploadRes.status).toBe(201);
      const mediaId = uploadRes.body.data.id || uploadRes.body.data._id;
      expect(mediaId).toBeDefined();

      // 2. Org B attempts to get asset metadata -> 404
      const metaRes = await request(app)
        .get(`/api/v1/media/${mediaId}`)
        .set('Authorization', `Bearer ${ownerTokenB}`)
        .set('x-organization-id', orgB._id.toString());

      expect(metaRes.status).toBe(404);

      // 3. Org B attempts to stream the raw file -> 404
      const fileRes = await request(app)
        .get(`/api/v1/media/${mediaId}/file`)
        .set('Authorization', `Bearer ${ownerTokenB}`)
        .set('x-organization-id', orgB._id.toString());

      expect(fileRes.status).toBe(404);

      // 4. Org B attempts to stream thumbnail -> 404
      const thumbRes = await request(app)
        .get(`/api/v1/media/${mediaId}/thumbnail`)
        .set('Authorization', `Bearer ${ownerTokenB}`)
        .set('x-organization-id', orgB._id.toString());

      expect(thumbRes.status).toBe(404);

      // 5. Org B attempts to delete Org A's asset -> 404
      const deleteRes = await request(app)
        .delete(`/api/v1/media/${mediaId}`)
        .set('Authorization', `Bearer ${ownerTokenB}`)
        .set('x-organization-id', orgB._id.toString());

      expect(deleteRes.status).toBe(404);
    });
  });

  // 3. SOFT CHECK USAGE & 409 CONFLICT HANDLING
  describe('3. Delete Asset Usage Checks (409 Conflict & Force Removal)', () => {
    it('blocks deleting an asset referenced by a Creative with 409, and deletes with force=true', async () => {
      // 1. Upload asset under Org A
      const validPng = Buffer.concat([PNG_MAGIC, crypto.randomBytes(512)]);
      const uploadRes = await request(app)
        .post('/api/v1/media')
        .set('Authorization', `Bearer ${ownerTokenA}`)
        .set('x-organization-id', orgA._id.toString())
        .attach('file', validPng, {
          filename: 'hero_facade.png',
          contentType: 'image/png',
        })
        .field('projectId', testProjectA._id.toString())
        .field('category', 'EXTERIOR')
        .field('rightsConsent', 'true');

      expect(uploadRes.status).toBe(201);
      const asset = uploadRes.body.data;
      const mediaId = asset.id || asset._id;

      // 2. Reference asset in an active Creative
      const creative = await Creative.create({
        organizationId: orgA._id,
        projectId: testProjectA._id,
        format: '1:1',
        headline: 'Godrej Woods Luxury Reveal',
        caption: 'Experience forest living in the heart of Sector 43 Noida',
        callToAction: 'Book Site Visit',
        renderedAssetUrl: asset.url,
        approvalStatus: 'APPROVED',
        complianceScore: 100,
        version: 1,
      });

      // 3. Attempt to delete asset without force -> 409 Conflict
      const deleteRes = await request(app)
        .delete(`/api/v1/media/${mediaId}`)
        .set('Authorization', `Bearer ${ownerTokenA}`)
        .set('x-organization-id', orgA._id.toString());

      expect(deleteRes.status).toBe(409);
      expect(deleteRes.body.success).toBe(false);
      expect(deleteRes.body.inUse).toBeDefined();
      expect(deleteRes.body.inUse.creatives.length).toBeGreaterThan(0);
      expect(deleteRes.body.inUse.creatives[0].id).toBe(creative._id.toString());

      // 4. Force delete with ?force=true -> 200 Success
      const forceDeleteRes = await request(app)
        .delete(`/api/v1/media/${mediaId}?force=true`)
        .set('Authorization', `Bearer ${ownerTokenA}`)
        .set('x-organization-id', orgA._id.toString());

      expect(forceDeleteRes.status).toBe(200);
      expect(forceDeleteRes.body.success).toBe(true);

      // Verify asset record is gone
      const checkAsset = await MediaAsset.findById(mediaId);
      expect(checkAsset).toBeNull();

      // Verify Creative renderedAssetUrl unlinked
      const updatedCreative = await Creative.findById(creative._id);
      expect(updatedCreative?.renderedAssetUrl).toBeUndefined();
    });
  });

  // 4. HTTP RANGE REQUEST STREAMING
  describe('4. Video Streaming with HTTP Range Support (206 Partial Content)', () => {
    it('supports HTTP 206 Partial Content range requests for video streaming', async () => {
      // 1. Create a 4096-byte MP4 video payload
      const videoPayload = Buffer.concat([MP4_MAGIC, crypto.randomBytes(4096 - MP4_MAGIC.length)]);

      const uploadRes = await request(app)
        .post('/api/v1/media')
        .set('Authorization', `Bearer ${ownerTokenA}`)
        .set('x-organization-id', orgA._id.toString())
        .attach('file', videoPayload, {
          filename: 'walkthrough.mp4',
          contentType: 'video/mp4',
        })
        .field('projectId', testProjectA._id.toString())
        .field('category', 'VIDEOS')
        .field('rightsConsent', 'true');

      expect(uploadRes.status).toBe(201);
      const mediaId = uploadRes.body.data.id || uploadRes.body.data._id;

      // 2. Send Range header: bytes=0-1023 (first 1024 bytes)
      const rangeRes = await request(app)
        .get(`/api/v1/media/${mediaId}/file`)
        .set('Authorization', `Bearer ${ownerTokenA}`)
        .set('x-organization-id', orgA._id.toString())
        .set('Range', 'bytes=0-1023');

      expect(rangeRes.status).toBe(206);
      expect(rangeRes.headers['accept-ranges']).toBe('bytes');
      expect(rangeRes.headers['content-range']).toBe(`bytes 0-1023/${videoPayload.length}`);
      expect(rangeRes.headers['content-length']).toBe('1024');
      expect(rangeRes.headers['content-type']).toBe('video/mp4');

      // Check returned bytes match exact slice
      const expectedSlice = videoPayload.subarray(0, 1024);
      expect(Buffer.compare(rangeRes.body, expectedSlice)).toBe(0);
    });
  });

  // 5. DATA INTEGRITY: IDENTICAL BYTES ROUNDTRIP
  describe('5. Storage & Retrieval Byte-for-Byte Fidelity', () => {
    it('uploaded file can be read back with 100% identical bytes', async () => {
      // Generate 16KB of distinct random bytes prefixed with PNG header
      const originalBytes = Buffer.concat([PNG_MAGIC, crypto.randomBytes(16384)]);

      const uploadRes = await request(app)
        .post('/api/v1/media')
        .set('Authorization', `Bearer ${ownerTokenA}`)
        .set('x-organization-id', orgA._id.toString())
        .attach('file', originalBytes, {
          filename: 'master_elevation.png',
          contentType: 'image/png',
        })
        .field('projectId', testProjectA._id.toString())
        .field('category', 'EXTERIOR')
        .field('actualOrIllustrative', 'ACTUAL')
        .field('rightsConsent', 'true');

      expect(uploadRes.status).toBe(201);
      const mediaId = uploadRes.body.data.id || uploadRes.body.data._id;

      // Download file via GET /:id/file
      const downloadRes = await request(app)
        .get(`/api/v1/media/${mediaId}/file`)
        .set('Authorization', `Bearer ${ownerTokenA}`)
        .set('x-organization-id', orgA._id.toString());

      expect(downloadRes.status).toBe(200);
      expect(downloadRes.headers['content-type']).toBe('image/png');
      expect(downloadRes.body.length).toBe(originalBytes.length);
      expect(Buffer.compare(downloadRes.body, originalBytes)).toBe(0);
    });
  });
});
