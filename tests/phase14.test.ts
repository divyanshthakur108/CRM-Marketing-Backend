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
import { Project } from '../src/models/Project.js';
import { Conversation } from '../src/models/Conversation.js';
import { Appointment } from '../src/models/Appointment.js';
import { Job } from '../src/models/Job.js';
import { generateAccessToken } from '../src/utils/token.js';
import { initAllIndexes } from '../src/models/initIndexes.js';

describe('Phase 14: WhatsApp Follow-ups and Site-Visit Appointments', () => {
  let app: ReturnType<typeof createApp>;
  let mongod: MongoMemoryServer;

  // Tenant A: DLF Prestige Group
  let orgAId: string;
  let userAId: string;
  let tokenA: string;
  let projectAId: string;

  // Tenant B: Godrej Luxury Living
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
      name: 'DLF Prestige Group',
      slug: 'dlf-prestige',
    });
    orgAId = orgA._id.toString();

    const passwordHash = await bcrypt.hash('Password123!', 10);
    const userA = await User.create({
      email: 'sales.head@dlf-prestige.in',
      fullName: 'Vikram Malhotra',
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

    // Seed Project with verified facts for Tenant A
    const projectA = await Project.create({
      organizationId: orgA._id,
      name: 'The Crest Villas',
      slug: 'the-crest-villas',
      category: 'RESIDENTIAL',
      subtype: '4BHK Signature Villas',
      reraNumber: 'PRM/KA/RERA/1251/310/PR/210423/004123',
      location: {
        address: 'Golf Course Extension Road',
        city: 'Gurugram',
        microMarket: 'Sector 54',
        state: 'Haryana',
        pincode: '122002',
      },
      priceRange: {
        min: 65000000,
        max: 95000000,
        display: '₹ 6.5 Cr - ₹ 9.5 Cr',
      },
      amenities: ['Private Lap Pool', 'Championship Golf Simulator', 'Temperature-Controlled Wine Cellar'],
      status: 'ACTIVE',
    });
    projectAId = projectA._id.toString();

    // 2. Seed Tenant B
    const orgB = await Organization.create({
      name: 'Godrej Luxury Living',
      slug: 'godrej-luxury',
    });
    orgBId = orgB._id.toString();

    const userB = await User.create({
      email: 'director@godrej-luxury.com',
      fullName: 'Aanya Singhania',
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
    await Conversation.deleteMany({});
    await Appointment.deleteMany({});
    await Lead.deleteMany({});
    await LeadActivity.deleteMany({});
    await Job.deleteMany({});
  });

  describe('1. WhatsApp Consent Enforcement', () => {
    it('blocks promotional messages when client consent is missing (403 Forbidden)', async () => {
      // 1. Create a lead WITHOUT consent
      const leadNoConsent = await Lead.create({
        organizationId: new mongoose.Types.ObjectId(orgAId),
        dedupeKey: 'phone:+919811122233',
        name: 'Unconsenting Client',
        phone: '+91 98111 22233',
        stage: 'New',
        consentGiven: false,
      });

      // 2. Attempt to start a promotional WhatsApp outreach
      const res = await request(app)
        .post('/api/v1/conversations')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          contactPhone: '+91 98111 22233',
          contactName: 'Unconsenting Client',
          leadId: leadNoConsent._id.toString(),
          projectName: 'The Crest Villas',
          initialMessage: 'Exclusive festive preview: 5% limited down-payment reduction on Signature Villas!',
          isPromotional: true,
        });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('CONSENT_REQUIRED');
    });

    it('allows promotional messages when verified consent is recorded', async () => {
      // 1. Create a lead WITH verified consent
      const leadWithConsent = await Lead.create({
        organizationId: new mongoose.Types.ObjectId(orgAId),
        dedupeKey: 'phone:+919876543210',
        name: 'Rajesh Khanna',
        phone: '+91 98765 43210',
        stage: 'Qualified',
        consentGiven: true,
        consentSource: 'META_LEADGEN_FORM',
      });

      // 2. Send promotional WhatsApp message
      const res = await request(app)
        .post('/api/v1/conversations')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          contactPhone: '+91 98765 43210',
          contactName: 'Rajesh Khanna',
          leadId: leadWithConsent._id.toString(),
          projectName: 'The Crest Villas',
          initialMessage: 'Greetings Mr. Khanna, verified brochure for The Crest Villas is attached for your review.',
          isPromotional: true,
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.contactPhone).toBe('+91 98765 43210');
      expect(res.body.data.messages.length).toBe(1);
    });
  });

  describe('2. WhatsApp Bot Replies & Human Handoff Enforcement', () => {
    it('replies using verified project facts for pricing inquiry without human handoff', async () => {
      const webhookPayload = {
        organizationId: orgAId,
        phone: '+91 99000 11222',
        name: 'Sameer Sen',
        projectName: 'The Crest Villas',
        text: 'What is the starting price for The Crest Villas?',
      };

      const res = await request(app)
        .post('/webhooks/whatsapp')
        .send(webhookPayload);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.isHandoff).toBe(false);
      expect(res.body.data.replyText).toContain('6.5 Cr');

      // Verify conversation stored
      const conv = await Conversation.findById(res.body.data.conversationId);
      expect(conv).toBeDefined();
      expect(conv?.needsHandoff).toBe(false);
      expect(conv?.messages.length).toBe(2); // user + bot
      expect(conv?.messages[1].sender).toBe('bot');
    });

    it('flags human handoff when client raises complex negotiation request', async () => {
      const webhookPayload = {
        organizationId: orgAId,
        phone: '+91 99111 22334',
        name: 'Karan Mehra',
        projectName: 'The Crest Villas',
        text: 'Can you give me a 10% discount or negotiate on the registration charges?',
      };

      const res = await request(app)
        .post('/webhooks/whatsapp')
        .send(webhookPayload);

      expect(res.status).toBe(200);
      expect(res.body.data.isHandoff).toBe(true);

      const conv = await Conversation.findById(res.body.data.conversationId);
      expect(conv?.needsHandoff).toBe(true);
      expect(conv?.handoffReason).toBe('NEGOTIATION');
    });

    it('flags human handoff when client raises a legal complaint or dispute', async () => {
      const webhookPayload = {
        organizationId: orgAId,
        phone: '+91 99222 33445',
        name: 'Sunil Mittal',
        projectName: 'The Crest Villas',
        text: 'I have a serious complaint regarding delayed possession and will consult my lawyer.',
      };

      const res = await request(app)
        .post('/webhooks/whatsapp')
        .send(webhookPayload);

      expect(res.status).toBe(200);
      expect(res.body.data.isHandoff).toBe(true);

      const conv = await Conversation.findById(res.body.data.conversationId);
      expect(conv?.needsHandoff).toBe(true);
      expect(conv?.handoffReason).toBe('COMPLAINT');
    });
  });

  describe('3. Site-Visit Appointments & Slot Collision Prevention', () => {
    it('books an appointment, returns gate pass code, and enqueues reminder job', async () => {
      const lead = await Lead.create({
        organizationId: new mongoose.Types.ObjectId(orgAId),
        dedupeKey: 'phone:+919855566778',
        name: 'Arjun Kapoor',
        phone: '+91 98555 66778',
        stage: 'Qualified',
        consentGiven: true,
      });

      const res = await request(app)
        .post('/api/v1/appointments')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          leadId: lead._id.toString(),
          projectId: projectAId,
          leadName: 'Arjun Kapoor',
          leadPhone: '+91 98555 66778',
          projectName: 'The Crest Villas',
          appointmentDate: '2026-11-15T00:00:00.000Z',
          timeSlot: '10:00 AM - 11:00 AM',
          notes: 'Interested in Corner Villa facing central greens',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('Scheduled');
      expect(res.body.data.gatePassCode).toMatch(/^VIP-\d{4}$/);

      // Verify associated lead stage advanced to 'Visit scheduled'
      const updatedLead = await Lead.findById(lead._id);
      expect(updatedLead?.stage).toBe('Visit scheduled');

      // Verify reminder job enqueued in background jobs collection
      const reminderJob = await Job.findOne({
        organizationId: orgAId,
        jobType: 'APPOINTMENT_REMINDER',
        idempotencyKey: `appointment-reminder-${res.body.data._id}`,
      });
      expect(reminderJob).toBeDefined();
      expect(reminderJob?.status).toBe('PENDING');
      expect(reminderJob?.payload.gatePassCode).toBe(res.body.data.gatePassCode);
    });

    it('strictly rejects double-booking the same slot with 409 Conflict', async () => {
      const bookingPayload = {
        leadName: 'Client First',
        leadPhone: '+91 91234 56789',
        projectName: 'The Crest Villas',
        appointmentDate: '2026-11-20T00:00:00.000Z',
        timeSlot: '02:00 PM - 03:00 PM',
        assignedAgentId: userAId,
      };

      // 1. First booking succeeds
      const res1 = await request(app)
        .post('/api/v1/appointments')
        .set('Authorization', `Bearer ${tokenA}`)
        .send(bookingPayload);

      expect(res1.status).toBe(201);

      // 2. Second booking with the exact same slot and agent fails with 409
      const res2 = await request(app)
        .post('/api/v1/appointments')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          ...bookingPayload,
          leadName: 'Client Collision',
          leadPhone: '+91 98888 77777',
        });

      expect(res2.status).toBe(409);
      expect(res2.body.success).toBe(false);
      expect(res2.body.error.code).toBe('SLOT_UNAVAILABLE');
    });

    it('records visit feedback, marks appointment completed, advances lead to Visit done, and creates next sales task', async () => {
      // 1. Create lead and appointment
      const lead = await Lead.create({
        organizationId: new mongoose.Types.ObjectId(orgAId),
        dedupeKey: 'phone:+919777788889',
        name: 'Rohan Mehra',
        phone: '+91 97777 88889',
        stage: 'Visit scheduled',
        consentGiven: true,
      });

      const appointment = await Appointment.create({
        organizationId: new mongoose.Types.ObjectId(orgAId),
        leadId: lead._id,
        leadName: 'Rohan Mehra',
        leadPhone: '+91 97777 88889',
        projectName: 'The Crest Villas',
        appointmentDate: new Date('2026-11-10T10:00:00.000Z'),
        timeSlot: '11:30 AM - 12:30 PM',
        status: 'Scheduled',
        assignedAgentName: 'Vikram Malhotra',
      });

      // 2. Submit Walkthrough Feedback
      const feedbackRes = await request(app)
        .patch(`/api/v1/appointments/${appointment._id}/feedback`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          feedbackRating: 5,
          feedbackNotes: 'Client loved the double-height ceiling and club view. Ready to review booking application form.',
          interestLevel: 'HIGH',
          nextAction: 'Send cost sheet breakdown with 10:90 bank subvention scheme',
          nextActionDate: '2026-11-12T00:00:00.000Z',
        });

      expect(feedbackRes.status).toBe(200);
      expect(feedbackRes.body.data.status).toBe('Completed');
      expect(feedbackRes.body.data.feedbackRating).toBe(5);

      // 3. Verify Lead stage is 'Visit done'
      const updatedLead = await Lead.findById(lead._id);
      expect(updatedLead?.stage).toBe('Visit done');

      // 4. Verify Timeline contains the next sales task
      const activities = await LeadActivity.find({ leadId: lead._id });
      expect(activities.length).toBeGreaterThanOrEqual(1);
      const feedbackActivity = activities.find((a) => a.summary.includes('Walkthrough Completed'));
      expect(feedbackActivity).toBeDefined();
      expect(feedbackActivity?.summary).toContain('5/5 stars');
      expect(feedbackActivity?.summary).toContain('HIGH intent');
    });
  });

  describe('4. Tenant Isolation Enforcement', () => {
    it('Org A cannot read Org B conversations or appointments', async () => {
      // 1. Create conversation and appointment in Org B
      const convB = await Conversation.create({
        organizationId: new mongoose.Types.ObjectId(orgBId),
        contactName: 'Confidential Client Org B',
        contactPhone: '+91 99999 11111',
        channel: 'WHATSAPP',
        lastMessage: 'Confidential enquiry for Godrej Luxury Penthouse',
        messages: [{
          id: 'm1',
          sender: 'user',
          text: 'Private penthouse details please',
          time: '10:00 AM',
          timestamp: new Date(),
        }],
      });

      const appointmentB = await Appointment.create({
        organizationId: new mongoose.Types.ObjectId(orgBId),
        leadName: 'Private Investor Org B',
        leadPhone: '+91 99999 22222',
        projectName: 'Godrej Horizon',
        appointmentDate: new Date('2026-11-25T14:00:00.000Z'),
        timeSlot: '02:00 PM - 03:00 PM',
        status: 'Scheduled',
      });

      // 2. Org A attempts to fetch Org B conversation
      const convRes = await request(app)
        .get(`/api/v1/conversations/${convB._id}`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(convRes.status).toBe(404);

      // 3. Org A attempts to list conversations
      const listConvRes = await request(app)
        .get('/api/v1/conversations')
        .set('Authorization', `Bearer ${tokenA}`);

      expect(listConvRes.status).toBe(200);
      const convIds = listConvRes.body.data.conversations.map((c: { _id: string }) => c._id);
      expect(convIds).not.toContain(convB._id.toString());

      // 4. Org A attempts to list appointments
      const listAppRes = await request(app)
        .get('/api/v1/appointments')
        .set('Authorization', `Bearer ${tokenA}`);

      expect(listAppRes.status).toBe(200);
      const appIds = listAppRes.body.data.appointments.map((a: { _id: string }) => a._id);
      expect(appIds).not.toContain(appointmentB._id.toString());
    });
  });
});
