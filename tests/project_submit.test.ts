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
  MediaAsset,
  AuditLog,
} from '../src/models/index.js';
import { initAllIndexes } from '../src/models/initIndexes.js';

describe('Project Submit Flow (Finish & Mark as Ready)', () => {
  let app: Express;
  let mongod: MongoMemoryServer;

  // Tenant A
  let orgA: { _id: Types.ObjectId; name: string };
  let ownerUserA: any;
  let ownerTokenA: string;
  let managerTokenA: string;
  let viewerTokenA: string;

  // Tenant B
  let orgB: { _id: Types.ObjectId; name: string };
  let ownerTokenB: string;

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
    await AuditLog.deleteMany({});

    const passwordHash = await bcrypt.hash('Password123!', 10);

    // 1. Tenant A Setup
    orgA = (await Organization.create({
      name: 'Oberoi Realty Org',
      slug: 'oberoi-realty-test',
    })) as unknown as { _id: Types.ObjectId; name: string };

    ownerUserA = await User.create({
      email: 'owner@oberoi.in',
      passwordHash,
      fullName: 'Vikas Oberoi',
    });
    await Membership.create({
      organizationId: orgA._id,
      userId: ownerUserA._id,
      role: 'org_owner',
      status: 'ACTIVE',
    });

    const managerUserA = await User.create({
      email: 'manager@oberoi.in',
      passwordHash,
      fullName: 'Karan Manager',
    });
    await Membership.create({
      organizationId: orgA._id,
      userId: managerUserA._id,
      role: 'marketing_manager',
      status: 'ACTIVE',
    });

    const viewerUserA = await User.create({
      email: 'viewer@oberoi.in',
      passwordHash,
      fullName: 'Aman Viewer',
    });
    await Membership.create({
      organizationId: orgA._id,
      userId: viewerUserA._id,
      role: 'sales_agent',
      status: 'ACTIVE',
    });

    // 2. Tenant B Setup
    orgB = (await Organization.create({
      name: 'DLF Competitor Org',
      slug: 'dlf-competitor-test',
    })) as unknown as { _id: Types.ObjectId; name: string };

    const ownerUserB = await User.create({
      email: 'owner@dlf.in',
      passwordHash,
      fullName: 'Kushal DLF',
    });
    await Membership.create({
      organizationId: orgB._id,
      userId: ownerUserB._id,
      role: 'org_owner',
      status: 'ACTIVE',
    });

    // Login tokens
    const resOwnerA = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'owner@oberoi.in', password: 'Password123!' });
    ownerTokenA = resOwnerA.body.data.accessToken;

    const resManagerA = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'manager@oberoi.in', password: 'Password123!' });
    managerTokenA = resManagerA.body.data.accessToken;

    const resViewerA = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'viewer@oberoi.in', password: 'Password123!' });
    viewerTokenA = resViewerA.body.data.accessToken;

    const resOwnerB = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'owner@dlf.in', password: 'Password123!' });
    ownerTokenB = resOwnerB.body.data.accessToken;
  });

  it('1. Rejects unauthenticated requests with 401', async () => {
    const fakeId = new Types.ObjectId().toString();
    const res = await request(app).post(`/api/v1/projects/${fakeId}/submit`).send();
    expect(res.status).toBe(401);
  });

  it('2. Rejects unauthorized roles (sales_agent) with 403', async () => {
    const project = await Project.create({
      organizationId: orgA._id,
      name: 'Sky City Towers',
      slug: 'sky-city-towers',
      category: 'RESIDENTIAL',
      subtype: 'High-Rise',
      status: 'DRAFT',
      location: { address: 'Borivali East', city: 'Mumbai', pincode: '400066', state: 'Maharashtra' },
      priceRange: { display: '₹ 2.5 Cr' },
    });

    const res = await request(app)
      .post(`/api/v1/projects/${project._id}/submit`)
      .set('Authorization', `Bearer ${viewerTokenA}`)
      .set('x-organization-id', orgA._id.toString())
      .send();

    expect(res.status).toBe(403);
  });

  it('3. Fails validation with 400 when basic info or specifications are missing', async () => {
    // Incomplete project (address too short, city too short, priceDisplay empty, no contact phone)
    const incompleteProject = await Project.create({
      organizationId: orgA._id,
      name: 'Sky City Incomplete',
      slug: 'sky-city-incomplete',
      category: 'RESIDENTIAL',
      subtype: 'Apartment',
      status: 'DRAFT',
      location: { address: 'A', city: 'M', pincode: '1', state: 'Maharashtra' },
      priceRange: { min: 0, max: 0, display: ' ' },
    });

    const res = await request(app)
      .post(`/api/v1/projects/${incompleteProject._id}/submit`)
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .set('x-organization-id', orgA._id.toString())
      .send();

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(Array.isArray(res.body.error.details)).toBe(true);

    const fields = res.body.error.details.map((d: any) => d.field);
    expect(fields).toContain('address');
    expect(fields).toContain('city');
    expect(fields).toContain('priceDisplay');
    expect(fields).toContain('coverImage');
  });

  it('4. Rejects plots specifying BHK or floor with 400 VALIDATION_ERROR', async () => {
    const plotProject = await Project.create({
      organizationId: orgA._id,
      name: 'Palm Meadows Plots',
      slug: 'palm-meadows-plots',
      category: 'RESIDENTIAL',
      subtype: 'Residential Plot',
      status: 'DRAFT',
      location: { address: 'Sohna Road', city: 'Gurugram', pincode: '122103', state: 'Haryana' },
      priceRange: { min: 10000000, max: 20000000, display: '₹ 1 Cr - ₹ 2 Cr' },
      ownerContacts: [{ name: 'Sales', phone: '+91 98765 43210', role: 'Sales' }],
      details: { bhk: '3 BHK', floor: '4th Floor' }, // Plot should not have BHK or floor
    });

    const res = await request(app)
      .post(`/api/v1/projects/${plotProject._id}/submit`)
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .set('x-organization-id', orgA._id.toString())
      .send();

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    const details = res.body.error.details;
    expect(details.some((d: any) => d.section === 2 && d.field === 'subtype')).toBe(true);
  });

  it('5. Rejects media rules: missing cover image, missing category, unconfirmed rights, or processing failed', async () => {
    const project = await Project.create({
      organizationId: orgA._id,
      name: 'Oberoi Sky City Phase 1',
      slug: 'oberoi-sky-city-phase-1',
      category: 'RESIDENTIAL',
      subtype: 'Apartment',
      status: 'DRAFT',
      location: { address: 'Western Express Highway', city: 'Mumbai', pincode: '400066', state: 'Maharashtra' },
      priceRange: { min: 25000000, max: 45000000, display: '₹ 2.5 Cr - ₹ 4.5 Cr' },
      ownerContacts: [{ name: 'Sales', phone: '+91 98765 43210', role: 'Sales' }],
      details: { bhk: '3 BHK', areaSqFt: '1850' },
      amenities: ['Clubhouse', 'Swimming Pool'],
    });

    // Asset with no approved cover, missing category, missing rights consent
    const uncatAsset = await MediaAsset.create({
      organizationId: orgA._id,
      projectId: project._id,
      filename: 'sample_photo.jpg',
      storageKey: 'sample_photo.jpg',
      url: 'https://storage.local/sample_photo.jpg',
      mimetype: 'image/jpeg',
      sizeBytes: 1024,
      aspectRatio: '16:9',
      tags: [],
      isCover: false,
      isApproved: false,
      approvalStatus: 'PENDING',
      processingStatus: 'processing', // in progress
      rightsConsent: { confirmed: false },
    });
    // Unset category to test missing category validation
    await MediaAsset.collection.updateOne({ _id: uncatAsset._id }, { $unset: { category: '' } });

    const res = await request(app)
      .post(`/api/v1/projects/${project._id}/submit`)
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .set('x-organization-id', orgA._id.toString())
      .send();

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    const fields = res.body.error.details.map((d: any) => d.field);
    expect(fields).toContain('coverImage');
    expect(fields).toContain('category');
    expect(fields).toContain('rightsConsent');
    expect(fields).toContain('processingStatus');
  });

  it('6. Successfully validates, marks ready, increments version, logs history and audit', async () => {
    const project = await Project.create({
      organizationId: orgA._id,
      name: 'Oberoi Sky Heights',
      slug: 'oberoi-sky-heights',
      category: 'RESIDENTIAL',
      subtype: 'Apartment',
      status: 'DRAFT',
      version: 1,
      location: { address: 'Worli Sea Face', city: 'Mumbai', pincode: '400018', state: 'Maharashtra' },
      priceRange: { min: 40000000, max: 80000000, display: '₹ 4 Cr - ₹ 8 Cr' },
      ownerContacts: [{ name: 'Sales Head', phone: '+91 98765 43210', role: 'Sales Desk' }],
      details: { bhk: '4 BHK', areaSqFt: '2800' },
      amenities: ['Clubhouse', 'Olympic Pool', 'Private Theater'],
    });

    // Add approved cover image and regular gallery image
    await MediaAsset.create([
      {
        organizationId: orgA._id,
        projectId: project._id,
        filename: 'sky_heights_facade.jpg',
        storageKey: 'sky_heights_facade.jpg',
        url: 'https://storage.local/sky_heights_facade.jpg',
        mimetype: 'image/jpeg',
        sizeBytes: 2048,
        aspectRatio: '16:9',
        tags: ['facade'],
        category: 'EXTERIOR',
        isCover: true,
        isApproved: true,
        approvalStatus: 'APPROVED',
        processingStatus: 'ready',
        rightsConsent: { confirmed: true, by: ownerUserA._id, at: new Date() },
      },
      {
        organizationId: orgA._id,
        projectId: project._id,
        filename: 'living_room.jpg',
        storageKey: 'living_room.jpg',
        url: 'https://storage.local/living_room.jpg',
        mimetype: 'image/jpeg',
        sizeBytes: 1536,
        aspectRatio: '16:9',
        tags: ['interior'],
        category: 'INTERIOR',
        isCover: false,
        isApproved: true,
        approvalStatus: 'APPROVED',
        processingStatus: 'ready',
        rightsConsent: { confirmed: true, by: ownerUserA._id, at: new Date() },
      },
    ]);

    const res = await request(app)
      .post(`/api/v1/projects/${project._id}/submit`)
      .set('Authorization', `Bearer ${managerTokenA}`)
      .set('x-organization-id', orgA._id.toString())
      .send({ version: 1 });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('ready');

    // Verify DB update
    const updatedDb = await Project.findById(project._id);
    expect(updatedDb).not.toBeNull();
    expect(updatedDb!.status).toBe('ready');
    expect(updatedDb!.version).toBe(2);
    expect(updatedDb!.submittedAt).toBeDefined();
    expect(updatedDb!.submittedBy).toBeDefined();

    // Verify changeHistory
    expect(updatedDb!.changeHistory.length).toBeGreaterThan(0);
    const historyEntry = updatedDb!.changeHistory[updatedDb!.changeHistory.length - 1];
    expect(historyEntry.action).toBe('SUBMIT_READY');
    expect(historyEntry.toStatus).toBe('ready');

    // Verify AuditLog
    const audit = await AuditLog.findOne({
      organizationId: orgA._id,
      resourceId: project._id.toString(),
      action: 'PROJECT_SUBMITTED',
    });
    expect(audit).not.toBeNull();
    expect(audit!.details.newStatus).toBe('ready');
  });

  it('7. Enforces optimistic concurrency (409 Conflict) on version mismatch', async () => {
    const project = await Project.create({
      organizationId: orgA._id,
      name: 'Oberoi Concurrency Test',
      slug: 'oberoi-concurrency-test',
      category: 'COMMERCIAL',
      subtype: 'Office Complex',
      status: 'DRAFT',
      version: 3, // Current DB version is 3
      location: { address: 'BKC Plot C-12', city: 'Mumbai', pincode: '400051', state: 'Maharashtra' },
      priceRange: { min: 50000000, max: 100000000, display: '₹ 5 Cr - ₹ 10 Cr' },
      ownerContacts: [{ name: 'Commercial Sales', phone: '+91 98765 43210', role: 'Desk' }],
      details: { usableAreaSqFt: '5000' },
      amenities: ['24/7 Security'],
    });

    await MediaAsset.create({
      organizationId: orgA._id,
      projectId: project._id,
      filename: 'office_exterior.jpg',
      storageKey: 'office_exterior.jpg',
      url: 'https://storage.local/office_exterior.jpg',
      mimetype: 'image/jpeg',
      sizeBytes: 2048,
      aspectRatio: '16:9',
      tags: [],
      category: 'EXTERIOR',
      isCover: true,
      isApproved: true,
      approvalStatus: 'APPROVED',
      processingStatus: 'ready',
      rightsConsent: { confirmed: true },
    });

    // Client sends stale version: 1
    const res = await request(app)
      .post(`/api/v1/projects/${project._id}/submit`)
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .set('x-organization-id', orgA._id.toString())
      .send({ version: 1 });

    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('VERSION_CONFLICT');
  });

  it('8. Idempotently returns 200 without duplicate changeHistory if already ready', async () => {
    const project = await Project.create({
      organizationId: orgA._id,
      name: 'Oberoi Idempotent Project',
      slug: 'oberoi-idempotent-project',
      category: 'RESIDENTIAL',
      subtype: 'Apartment',
      status: 'ready',
      version: 2,
      submittedAt: new Date(),
      location: { address: 'BKC', city: 'Mumbai', pincode: '400051', state: 'Maharashtra' },
      priceRange: { min: 20000000, max: 40000000, display: '₹ 2 Cr - ₹ 4 Cr' },
      ownerContacts: [{ name: 'Sales', phone: '+91 98765 43210', role: 'Sales' }],
      changeHistory: [
        {
          version: 1,
          action: 'SUBMIT_READY',
          fromStatus: 'DRAFT',
          toStatus: 'ready',
          timestamp: new Date(),
        },
      ],
    });

    const res = await request(app)
      .post(`/api/v1/projects/${project._id}/submit`)
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .set('x-organization-id', orgA._id.toString())
      .send();

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('ready');

    const updated = await Project.findById(project._id);
    expect(updated!.changeHistory.length).toBe(1); // No duplicate entry added
  });

  it('9. Enforces tenant isolation: Organization B cannot submit Organization A project', async () => {
    const projectA = await Project.create({
      organizationId: orgA._id,
      name: 'Org A Exclusive Project',
      slug: 'org-a-exclusive-project',
      category: 'RESIDENTIAL',
      subtype: 'Apartment',
      status: 'DRAFT',
      location: { address: 'Nariman Point', city: 'Mumbai', pincode: '400021', state: 'Maharashtra' },
      priceRange: { min: 50000000, max: 90000000, display: '₹ 5 Cr - ₹ 9 Cr' },
      ownerContacts: [{ name: 'Sales', phone: '+91 98765 43210', role: 'Sales' }],
    });

    const res = await request(app)
      .post(`/api/v1/projects/${projectA._id}/submit`)
      .set('Authorization', `Bearer ${ownerTokenB}`)
      .set('x-organization-id', orgB._id.toString())
      .send();

    expect(res.status).toBe(404);
  });
});
