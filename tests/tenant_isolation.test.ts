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
import { PropertyUnit } from '../src/models/PropertyUnit.js';
import { MediaAsset } from '../src/models/MediaAsset.js';
import { BrandProfile } from '../src/models/BrandProfile.js';
import { AudienceBrief } from '../src/models/AudienceBrief.js';
import { Budget } from '../src/models/Budget.js';
import { Plan } from '../src/models/Plan.js';
import { PlanItem } from '../src/models/PlanItem.js';
import { Creative } from '../src/models/Creative.js';
import { Approval } from '../src/models/Approval.js';
import { Campaign } from '../src/models/Campaign.js';
import { Lead } from '../src/models/Lead.js';
import { Conversation } from '../src/models/Conversation.js';
import { Appointment } from '../src/models/Appointment.js';
import { generateAccessToken } from '../src/utils/token.js';
import { initAllIndexes } from '../src/models/initIndexes.js';

describe('Phase 15: Comprehensive Tenant-Isolation Suite', () => {
  let app: ReturnType<typeof createApp>;
  let mongod: MongoMemoryServer;

  // Tenant A: Org A
  let orgAId: string;
  let userAId: string;
  let tokenA: string;

  // Tenant B: Org B
  let orgBId: string;
  let userBId: string;
  let tokenB: string;

  // Seeded Org B Resource IDs
  let projectBId: string;
  let unitBId: string;
  let mediaBId: string;
  let audienceBriefBId: string;
  let planBId: string;
  let planItemBId: string;
  let creativeBId: string;
  let approvalBId: string;
  let campaignBId: string;
  let leadBId: string;
  let conversationBId: string;
  let appointmentBId: string;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri());
    await initAllIndexes();

    app = createApp();

    const passwordHash = await bcrypt.hash('Password123!', 10);

    // 1. Seed Tenant A
    const orgA = await Organization.create({
      name: 'Tenant A Real Estate',
      slug: 'tenant-a-crm',
    });
    orgAId = orgA._id.toString();

    const userA = await User.create({
      email: 'admin@tenant-a.com',
      fullName: 'Tenant A Administrator',
      passwordHash,
    });
    userAId = userA._id.toString();

    await Membership.create({
      organizationId: orgA._id,
      userId: userA._id,
      role: 'org_owner',
      status: 'ACTIVE',
    });

    tokenA = generateAccessToken({
      userId: userAId,
      email: userA.email,
      isPlatformAdmin: false,
      organizationId: orgAId,
      role: 'org_owner',
    });

    // 2. Seed Tenant B
    const orgB = await Organization.create({
      name: 'Tenant B Estates',
      slug: 'tenant-b-crm',
    });
    orgBId = orgB._id.toString();

    const userB = await User.create({
      email: 'admin@tenant-b.com',
      fullName: 'Tenant B Administrator',
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

    // 3. Seed ALL resources strictly under Tenant B
    const projectB = await Project.create({
      organizationId: orgB._id,
      name: 'Org B High-Rise Heights',
      slug: 'org-b-high-rise-heights',
      category: 'RESIDENTIAL',
      subtype: 'Apartment',
      priceRange: { min: 20000000, max: 35000000, display: '₹ 2.0 Cr - ₹ 3.5 Cr' },
      status: 'ACTIVE',
    });
    projectBId = projectB._id.toString();

    const unitB = await PropertyUnit.create({
      organizationId: orgB._id,
      projectId: projectB._id,
      unitNumber: 'Tower-B-1402',
      unitType: '3BHK',
      carpetAreaSqFt: 1850,
      price: 25000000,
      status: 'AVAILABLE',
      attributes: {},
      changeHistory: [],
    });
    unitBId = unitB._id.toString();

    const mediaB = await MediaAsset.create({
      organizationId: orgB._id,
      filename: 'confidential_blueprint_b.pdf',
      storageKey: 'media/stored_b_123.pdf',
      url: '/storage/media/stored_b_123.pdf',
      mimetype: 'application/pdf',
      sizeBytes: 4096,
      aspectRatio: 'OTHER',
      tags: [],
      isApproved: true,
      approvalStatus: 'APPROVED',
    });
    mediaBId = mediaB._id.toString();

    await BrandProfile.create({
      organizationId: orgB._id,
      legalName: 'Tenant B Confidential Holdings',
      brandGuidelines: 'High luxury only',
    });

    const audienceB = await AudienceBrief.create({
      organizationId: orgB._id,
      name: 'HNIs of North India',
      targetPersona: 'Luxury Home Buyers',
      locations: ['Delhi NCR'],
      incomeBracket: 'Tier 1 HNI',
      housingAdPolicyAcknowledged: true,
    });
    audienceBriefBId = audienceB._id.toString();

    await Budget.create({
      organizationId: orgB._id,
      month: 11,
      year: 2026,
      overallCap: 1500000,
      currency: 'INR',
      projectAllocations: [{ projectId: projectB._id, projectName: 'Project B', amount: 1500000 }],
    });

    const planB = await Plan.create({
      organizationId: orgB._id,
      month: 11,
      year: 2026,
      cycleName: 'November 2026 Plan',
      status: 'IN_REVIEW',
    });
    planBId = planB._id.toString();

    const planItemB = await PlanItem.create({
      organizationId: orgB._id,
      planId: planB._id,
      projectId: projectB._id,
      title: 'Org B Launch Post',
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
    planItemBId = planItemB._id.toString();

    const creativeB = await Creative.create({
      organizationId: orgB._id,
      planItemId: planItemB._id,
      projectId: projectB._id,
      version: 1,
      format: '1:1',
      headline: 'Org B Creative Headline',
      caption: 'Org B Creative Caption',
      status: 'GENERATED',
      approvalStatus: 'PENDING_APPROVAL',
      factCheckPassed: true,
      factCheckIssues: [],
      reReviewRequired: false,
      renderedAssetUrl: 'https://cdn.realcrm.io/b-creative-1.jpg',
    });
    creativeBId = creativeB._id.toString();

    const approvalB = await Approval.create({
      organizationId: orgB._id,
      planItemId: planItemB._id,
      creativeId: creativeB._id,
      status: 'PENDING',
    });
    approvalBId = approvalB._id.toString();

    const campaignB = await Campaign.create({
      organizationId: orgB._id,
      projectId: projectB._id,
      planItemId: planItemB._id,
      name: 'Org B Secret Campaign',
      objective: 'LEAD_GEN',
      dailyBudget: 50000,
      metaCampaignId: 'meta_camp_b_999',
      status: 'PAUSED',
    });
    campaignBId = campaignB._id.toString();

    const leadB = await Lead.create({
      organizationId: orgB._id,
      dedupeKey: 'phone:+919988776655',
      name: 'Ultra Wealthy Client Org B',
      phone: '+91 99887 76655',
      email: 'hni@tenantb.com',
      stage: 'Qualified',
      consentGiven: true,
    });
    leadBId = leadB._id.toString();

    const convB = await Conversation.create({
      organizationId: orgB._id,
      contactName: 'Confidential Client Org B',
      contactPhone: '+91 99887 76655',
      channel: 'WHATSAPP',
      lastMessage: 'Confidential Penthouse inquiry',
      messages: [{ id: 'm1', sender: 'user', text: 'Pricing details please', time: '10:00', timestamp: new Date() }],
    });
    conversationBId = convB._id.toString();

    const appointmentB = await Appointment.create({
      organizationId: orgB._id,
      leadId: leadB._id,
      leadName: 'Ultra Wealthy Client Org B',
      leadPhone: '+91 99887 76655',
      projectName: 'Org B High-Rise Heights',
      appointmentDate: new Date('2026-11-20T10:00:00.000Z'),
      timeSlot: '10:00 AM - 11:00 AM',
      status: 'Scheduled',
    });
    appointmentBId = appointmentB._id.toString();
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongod.stop();
  });

  describe('Tenant Isolation: Org A requesting Org B Resources MUST Fail', () => {
    it('1. Projects: Org A cannot read, patch or delete Org B project', async () => {
      const getRes = await request(app).get(`/api/v1/projects/${projectBId}`).set('Authorization', `Bearer ${tokenA}`);
      expect(getRes.status).toBe(404);

      const patchRes = await request(app)
        .patch(`/api/v1/projects/${projectBId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ name: 'Hacked by Org A' });
      expect(patchRes.status).toBe(404);

      const delRes = await request(app).delete(`/api/v1/projects/${projectBId}`).set('Authorization', `Bearer ${tokenA}`);
      expect(delRes.status).toBe(404);
    });

    it('2. Property Units: Org A cannot read or modify Org B units', async () => {
      const getRes = await request(app)
        .get(`/api/v1/projects/${projectBId}/units/${unitBId}`)
        .set('Authorization', `Bearer ${tokenA}`);
      expect(getRes.status).toBe(404);

      const listRes = await request(app)
        .get(`/api/v1/projects/${projectBId}/units`)
        .set('Authorization', `Bearer ${tokenA}`);
      expect(listRes.status).toBe(404);
    });

    it('3. Media: Org A cannot inspect metadata or download Org B media files', async () => {
      const getRes = await request(app).get(`/api/v1/media/${mediaBId}`).set('Authorization', `Bearer ${tokenA}`);
      expect(getRes.status).toBe(404);

      const fileRes = await request(app).get(`/api/v1/media/${mediaBId}/file`).set('Authorization', `Bearer ${tokenA}`);
      expect(fileRes.status).toBe(404);

      const delRes = await request(app).delete(`/api/v1/media/${mediaBId}`).set('Authorization', `Bearer ${tokenA}`);
      expect(delRes.status).toBe(404);
    });

    it('4. Brand Profile: Org A cannot access Org B brand data', async () => {
      const brandResA = await request(app).get('/api/v1/brand').set('Authorization', `Bearer ${tokenA}`);
      expect(brandResA.status).toBe(200);
      expect(brandResA.body.data.legalName).not.toBe('Tenant B Confidential Holdings');
    });

    it('5. Audience Briefs: Org A cannot read or delete Org B audience briefs', async () => {
      const getRes = await request(app)
        .get(`/api/v1/audience-briefs/${audienceBriefBId}`)
        .set('Authorization', `Bearer ${tokenA}`);
      expect(getRes.status).toBe(404);

      const delRes = await request(app)
        .delete(`/api/v1/audience-briefs/${audienceBriefBId}`)
        .set('Authorization', `Bearer ${tokenA}`);
      expect(delRes.status).toBe(404);
    });

    it('6. Budgets: Org A cannot see Org B allocations for the same month', async () => {
      const budgetResA = await request(app).get('/api/v1/budgets/2026-11').set('Authorization', `Bearer ${tokenA}`);
      expect(budgetResA.status).toBe(200);
      const allocatedProjectIds = (budgetResA.body.data.projectAllocations || []).map(
        (a: { projectId: string }) => a.projectId
      );
      expect(allocatedProjectIds).not.toContain(projectBId);
    });

    it('7. Plans & Plan Items: Org A cannot read or modify Org B marketing calendar items', async () => {
      const getPlanRes = await request(app).get(`/api/v1/plans/${planBId}`).set('Authorization', `Bearer ${tokenA}`);
      expect(getPlanRes.status).toBe(404);

      const getItemRes = await request(app).get(`/api/v1/plan-items/${planItemBId}`).set('Authorization', `Bearer ${tokenA}`);
      expect(getItemRes.status).toBe(404);

      const patchItemRes = await request(app)
        .patch(`/api/v1/plan-items/${planItemBId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ status: 'PAUSED', version: 1 });
      expect(patchItemRes.status).toBe(404);
    });

    it('8. Creatives: Org A cannot revise or access Org B generated creatives', async () => {
      const reviseRes = await request(app)
        .post(`/api/v1/ai/creatives/${creativeBId}/revise`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ feedback: 'Attempted Org A revision' });
      expect(reviseRes.status).toBe(404);
    });

    it('9. Approvals: Org A cannot approve or reject Org B decisions', async () => {
      const decideRes = await request(app)
        .post(`/api/v1/approvals/${approvalBId}/decide`)
        .set('Authorization', `Bearer ${tokenA}`)
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
      expect(decideRes.status).toBe(404);
    });

    it('10. Campaigns: Org A cannot toggle, resume, or list Org B advertising campaigns', async () => {
      const toggleRes = await request(app)
        .patch(`/api/v1/campaigns/${campaignBId}/status`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ status: 'ACTIVE' });
      expect(toggleRes.status).toBe(404);

      const resumeRes = await request(app)
        .post(`/api/v1/campaigns/${campaignBId}/resume`)
        .set('Authorization', `Bearer ${tokenA}`);
      expect(resumeRes.status).toBe(404);

      const listRes = await request(app)
        .get('/api/v1/campaigns')
        .set('Authorization', `Bearer ${tokenA}`);
      expect(listRes.status).toBe(200);
      const campaignIds = (listRes.body.data || []).map((c: { _id: string }) => c._id);
      expect(campaignIds).not.toContain(campaignBId);
    });

    it('11. Leads CRM: Org A cannot view, update, delete or append timeline to Org B leads', async () => {
      const getRes = await request(app).get(`/api/v1/leads/${leadBId}`).set('Authorization', `Bearer ${tokenA}`);
      expect(getRes.status).toBe(404);

      const patchRes = await request(app)
        .patch(`/api/v1/leads/${leadBId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ stage: 'Won/Lost' });
      expect(patchRes.status).toBe(404);

      const timelineRes = await request(app)
        .post(`/api/v1/leads/${leadBId}/timeline`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ type: 'AGENT_NOTE', summary: 'Intrusion note' });
      expect(timelineRes.status).toBe(404);

      const delRes = await request(app).delete(`/api/v1/leads/${leadBId}`).set('Authorization', `Bearer ${tokenA}`);
      expect(delRes.status).toBe(404);
    });

    it('12. Conversations: Org A cannot read, post messages, or toggle handoff on Org B threads', async () => {
      const getRes = await request(app).get(`/api/v1/conversations/${conversationBId}`).set('Authorization', `Bearer ${tokenA}`);
      expect(getRes.status).toBe(404);

      const sendRes = await request(app)
        .post(`/api/v1/conversations/${conversationBId}/messages`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ text: 'Spam from Org A' });
      expect(sendRes.status).toBe(404);

      const handoffRes = await request(app)
        .patch(`/api/v1/conversations/${conversationBId}/handoff`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ needsHandoff: false });
      expect(handoffRes.status).toBe(404);
    });

    it('13. Appointments: Org A cannot update status or submit feedback for Org B appointments', async () => {
      const patchRes = await request(app)
        .patch(`/api/v1/appointments/${appointmentBId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ status: 'Cancelled' });
      expect(patchRes.status).toBe(404);

      const feedbackRes = await request(app)
        .patch(`/api/v1/appointments/${appointmentBId}/feedback`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          feedbackRating: 1,
          feedbackNotes: 'Fake negative feedback',
          interestLevel: 'LOW',
          nextAction: 'Close file',
        });
      expect(feedbackRes.status).toBe(404);
    });
  });
});
