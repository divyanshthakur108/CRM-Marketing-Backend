import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import bcrypt from 'bcryptjs';
import { createApp } from '../src/app.js';
import { Organization } from '../src/models/Organization.js';
import { User } from '../src/models/User.js';
import { Membership } from '../src/models/Membership.js';
import { Lead } from '../src/models/Lead.js';
import { LeadActivity } from '../src/models/LeadActivity.js';
import { Insight } from '../src/models/Insight.js';
import { generateAccessToken } from '../src/utils/token.js';
import { initAllIndexes } from '../src/models/initIndexes.js';

describe('Phase 13: Lead CRM, Meta Webhooks and Analytics', () => {
  let app: ReturnType<typeof createApp>;
  let mongod: MongoMemoryServer;

  // Tenant A: Apex Luxury Estates
  let orgAId: string;
  let userAId: string;
  let tokenA: string;

  // Tenant B: Elysium Residences
  let orgBId: string;
  let userBId: string;
  let tokenB: string;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri());
    await initAllIndexes();

    app = createApp();

    // 1. Seed Tenant A
    const orgA = await Organization.create({
      name: 'Apex Luxury Estates',
      slug: 'apex-luxury-crm',
    });
    orgAId = orgA._id.toString();

    const passwordHash = await bcrypt.hash('Password123!', 10);
    const userA = await User.create({
      email: 'manager@apex-luxury.in',
      fullName: 'Vikramaditya Singhania',
      passwordHash,
    });
    userAId = userA._id.toString();

    await Membership.create({
      organizationId: orgA._id,
      userId: userA._id,
      role: 'marketing_manager',
      status: 'ACTIVE',
    });

    tokenA = generateAccessToken({
      userId: userAId,
      email: userA.email,
      isPlatformAdmin: false,
      organizationId: orgAId,
      role: 'marketing_manager',
    });

    // 2. Seed Tenant B
    const orgB = await Organization.create({
      name: 'Elysium Residences',
      slug: 'elysium-crm',
    });
    orgBId = orgB._id.toString();

    const userB = await User.create({
      email: 'director@elysium-residences.com',
      fullName: 'Natasha Oberoi',
      passwordHash,
    });
    userBId = userB._id.toString();

    await Membership.create({
      organizationId: orgB._id,
      userId: userB._id,
      role: 'org_owner',
      status: 'ACTIVE',
    });

    tokenB = generateAccessToken({
      userId: userBId,
      email: userB.email,
      isPlatformAdmin: false,
      organizationId: orgBId,
      role: 'org_owner',
    });
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongod.stop();
  });

  beforeEach(async () => {
    await Lead.deleteMany({});
    await LeadActivity.deleteMany({});
    await Insight.deleteMany({});
  });

  describe('1. Meta Leads Webhook & Deduplication', () => {
    it('creates a new lead and activity entry from an inbound Meta webhook', async () => {
      const webhookPayload = {
        organizationId: orgAId,
        leadgen_id: 'meta_lead_9901',
        name: 'Siddharth Malhotra',
        phone: '+91 98200 11223',
        email: 'sid.m@apexclient.in',
        projectName: 'The Palm Residences',
        budget: 45000000,
      };

      const res = await request(app)
        .post('/webhooks/meta-leads')
        .send(webhookPayload);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.deduplicated).toBe(false);
      expect(res.body.data.leadId).toBeDefined();

      // Check DB
      const lead = await Lead.findOne({ metaLeadId: 'meta_lead_9901' });
      expect(lead).toBeDefined();
      expect(lead?.name).toBe('Siddharth Malhotra');
      expect(lead?.source).toBe('META_AD');
      expect(lead?.consentGiven).toBe(true);

      const activities = await LeadActivity.find({ leadId: lead?._id });
      expect(activities.length).toBe(1);
      expect(activities[0].type).toBe('INBOUND_SUBMISSION');
    });

    it('deduplicates repeated deliveries: the same webhook sent twice creates one lead', async () => {
      const webhookPayload = {
        organizationId: orgAId,
        leadgen_id: 'meta_lead_dedupe_test',
        name: 'Pooja Hegde',
        phone: '+91 98333 44556',
        email: 'pooja.h@client.in',
        projectName: 'The Palm Residences',
      };

      // First delivery
      const res1 = await request(app)
        .post('/webhooks/meta-leads')
        .send(webhookPayload);

      expect(res1.status).toBe(200);
      expect(res1.body.data.deduplicated).toBe(false);

      // Verify 1 lead in DB
      const initialCount = await Lead.countDocuments({ organizationId: orgAId });
      expect(initialCount).toBe(1);

      // Second delivery (e.g. Meta retry)
      const res2 = await request(app)
        .post('/webhooks/meta-leads')
        .send(webhookPayload);

      expect(res2.status).toBe(200);
      expect(res2.body.data.deduplicated).toBe(true);
      expect(res2.body.data.leadId).toBe(res1.body.data.leadId);

      // Still only 1 lead document exists
      const finalCount = await Lead.countDocuments({ organizationId: orgAId });
      expect(finalCount).toBe(1);
    });

    it('rejects duplicate lead creation with 409 Conflict if same phone submitted manually', async () => {
      // Create first lead
      await request(app)
        .post('/api/v1/leads')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          name: 'Aakash Ambani',
          phone: '+91 98222 33445',
          email: 'aakash@client.com',
          stage: 'New',
        });

      // Attempt creating with same phone (formatted slightly differently)
      const res = await request(app)
        .post('/api/v1/leads')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          name: 'Aakash Ambani Duplicate',
          phone: '+91-98222-33445', // Same normalized phone
          email: 'another.email@client.com',
          stage: 'New',
        });

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('LEAD_DUPLICATE');
    });
  });

  describe('2. Tenant Isolation Enforcement', () => {
    it('Org A cannot read Org B leads', async () => {
      // 1. Create a lead in Tenant B
      const leadB = await Lead.create({
        organizationId: new mongoose.Types.ObjectId(orgBId),
        dedupeKey: 'phone:+919988776655',
        name: 'Confidential HNI Tenant B',
        phone: '+91 99887 76655',
        email: 'hni@elysium.com',
        stage: 'Qualified',
        source: 'DIRECT',
        consentGiven: true,
      });

      // 2. Tenant A user attempts to fetch Tenant B lead directly by ID
      const directGetRes = await request(app)
        .get(`/api/v1/leads/${leadB._id}`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(directGetRes.status).toBe(404);
      expect(directGetRes.body.success).toBe(false);

      // 3. Tenant A user calls list endpoint
      const listRes = await request(app)
        .get('/api/v1/leads')
        .set('Authorization', `Bearer ${tokenA}`);

      expect(listRes.status).toBe(200);
      const leadIds = listRes.body.data.leads.map((l: { _id: string }) => l._id);
      expect(leadIds).not.toContain(leadB._id.toString());
    });
  });

  describe('3. Leads CRUD & Stage Progression Persistence', () => {
    it('creates, moves lead between stages, and persists activity timeline', async () => {
      // 1. Create Lead in 'New' stage
      const createRes = await request(app)
        .post('/api/v1/leads')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          name: 'Rohit Verma',
          phone: '+91 97654 32100',
          email: 'rohit.verma@techcorp.in',
          budget: 35000000,
          stage: 'New',
          notes: 'Interested in 3BHK high-floor panoramic view',
          consentGiven: true,
          consentSource: 'DIRECT_FORM',
          tags: ['3BHK', 'HNI Investor'],
        });

      expect(createRes.status).toBe(201);
      const leadId = createRes.body.data._id;
      expect(createRes.body.data.stage).toBe('New');

      // 2. Move stage: New -> Contacted
      const patchRes1 = await request(app)
        .patch(`/api/v1/leads/${leadId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ stage: 'Contacted' });

      expect(patchRes1.status).toBe(200);
      expect(patchRes1.body.data.stage).toBe('Contacted');

      // 3. Move stage: Contacted -> Visit scheduled
      const patchRes2 = await request(app)
        .patch(`/api/v1/leads/${leadId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ stage: 'Visit scheduled' });

      expect(patchRes2.status).toBe(200);
      expect(patchRes2.body.data.stage).toBe('Visit scheduled');

      // 4. Log custom call note on timeline
      const callLogRes = await request(app)
        .post(`/api/v1/leads/${leadId}/timeline`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          type: 'CALL_LOG',
          summary: 'Discussed clubhouse amenities and scheduled walkthrough for Saturday 11am',
          details: { durationMinutes: 15, mood: 'POSITIVE' },
        });

      expect(callLogRes.status).toBe(201);

      // 5. Verify persistence after fetching lead by ID
      const fetchRes = await request(app)
        .get(`/api/v1/leads/${leadId}`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(fetchRes.status).toBe(200);
      expect(fetchRes.body.data.lead.stage).toBe('Visit scheduled');
      expect(fetchRes.body.data.timeline.length).toBe(4); // initial + 2 stage changes + 1 call log

      const activitySummaries = fetchRes.body.data.timeline.map((a: { summary: string }) => a.summary);
      expect(activitySummaries.some((s: string) => s.includes('New" to "Contacted'))).toBe(true);
      expect(activitySummaries.some((s: string) => s.includes('Contacted" to "Visit scheduled'))).toBe(true);
    });

    it('returns stageCounts map in list endpoint for Kanban view badges', async () => {
      // Seed 2 leads in New, 1 in Negotiation
      await Lead.create([
        {
          organizationId: new mongoose.Types.ObjectId(orgAId),
          dedupeKey: 'phone:+919111111111',
          name: 'Lead 1',
          phone: '+91 91111 11111',
          stage: 'New',
          consentGiven: true,
        },
        {
          organizationId: new mongoose.Types.ObjectId(orgAId),
          dedupeKey: 'phone:+919222222222',
          name: 'Lead 2',
          phone: '+91 92222 22222',
          stage: 'New',
          consentGiven: true,
        },
        {
          organizationId: new mongoose.Types.ObjectId(orgAId),
          dedupeKey: 'phone:+919333333333',
          name: 'Lead 3',
          phone: '+91 93333 33333',
          stage: 'Negotiation',
          consentGiven: true,
        },
      ]);

      const res = await request(app)
        .get('/api/v1/leads')
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(200);
      expect(res.body.data.stageCounts.New).toBe(2);
      expect(res.body.data.stageCounts.Negotiation).toBe(1);
      expect(res.body.data.stageCounts.Qualified).toBe(0);
    });
  });

  describe('4. Insights Sync & Analytics Verification', () => {
    it('syncs daily performance insights and marks delayed/missing data', async () => {
      const syncRes = await request(app)
        .post('/api/v1/analytics/sync')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ days: 14 });

      expect(syncRes.status).toBe(200);
      expect(syncRes.body.data.syncedCount).toBe(14);

      // Verify records in DB
      const count = await Insight.countDocuments({ organizationId: orgAId });
      expect(count).toBe(14);

      // Check delayed status flag is present
      const delayed = await Insight.find({ organizationId: orgAId, status: 'DELAYED' });
      expect(delayed.length).toBeGreaterThanOrEqual(1);
      expect(delayed[0].missingFields).toContain('cpl');
    });

    it('analytics numbers match the seeded/synced data in overview endpoint', async () => {
      // 1. Trigger sync of 10 days
      await request(app)
        .post('/api/v1/analytics/sync')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ days: 10 });

      // 2. Fetch overview
      const overviewRes = await request(app)
        .get('/api/v1/analytics/overview?rangePreset=30D')
        .set('Authorization', `Bearer ${tokenA}`);

      expect(overviewRes.status).toBe(200);
      const { kpis, timeseries, dataQuality } = overviewRes.body.data;

      expect(kpis.totalSpend).toBeGreaterThan(0);
      expect(kpis.totalImpressions).toBeGreaterThan(0);
      expect(kpis.totalClicks).toBeGreaterThan(0);
      expect(kpis.totalLeads).toBeGreaterThan(0);
      expect(timeseries.length).toBe(10);
      expect(dataQuality.delayedCount).toBeGreaterThanOrEqual(1);

      // Sum timeseries spend to ensure numbers match seeded/synced data
      const sumSpend = timeseries.reduce((acc: number, t: { spend: number }) => acc + t.spend, 0);
      expect(sumSpend).toBe(kpis.totalSpend);
    });

    it('returns campaign, content, and lead conversion analytics', async () => {
      const [campRes, contentRes, leadsRes] = await Promise.all([
        request(app).get('/api/v1/analytics/campaigns').set('Authorization', `Bearer ${tokenA}`),
        request(app).get('/api/v1/analytics/content').set('Authorization', `Bearer ${tokenA}`),
        request(app).get('/api/v1/analytics/leads').set('Authorization', `Bearer ${tokenA}`),
      ]);

      expect(campRes.status).toBe(200);
      expect(Array.isArray(campRes.body.data)).toBe(true);

      expect(contentRes.status).toBe(200);
      expect(contentRes.body.data.length).toBeGreaterThan(0);

      expect(leadsRes.status).toBe(200);
      expect(leadsRes.body.data).toHaveProperty('conversionFunnel');
      expect(leadsRes.body.data).toHaveProperty('avgVelocityDays');
    });
  });
});
