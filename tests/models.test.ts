import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import bcrypt from 'bcryptjs';
import {
  Organization,
  User,
  Membership,
  Project,
  PropertyUnit,
  Budget,
  Lead,
  Job,
  RefreshToken,
  Invitation,
} from '../src/models/index.js';
import { initAllIndexes } from '../src/models/initIndexes.js';
import {
  tenantFilter,
  assertTenantResource,
  tenantPayload,
} from '../src/utils/tenantQuery.js';
import { LocalDiskStorageAdapter } from '../src/storage/localStorage.adapter.js';
import path from 'path';
import fs from 'fs/promises';

describe('Phase 7: MongoDB Models, Unique Constraints, and Tenant Scoping', () => {
  let mongod: MongoMemoryServer;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    const uri = mongod.getUri();
    await mongoose.connect(uri);
    await initAllIndexes();
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongod.stop();
  });

  beforeEach(async () => {
    // Clear collections between tests
    const collections = mongoose.connection.collections;
    for (const key in collections) {
      await collections[key].deleteMany({});
    }
  });

  describe('1. Organization & User Unique Constraints', () => {
    it('creates an organization and enforces unique slug index', async () => {
      await Organization.create({
        name: 'Apex Luxury Towers',
        slug: 'apex-luxury',
      });

      // Attempting to create duplicate slug should throw E11000
      await expect(
        Organization.create({
          name: 'Apex Second Entity',
          slug: 'apex-luxury',
        })
      ).rejects.toThrow(/E11000/);
    });

    it('enforces unique email index and verifies password comparison on User', async () => {
      const hash = await bcrypt.hash('SecretPass123!', 10);
      const user = await User.create({
        email: 'founder@realcrm.io',
        passwordHash: hash,
        fullName: 'Vikram Singhania',
      });

      expect(user._id).toBeDefined();

      // Password comparison check
      const isMatch = await user.comparePassword('SecretPass123!');
      expect(isMatch).toBe(true);

      const isWrong = await user.comparePassword('WrongPassword');
      expect(isWrong).toBe(false);

      // Attempting duplicate email should throw E11000
      await expect(
        User.create({
          email: 'founder@realcrm.io',
          passwordHash: 'another_hash',
          fullName: 'Duplicate Founder',
        })
      ).rejects.toThrow(/E11000/);
    });

    it('enforces unique compound index on Membership { organizationId, userId }', async () => {
      const orgId = new mongoose.Types.ObjectId();
      const userId = new mongoose.Types.ObjectId();

      await Membership.create({
        organizationId: orgId,
        userId,
        role: 'OWNER',
      });

      // Attempt duplicate membership for same user in same org
      await expect(
        Membership.create({
          organizationId: orgId,
          userId,
          role: 'MARKETING_MANAGER',
        })
      ).rejects.toThrow(/E11000/);
    });
  });

  describe('2. Mandatory Tenant Scoping & Compound Indexes', () => {
    it('fails validation when creating Project without organizationId', async () => {
      const invalidProject = new Project({
        name: 'Unscoped Villa Project',
        slug: 'unscoped-villa',
        category: 'RESIDENTIAL',
        subtype: 'Villa',
        reraNumber: 'RERA-1234',
        location: {
          address: 'Road 1',
          city: 'Mumbai',
          microMarket: 'Bandra',
          state: 'MH',
          pincode: '400050',
        },
        priceRange: { min: 10, max: 20, display: '₹10-20 Cr' },
      });

      await expect(invalidProject.save()).rejects.toThrow(/organizationId/);
    });

    it('enforces unique project slug per organization', async () => {
      const orgId = new mongoose.Types.ObjectId();

      const projectData = {
        organizationId: orgId,
        name: 'The Palm Residences',
        slug: 'the-palm',
        category: 'RESIDENTIAL' as const,
        subtype: 'Apartment',
        reraNumber: 'RERA-MAH-001',
        location: {
          address: 'Sea Face',
          city: 'Mumbai',
          microMarket: 'Worli',
          state: 'MH',
          pincode: '400018',
        },
        priceRange: { min: 100, max: 200, display: '₹10-20 Cr' },
      };

      await Project.create(projectData);

      // Duplicate slug within same organization -> Fail
      await expect(Project.create(projectData)).rejects.toThrow(/E11000/);

      // Same slug in a DIFFERENT organization -> Allowed
      const differentOrgId = new mongoose.Types.ObjectId();
      const projectOrg2 = await Project.create({
        ...projectData,
        organizationId: differentOrgId,
      });

      expect(projectOrg2._id).toBeDefined();
    });

    it('enforces unique PropertyUnit per project and organization', async () => {
      const orgId = new mongoose.Types.ObjectId();
      const projId = new mongoose.Types.ObjectId();

      const unitPayload = {
        organizationId: orgId,
        projectId: projId,
        unitNumber: '101',
        unitType: '3 BHK',
        carpetAreaSqFt: 1500,
        price: 50000000,
      };

      await PropertyUnit.create(unitPayload);

      // Duplicate unit number within same project
      await expect(PropertyUnit.create(unitPayload)).rejects.toThrow(/E11000/);
    });

    it('enforces unique Budget per org, month, and year', async () => {
      const orgId = new mongoose.Types.ObjectId();

      await Budget.create({
        organizationId: orgId,
        month: 11,
        year: 2026,
        overallCap: 1000000,
        projectAllocations: [],
      });

      // Duplicate budget for same month/year in same org
      await expect(
        Budget.create({
          organizationId: orgId,
          month: 11,
          year: 2026,
          overallCap: 2000000,
          projectAllocations: [],
        })
      ).rejects.toThrow(/E11000/);
    });

    it('enforces unique Lead dedupeKey per organization', async () => {
      const orgId = new mongoose.Types.ObjectId();

      await Lead.create({
        organizationId: orgId,
        dedupeKey: '+919820011223',
        name: 'Kabir Singhania',
        phone: '+91 98200 11223',
      });

      // Duplicate dedupeKey in same org
      await expect(
        Lead.create({
          organizationId: orgId,
          dedupeKey: '+919820011223',
          name: 'Kabir Duplicate',
          phone: '+91 98200 11223',
        })
      ).rejects.toThrow(/E11000/);

      // Same dedupeKey in another org is allowed
      const anotherOrg = new mongoose.Types.ObjectId();
      const leadOrg2 = await Lead.create({
        organizationId: anotherOrg,
        dedupeKey: '+919820011223',
        name: 'Kabir Other Org',
        phone: '+91 98200 11223',
      });

      expect(leadOrg2._id).toBeDefined();
    });

    it('enforces unique Job idempotencyKey per organization', async () => {
      const orgId = new mongoose.Types.ObjectId();

      await Job.create({
        organizationId: orgId,
        idempotencyKey: 'render-poster-101',
        queueName: 'media-queue',
        jobType: 'RENDER_IMAGE',
      });

      // Duplicate idempotencyKey in same org
      await expect(
        Job.create({
          organizationId: orgId,
          idempotencyKey: 'render-poster-101',
          queueName: 'media-queue',
          jobType: 'RENDER_IMAGE',
        })
      ).rejects.toThrow(/E11000/);
    });
  });

  describe('3. TTL Expiration Indexes', () => {
    it('verifies TTL index on RefreshToken expiresAt', () => {
      const indexes = RefreshToken.schema.indexes();
      const ttlIndex = indexes.find(
        ([idx, opts]) => idx.expiresAt === 1 && opts?.expireAfterSeconds === 0
      );
      expect(ttlIndex).toBeDefined();
    });

    it('verifies TTL index on Invitation expiresAt', () => {
      const indexes = Invitation.schema.indexes();
      const ttlIndex = indexes.find(
        ([idx, opts]) => idx.expiresAt === 1 && opts?.expireAfterSeconds === 0
      );
      expect(ttlIndex).toBeDefined();
    });
  });

  describe('4. Tenant Query Helpers & Security Assertions', () => {
    it('injects organizationId into query filter and throws if missing', () => {
      const orgId = 'org-apex-01';
      const scoped = tenantFilter(orgId, { status: 'ACTIVE' });
      expect(scoped).toEqual({ status: 'ACTIVE', organizationId: 'org-apex-01' });

      // Missing orgId should throw forbidden AppError
      expect(() => tenantFilter('', { status: 'ACTIVE' })).toThrow(/Tenant isolation violation/);
    });

    it('asserts tenant ownership and rejects cross-tenant resource access', () => {
      const validDoc = { organizationId: 'org-apex-01', name: 'Asset 1' };

      // Matching org -> success
      expect(() => assertTenantResource(validDoc, 'org-apex-01')).not.toThrow();

      // Mismatched org -> throws cross-tenant forbidden error
      expect(() => assertTenantResource(validDoc, 'org-zenith-02')).toThrow(/Cross-tenant access forbidden/);
    });

    it('tenantPayload attaches organizationId securely to creation data', () => {
      const payload = tenantPayload('org-apex-01', { name: 'New Unit' });
      expect(payload).toEqual({ name: 'New Unit', organizationId: 'org-apex-01' });
    });
  });

  describe('5. Local Disk Storage Adapter', () => {
    const testStorageDir = path.resolve(process.cwd(), 'storage-test');
    const adapter = new LocalDiskStorageAdapter(testStorageDir);

    afterAll(async () => {
      try {
        await fs.rm(testStorageDir, { recursive: true, force: true });
      } catch {
        // ignore cleanup
      }
    });

    it('uploads, verifies, reads, and deletes a file on disk', async () => {
      const sampleContent = Buffer.from('Luxury Real Estate Poster Spec Data', 'utf-8');
      const uploadRes = await adapter.upload(
        {
          buffer: sampleContent,
          filename: 'poster-sea-face.txt',
          mimetype: 'text/plain',
        },
        'posters'
      );

      expect(uploadRes.key).toContain('posters');
      expect(uploadRes.sizeBytes).toBe(sampleContent.length);

      // Verify existence
      const exists = await adapter.exists(uploadRes.key);
      expect(exists).toBe(true);

      // Read content
      const downloaded = await adapter.download(uploadRes.key);
      expect(downloaded.toString('utf-8')).toBe('Luxury Real Estate Poster Spec Data');

      // Delete file
      await adapter.delete(uploadRes.key);
      const existsAfter = await adapter.exists(uploadRes.key);
      expect(existsAfter).toBe(false);
    });
  });
});
