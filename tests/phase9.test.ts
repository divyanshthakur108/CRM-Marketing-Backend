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
  PropertyUnit,
  MediaAsset,
  BrandProfile,
  AudienceBrief,
} from '../src/models/index.js';
import { initAllIndexes } from '../src/models/initIndexes.js';

describe('Phase 9: Projects, Units, Media, Brand & Audience APIs', () => {
  let app: Express;
  let mongod: MongoMemoryServer;

  // Test Entities
  let orgA: { _id: Types.ObjectId; name: string };
  let orgB: { _id: Types.ObjectId; name: string };
  let ownerTokenA: string;
  let viewerTokenA: string;
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
    await PropertyUnit.deleteMany({});
    await MediaAsset.deleteMany({});
    await BrandProfile.deleteMany({});
    await AudienceBrief.deleteMany({});

    const passwordHash = await bcrypt.hash('Password123!', 10);

    // Setup Tenant A
    orgA = (await Organization.create({
      name: 'Apex Luxury Estates',
      slug: 'apex-luxury',
    })) as unknown as { _id: Types.ObjectId; name: string };

    const userOwnerA = await User.create({
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

    const userViewerA = await User.create({
      email: 'viewer@apex-luxury.in',
      fullName: 'Meera Kapoor',
      passwordHash,
    });

    await Membership.create({
      organizationId: orgA._id,
      userId: userViewerA._id,
      role: 'viewer',
      status: 'ACTIVE',
    });

    // Setup Tenant B
    orgB = (await Organization.create({
      name: 'Zenith Commercial',
      slug: 'zenith-commercial',
    })) as unknown as { _id: Types.ObjectId; name: string };

    const userOwnerB = await User.create({
      email: 'owner@zenith-commercial.in',
      fullName: 'Rajesh Mittal',
      passwordHash,
    });

    await Membership.create({
      organizationId: orgB._id,
      userId: userOwnerB._id,
      role: 'org_owner',
      status: 'ACTIVE',
    });

    // Logins to obtain valid JWTs
    const resA = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'owner@apex-luxury.in', password: 'Password123!' });
    ownerTokenA = resA.body.data.accessToken;

    const resViewerA = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'viewer@apex-luxury.in', password: 'Password123!' });
    viewerTokenA = resViewerA.body.data.accessToken;

    const resB = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'owner@zenith-commercial.in', password: 'Password123!' });
    ownerTokenB = resB.body.data.accessToken;
  });

  // ================= 1. PROJECTS CRUD & VALIDATION =================
  describe('1. Projects CRUD & Per-Category Validation', () => {
    it('creates a residential project with units and allows BHK/floor details', async () => {
      const res = await request(app)
        .post('/api/v1/projects')
        .set('Authorization', `Bearer ${ownerTokenA}`)
        .set('x-organization-id', orgA._id.toString())
        .send({
          name: 'The Grand Pinnacle',
          category: 'RESIDENTIAL',
          subtype: 'Apartments',
          status: 'ACTIVE',
          reraNumber: 'PRM/KA/RERA/1251/446/PR/200123/003456',
          location: {
            address: 'Golf Course Road',
            city: 'Gurugram',
            microMarket: 'DLF Phase 5',
            state: 'Haryana',
            pincode: '122002',
          },
          priceRange: {
            min: 35000000,
            max: 85000000,
            display: '₹3.5 Cr - ₹8.5 Cr',
          },
          details: {
            totalFloors: 42,
            furnishing: 'Ultra Luxury Semi-Furnished',
          },
          amenities: ['Infinity Pool', 'Helipad', 'Private Spa'],
          ownerContacts: [
            { name: 'Secret Owner', phone: '+919999988888', role: 'Promoter' },
          ],
          privateDocuments: [
            { title: 'Title Deed 2026', url: 'https://internal.vault/deed.pdf' },
          ],
          privateNotes: 'Confidential: Land acquired at 20% discount',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.name).toBe('The Grand Pinnacle');
      expect(res.body.data.slug).toBe('the-grand-pinnacle');
    });

    it('rejects BHK, floor, or furnishing details when subtype is Plots', async () => {
      const res = await request(app)
        .post('/api/v1/projects')
        .set('Authorization', `Bearer ${ownerTokenA}`)
        .set('x-organization-id', orgA._id.toString())
        .send({
          name: 'Emerald Valley Enclave',
          category: 'RESIDENTIAL',
          subtype: 'Plots',
          location: {
            address: 'Sohna Road',
            city: 'Gurugram',
            microMarket: 'South of Gurugram',
            state: 'Haryana',
            pincode: '122103',
          },
          details: {
            bhk: 3, // INVALID for plots!
            furnishing: 'Unfurnished',
          },
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(JSON.stringify(res.body.error)).toContain('Plots cannot specify BHK');
    });

    it('supports draft auto-saving via PATCH with partial fields', async () => {
      const created = await Project.create({
        organizationId: orgA._id,
        name: 'Work In Progress Tower',
        slug: 'work-in-progress-tower',
        category: 'RESIDENTIAL',
        subtype: 'Apartments',
        status: 'DRAFT',
        reraNumber: 'APPLIED-FOR',
        location: {
          address: '',
          city: 'Mumbai',
          microMarket: '',
          state: '',
          pincode: '',
        },
        priceRange: { min: 0, max: 0, display: 'TBD' },
        amenities: [],
      });

      const patchRes = await request(app)
        .patch(`/api/v1/projects/${created._id}`)
        .set('Authorization', `Bearer ${ownerTokenA}`)
        .set('x-organization-id', orgA._id.toString())
        .send({
          name: 'Imperial Reserve Heights',
          status: 'ACTIVE',
          priceRange: { min: 50000000, max: 120000000, display: '₹5.0 Cr - ₹12 Cr' },
        });

      expect(patchRes.status).toBe(200);
      expect(patchRes.body.data.name).toBe('Imperial Reserve Heights');
      expect(patchRes.body.data.slug).toBe('imperial-reserve-heights');
      expect(patchRes.body.data.status).toBe('ACTIVE');
    });

    it('sanitizes public ad projection by stripping owner contacts, private documents, and notes', async () => {
      const project = await Project.create({
        organizationId: orgA._id,
        name: 'Royal Heritage Villa',
        slug: 'royal-heritage-villa',
        category: 'RESIDENTIAL',
        subtype: 'Villas',
        status: 'ACTIVE',
        reraNumber: 'RERA-VILLA-1234',
        location: {
          address: 'Alibaug Coast',
          city: 'Alibaug',
          microMarket: 'Awas Beach',
          state: 'Maharashtra',
          pincode: '402201',
        },
        priceRange: { min: 150000000, max: 250000000, display: '₹15 Cr - ₹25 Cr' },
        amenities: ['Private Beach', 'Yacht Dock'],
        ownerContacts: [{ name: 'Secret Billionaire', phone: '+919999900000' }],
        privateDocuments: [{ title: 'Strict NDA', url: 'https://vault.com/nda.pdf' }],
        privateNotes: 'High-profile owner wants zero publicity on owner identity.',
      });

      const res = await request(app)
        .get(`/api/v1/projects/${project._id}/public-ad`)
        .set('Authorization', `Bearer ${ownerTokenA}`)
        .set('x-organization-id', orgA._id.toString());

      expect(res.status).toBe(200);
      expect(res.body.data.name).toBe('Royal Heritage Villa');
      // Must not expose private fields
      expect(res.body.data.ownerContacts).toBeUndefined();
      expect(res.body.data.privateDocuments).toBeUndefined();
      expect(res.body.data.privateNotes).toBeUndefined();
    });
  });

  // ================= 2. PROPERTY UNITS & CHANGE HISTORY =================
  describe('2. Property Units CRUD & Change History', () => {
    let testProject: any;

    beforeEach(async () => {
      testProject = await Project.create({
        organizationId: orgA._id,
        name: 'Skylark Heights',
        slug: 'skylark-heights',
        category: 'RESIDENTIAL',
        subtype: 'Apartments',
        status: 'ACTIVE',
        reraNumber: 'RERA-SKYLARK-99',
        location: { address: 'Outer Ring Rd', city: 'Bengaluru', microMarket: 'Bellandur', state: 'Karnataka', pincode: '560103' },
        priceRange: { min: 10000000, max: 20000000, display: '₹1 Cr - ₹2 Cr' },
        amenities: ['Gym'],
      });
    });

    it('creates unit and rejects floor/BHK if unitType is Plot', async () => {
      // 1. Invalid plot unit
      const badRes = await request(app)
        .post(`/api/v1/projects/${testProject._id}/units`)
        .set('Authorization', `Bearer ${ownerTokenA}`)
        .set('x-organization-id', orgA._id.toString())
        .send({
          unitNumber: 'PLOT-01',
          unitType: 'Plot',
          floor: 3, // INVALID for plot
          carpetAreaSqFt: 2400,
          price: 15000000,
        });

      expect(badRes.status).toBe(400);

      // 2. Valid residential unit
      const goodRes = await request(app)
        .post(`/api/v1/projects/${testProject._id}/units`)
        .set('Authorization', `Bearer ${ownerTokenA}`)
        .set('x-organization-id', orgA._id.toString())
        .send({
          unitNumber: 'TowerA-1402',
          unitType: '3 BHK Luxury',
          floor: 14,
          tower: 'Tower A',
          carpetAreaSqFt: 1850,
          superBuiltUpAreaSqFt: 2350,
          price: 18500000,
          priceDisplay: '₹1.85 Cr',
          status: 'AVAILABLE',
          attributes: { bhk: 3, facing: 'East' },
        });

      expect(goodRes.status).toBe(201);
      expect(goodRes.body.data.unitNumber).toBe('TowerA-1402');
    });

    it('stores price and status changes in changeHistory when patched', async () => {
      const unit = await PropertyUnit.create({
        organizationId: orgA._id,
        projectId: testProject._id,
        unitNumber: 'Penthouse-01',
        unitType: '4 BHK Penthouse',
        floor: 30,
        carpetAreaSqFt: 3500,
        price: 35000000,
        status: 'AVAILABLE',
        changeHistory: [],
      });

      // Update Price and Status
      const patchRes = await request(app)
        .patch(`/api/v1/projects/${testProject._id}/units/${unit._id}`)
        .set('Authorization', `Bearer ${ownerTokenA}`)
        .set('x-organization-id', orgA._id.toString())
        .send({
          price: 37500000,
          status: 'BLOCKED',
          changeReason: 'Client offered token advance',
        });

      expect(patchRes.status).toBe(200);
      expect(patchRes.body.data.price).toBe(37500000);
      expect(patchRes.body.data.status).toBe('BLOCKED');
      expect(patchRes.body.data.changeHistory).toHaveLength(2);

      const priceEntry = patchRes.body.data.changeHistory.find((h: any) => h.field === 'price');
      expect(priceEntry.oldValue).toBe(35000000);
      expect(priceEntry.newValue).toBe(37500000);

      const statusEntry = patchRes.body.data.changeHistory.find((h: any) => h.field === 'status');
      expect(statusEntry.oldValue).toBe('AVAILABLE');
      expect(statusEntry.newValue).toBe('BLOCKED');
    });
  });

  // ================= 3. MEDIA ASSETS & STRICT TENANT ISOLATION =================
  describe('3. Media Upload, Download & Strict Tenant Isolation', () => {
    it('uploads valid image, retrieves metadata, and rejects invalid file types', async () => {
      // 1. Upload valid image
      const imageBuffer = Buffer.from('fake-image-data-png-stream');
      const uploadRes = await request(app)
        .post('/api/v1/media')
        .set('Authorization', `Bearer ${ownerTokenA}`)
        .set('x-organization-id', orgA._id.toString())
        .attach('file', imageBuffer, {
          filename: 'exterior_elevation.png',
          contentType: 'image/png',
        })
        .field('tags', 'exterior,elevation,render')
        .field('aspectRatio', '16:9')
        .field('roomType', 'Facade');

      expect(uploadRes.status).toBe(201);
      expect(uploadRes.body.success).toBe(true);
      expect(uploadRes.body.data.filename).toBe('exterior_elevation.png');
      expect(uploadRes.body.data.aspectRatio).toBe('16:9');
      expect(uploadRes.body.data.isApproved).toBe(true);

      // 2. Reject invalid file type (e.g. text or zip or executable)
      const invalidBuffer = Buffer.from('malicious-content-or-unsupported-format');
      const badUploadRes = await request(app)
        .post('/api/v1/media')
        .set('Authorization', `Bearer ${ownerTokenA}`)
        .set('x-organization-id', orgA._id.toString())
        .attach('file', invalidBuffer, {
          filename: 'virus.exe',
          contentType: 'application/x-msdownload',
        });

      expect(badUploadRes.status).toBe(400);
      expect(badUploadRes.body.success).toBe(false);
      expect(badUploadRes.body.error.message).toContain('Invalid file type');
    });

    it('enforces strict tenant isolation: Org B user requesting Org A media file gets 404/403', async () => {
      // Create media under Org A
      const mediaA = await MediaAsset.create({
        organizationId: orgA._id,
        filename: 'secret_architectural_blueprint.pdf',
        storageKey: 'org_a_files/blueprint.pdf',
        url: '/api/v1/media/blueprint.pdf',
        mimetype: 'application/pdf',
        sizeBytes: 1024,
        aspectRatio: 'OTHER',
        tags: ['blueprint'],
        isApproved: true,
        approvalStatus: 'APPROVED',
      });

      // Org B user attempts to fetch Org A's media metadata
      const metaResB = await request(app)
        .get(`/api/v1/media/${mediaA._id}`)
        .set('Authorization', `Bearer ${ownerTokenB}`)
        .set('x-organization-id', orgB._id.toString());

      expect(metaResB.status).toBe(404);

      // Org B user attempts to download Org A's media file
      const downloadResB = await request(app)
        .get(`/api/v1/media/${mediaA._id}/file`)
        .set('Authorization', `Bearer ${ownerTokenB}`)
        .set('x-organization-id', orgB._id.toString());

      expect(downloadResB.status).toBe(404);
    });

    it('patches media tags and approval status', async () => {
      const media = await MediaAsset.create({
        organizationId: orgA._id,
        filename: 'lobby_view.jpg',
        storageKey: 'lobby_key',
        url: '/api/v1/media/lobby_key',
        mimetype: 'image/jpeg',
        sizeBytes: 2048,
        aspectRatio: '4:5',
        tags: ['lobby'],
        isApproved: false,
        approvalStatus: 'PENDING',
      });

      const patchRes = await request(app)
        .patch(`/api/v1/media/${media._id}`)
        .set('Authorization', `Bearer ${ownerTokenA}`)
        .set('x-organization-id', orgA._id.toString())
        .send({
          approvalStatus: 'APPROVED',
          tags: ['lobby', 'luxury', 'chandelier'],
        });

      expect(patchRes.status).toBe(200);
      expect(patchRes.body.data.approvalStatus).toBe('APPROVED');
      expect(patchRes.body.data.isApproved).toBe(true);
      expect(patchRes.body.data.tags).toContain('chandelier');
    });
  });

  // ================= 4. BRAND PROFILE =================
  describe('4. Brand Profile (GET & PUT /brand)', () => {
    it('auto-provisions default brand profile on GET and updates via PUT', async () => {
      // 1. GET /brand auto-provisions
      const getRes = await request(app)
        .get('/api/v1/brand')
        .set('Authorization', `Bearer ${ownerTokenA}`)
        .set('x-organization-id', orgA._id.toString());

      expect(getRes.status).toBe(200);
      expect(getRes.body.data.primaryColor).toBe('#000000');
      expect(getRes.body.data.supportedLanguages).toContain('English');

      // 2. PUT /brand updates
      const putRes = await request(app)
        .put('/api/v1/brand')
        .set('Authorization', `Bearer ${ownerTokenA}`)
        .set('x-organization-id', orgA._id.toString())
        .send({
          primaryColor: '#1A365D',
          secondaryColor: '#2B6CB0',
          accentColor: '#D69E2E',
          tone: 'Modern Sophistication and High ROI',
          supportedLanguages: ['English', 'Hindi'],
          defaultDisclaimer: 'Custom verified RERA disclaimer 2026.',
        });

      expect(putRes.status).toBe(200);
      expect(putRes.body.data.primaryColor).toBe('#1A365D');
      expect(putRes.body.data.tone).toBe('Modern Sophistication and High ROI');
    });
  });

  // ================= 5. AUDIENCE BRIEFS CRUD =================
  describe('5. Audience Briefs CRUD & Tenant Isolation', () => {
    it('creates and lists audience briefs scoped to tenant', async () => {
      const createRes = await request(app)
        .post('/api/v1/audience-briefs')
        .set('Authorization', `Bearer ${ownerTokenA}`)
        .set('x-organization-id', orgA._id.toString())
        .send({
          name: 'South Delhi & Gurugram HNIs',
          targetPersona: 'Tech Founders, C-Suite Executives, Doctors',
          locations: ['Golf Course Extension', 'Vasant Vihar', 'Aerocity'],
          ageRange: { min: 32, max: 58 },
          incomeBracket: '₹1.5 Cr+ Annual Household Income',
          interests: ['Luxury Cars', 'Private Equity', 'Golf', 'Fine Dining'],
          housingAdPolicyAcknowledged: true,
        });

      expect(createRes.status).toBe(201);
      expect(createRes.body.data.name).toBe('South Delhi & Gurugram HNIs');

      // Org A listing returns it
      const listResA = await request(app)
        .get('/api/v1/audience-briefs')
        .set('Authorization', `Bearer ${ownerTokenA}`)
        .set('x-organization-id', orgA._id.toString());

      expect(listResA.status).toBe(200);
      expect(listResA.body.data).toHaveLength(1);

      // Org B listing does NOT return Org A brief (tenant isolation)
      const listResB = await request(app)
        .get('/api/v1/audience-briefs')
        .set('Authorization', `Bearer ${ownerTokenB}`)
        .set('x-organization-id', orgB._id.toString());

      expect(listResB.status).toBe(200);
      expect(listResB.body.data).toHaveLength(0);
    });
  });

  // ================= 6. ROLE PERMISSION ENFORCEMENT =================
  describe('6. Role Permission Enforcement', () => {
    it('blocks viewer from creating a project or updating brand profile (403 Forbidden)', async () => {
      // Viewer attempting project creation
      const projectRes = await request(app)
        .post('/api/v1/projects')
        .set('Authorization', `Bearer ${viewerTokenA}`)
        .set('x-organization-id', orgA._id.toString())
        .send({
          name: 'Unauthorized Project',
          category: 'RESIDENTIAL',
          subtype: 'Apartments',
        });

      expect(projectRes.status).toBe(403);
      expect(projectRes.body.error.code).toBe('INSUFFICIENT_PERMISSIONS');

      // Viewer attempting brand update
      const brandRes = await request(app)
        .put('/api/v1/brand')
        .set('Authorization', `Bearer ${viewerTokenA}`)
        .set('x-organization-id', orgA._id.toString())
        .send({ primaryColor: '#FF0000' });

      expect(brandRes.status).toBe(403);
    });
  });
});
