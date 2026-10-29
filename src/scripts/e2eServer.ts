import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createApp } from '../app.js';
import { initAllIndexes } from '../models/initIndexes.js';
import { Organization } from '../models/Organization.js';
import { User } from '../models/User.js';
import { Membership } from '../models/Membership.js';
import { Project } from '../models/Project.js';
import { PropertyUnit } from '../models/PropertyUnit.js';
import { BrandProfile } from '../models/BrandProfile.js';
import { Budget } from '../models/Budget.js';
import { Lead } from '../models/Lead.js';
import { Plan } from '../models/Plan.js';
import { PlanItem } from '../models/PlanItem.js';
import { Creative } from '../models/Creative.js';
import { Approval } from '../models/Approval.js';
import { Campaign } from '../models/Campaign.js';
import bcrypt from 'bcryptjs';
import { logger } from '../config/logger.js';

async function bootstrap() {
  logger.info('Starting MongoMemoryServer for E2E testing...');
  const mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();
  await mongoose.connect(uri);
  await initAllIndexes();

  logger.info('Seeding E2E test data...');
  const passwordHash = await bcrypt.hash('Password123!', 10);

  // 0. Platform Admin User
  const adminPasswordHash = await bcrypt.hash('AdminPassword123!', 10);
  await User.create({
    email: 'admin@realcrm.in',
    passwordHash: adminPasswordHash,
    fullName: 'Platform Administrator',
    isPlatformAdmin: true,
    status: 'active',
  });

  // 1. Apex Luxury Org
  const org = await Organization.create({
    name: 'Apex Luxury Estates',
    slug: 'apex-luxury',
    status: 'ACTIVE',
    settings: { currency: 'INR', defaultTimezone: 'Asia/Kolkata' },
    onboarding: {
      status: 'completed',
      currentStep: 4,
      data: {},
    },
  });

  // 2. Owner User
  const owner = await User.create({
    email: 'owner@apex-luxury.in',
    passwordHash,
    fullName: 'Vikramaditya Singhania',
    isPlatformAdmin: false,
    status: 'active',
  });

  await Membership.create({
    userId: owner._id,
    organizationId: org._id,
    role: 'org_owner',
    status: 'ACTIVE',
  });

  // Viewer User
  const viewer = await User.create({
    email: 'viewer@apex-luxury.in',
    passwordHash,
    fullName: 'Aarav Sharma',
    isPlatformAdmin: false,
    status: 'active',
  });

  await Membership.create({
    userId: viewer._id,
    organizationId: org._id,
    role: 'viewer',
    status: 'ACTIVE',
  });

  // 3. Manager User
  const manager = await User.create({
    email: 'manager@apex-luxury.in',
    passwordHash,
    fullName: 'Priya Nambiar',
    isPlatformAdmin: false,
    status: 'active',
  });

  await Membership.create({
    userId: manager._id,
    organizationId: org._id,
    role: 'marketing_manager',
    status: 'ACTIVE',
  });

  // 4. Initial Project
  const project = await Project.create({
    organizationId: org._id,
    name: 'Emerald Bay Towers',
    slug: 'emerald-bay-towers',
    status: 'ACTIVE',
    category: 'RESIDENTIAL',
    subtype: 'Luxury Apartments',
    location: {
      address: 'Golf Course Extension Road',
      city: 'Gurugram',
      state: 'Haryana',
      pincode: '122001',
    },
    priceRange: {
      min: 25000000,
      max: 60000000,
      display: '₹ 2.5 Cr - ₹ 6.0 Cr',
    },
    uspList: ['Triple-height lobby', 'Private plunge pool', 'Rooftop Helipad'],
    amenities: ['Clubhouse', 'Olympic Lap Pool', 'EV Charging Bays'],
    reraNumber: 'RC/REP/HARERA/GGM/2026/89',
    launchDate: new Date('2026-12-01'),
  });

  // 5. Initial Unit
  await PropertyUnit.create({
    organizationId: org._id,
    projectId: project._id,
    unitNumber: 'Tower A - 3201 Penthouse',
    unitType: '4BHK Penthouse',
    carpetAreaSqFt: 3450,
    price: 45000000,
    priceDisplay: '₹ 4.5 Cr',
    floor: 32,
    status: 'AVAILABLE',
  });

  // 6. Brand Profile
  await BrandProfile.create({
    organizationId: org._id,
    legalName: 'Apex Luxury Real Estate Ltd',
    brandName: 'Apex Estates',
    websiteUrl: 'https://apex-luxury.in',
    primaryColor: '#000000',
    secondaryColor: '#ffffff',
    reraRegistrationNumber: 'RC/REP/HARERA/GGM/2026/89',
    complianceDisclaimer: 'All layouts, plans and specifications are tentative and subject to change.',
  });

  // 7. Budget
  await Budget.create({
    organizationId: org._id,
    month: 11,
    year: 2026,
    overallCap: 3000000,
    currency: 'INR',
    projectAllocations: [
      {
        projectId: project._id,
        projectName: project.name,
        amount: 2500000,
        metaAds: 1500000,
        googleAds: 1000000,
      },
    ],
  });

  // 8. Plan & Plan Items
  const plan = await Plan.create({
    organizationId: org._id,
    month: 11,
    year: 2026,
    cycleName: 'November 2026 Luxury Launch',
    status: 'IN_REVIEW',
  });

  const planItem = await PlanItem.create({
    organizationId: org._id,
    planId: plan._id,
    projectId: project._id,
    title: 'Penthouse Panorama Teaser',
    type: 'POST_4x5',
    channel: 'INSTAGRAM',
    topic: 'Penthouse Tour',
    creativeBrief: 'Visual carousel showcasing private sky deck and views',
    scheduledDate: new Date('2026-11-15T10:00:00.000Z'),
    scheduledTime: '10:00',
    scheduledAt: new Date('2026-11-15T10:00:00.000Z'),
    status: 'PENDING_APPROVAL',
    version: 1,
  });

  // 9. Creative
  const creative = await Creative.create({
    organizationId: org._id,
    planItemId: planItem._id,
    projectId: project._id,
    version: 1,
    format: '4:5',
    headline: 'Sky-High Elegance at Emerald Bay',
    caption: 'Experience unmatched luxury living with private plunge pools and panoramic golf course vistas.',
    hashtags: ['#LuxuryLiving', '#EmeraldBay', '#GurugramLuxury'],
    status: 'GENERATED',
    approvalStatus: 'PENDING_APPROVAL',
    factCheckPassed: true,
    factCheckIssues: [],
    reReviewRequired: false,
    renderedAssetUrl: 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=800&auto=format&fit=crop',
  });

  // 10. Approval
  await Approval.create({
    organizationId: org._id,
    planItemId: planItem._id,
    creativeId: creative._id,
    title: 'Approval: Penthouse Panorama Teaser',
    status: 'PENDING',
    factChecklist: {
      priceVerified: false,
      bedroomsVerified: false,
      amenitiesVerified: false,
      ctaVerified: false,
      reraDisclaimerVerified: false,
    },
  });

  // 11. Initial Lead
  await Lead.create({
    organizationId: org._id,
    dedupeKey: 'phone:+919811122334',
    name: 'Rajesh K. Khurana',
    phone: '+91 98111 22334',
    email: 'rajesh.khurana@fortune500.in',
    projectId: project._id,
    projectName: project.name,
    budget: 45000000,
    budgetDisplay: '₹ 4.5 Cr',
    stage: 'New',
    source: 'META_AD',
    consentGiven: true,
    consentTimestamp: new Date(),
    consentSource: 'Meta Instant Form',
  });

  // 12. Campaign
  await Campaign.create({
    organizationId: org._id,
    projectId: project._id,
    planItemId: planItem._id,
    creativeId: creative._id,
    name: 'Emerald Bay Penthouse Launch - Lead Gen',
    objective: 'LEAD_GEN',
    dailyBudget: 25000,
    totalSpend: 75000,
    status: 'PAUSED',
    completedSteps: ['CAMPAIGN', 'AD_SET', 'CREATIVE', 'AD'],
    metaCampaignId: 'meta_camp_e2e_101',
    metaAdSetId: 'meta_adset_e2e_101',
    metaCreativeId: 'meta_creative_e2e_101',
    metaAdId: 'meta_ad_e2e_101',
    metrics: {
      impressions: 48500,
      clicks: 1420,
      leads: 38,
      spend: 75000,
      cpl: 1973.68,
      ctr: '2.93%',
      roas: '4.8x',
    },
  });

  // Start Express HTTP Server
  const app = createApp();
  const port = process.env.PORT || 5000;
  app.listen(port, () => {
    logger.info(`E2E Backend running on port ${port} with connected in-memory MongoDB.`);
  });
}

bootstrap().catch((err) => {
  console.error('Failed to start E2E server:', err);
  process.exit(1);
});
