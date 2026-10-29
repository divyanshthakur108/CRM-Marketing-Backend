import dotenv from 'dotenv';
dotenv.config();

import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { connectDB } from '../config/db.js';
import { logger } from '../config/logger.js';
import { initAllIndexes } from '../models/initIndexes.js';
import {
  Organization,
  User,
  Membership,
  Project,
  PropertyUnit,
  BrandProfile,
  Budget,
  Lead,
  Subscription,
  Plan,
  PlanItem,
  Creative,
  Approval,
  Campaign,
} from '../models/index.js';

export async function runSeed(): Promise<void> {
  logger.info('Starting database seeding...');
  await connectDB();
  await initAllIndexes();

  const saltRounds = 10;
  const commonPasswordHash = await bcrypt.hash('Password123!', saltRounds);

  // ===========================================================================
  // 1. TENANT 1: APEX LUXURY ESTATES
  // ===========================================================================
  logger.info('Seeding Tenant 1: Apex Luxury Estates...');

  const org1 = await Organization.findOneAndUpdate(
    { slug: 'apex-luxury' },
    {
      name: 'Apex Luxury Estates & Towers',
      slug: 'apex-luxury',
      status: 'ACTIVE',
      onboarding: {
        status: 'completed',
        currentStep: 4,
        completedAt: new Date(),
      },
      settings: {
        currency: 'INR',
        defaultTimezone: 'Asia/Kolkata',
      },
    },
    { upsert: true, new: true }
  );

  // Users for Org 1
  const userApexOwner = await User.findOneAndUpdate(
    { email: 'owner@apex-luxury.in' },
    {
      email: 'owner@apex-luxury.in',
      passwordHash: commonPasswordHash,
      fullName: 'Vikramaditya Singhania',
      isPlatformAdmin: false,
    },
    { upsert: true, new: true }
  );

  const userApexManager = await User.findOneAndUpdate(
    { email: 'manager@apex-luxury.in' },
    {
      email: 'manager@apex-luxury.in',
      passwordHash: commonPasswordHash,
      fullName: 'Priya Nambiar',
      isPlatformAdmin: false,
    },
    { upsert: true, new: true }
  );

  const userApexSales = await User.findOneAndUpdate(
    { email: 'sales@apex-luxury.in' },
    {
      email: 'sales@apex-luxury.in',
      passwordHash: commonPasswordHash,
      fullName: 'Rohan Deshmukh',
      isPlatformAdmin: false,
    },
    { upsert: true, new: true }
  );

  const userApexViewer = await User.findOneAndUpdate(
    { email: 'viewer@apex-luxury.in' },
    {
      email: 'viewer@apex-luxury.in',
      passwordHash: commonPasswordHash,
      fullName: 'Aarav Sharma',
      isPlatformAdmin: false,
    },
    { upsert: true, new: true }
  );

  // Memberships for Org 1
  await Membership.findOneAndUpdate(
    { organizationId: org1._id, userId: userApexOwner._id },
    {
      organizationId: org1._id,
      userId: userApexOwner._id,
      role: 'org_owner',
      status: 'ACTIVE',
    },
    { upsert: true }
  );

  await Membership.findOneAndUpdate(
    { organizationId: org1._id, userId: userApexManager._id },
    {
      organizationId: org1._id,
      userId: userApexManager._id,
      role: 'marketing_manager',
      status: 'ACTIVE',
    },
    { upsert: true }
  );

  await Membership.findOneAndUpdate(
    { organizationId: org1._id, userId: userApexSales._id },
    {
      organizationId: org1._id,
      userId: userApexSales._id,
      role: 'SALES_AGENT',
      status: 'ACTIVE',
    },
    { upsert: true }
  );

  await Membership.findOneAndUpdate(
    { organizationId: org1._id, userId: userApexViewer._id },
    {
      organizationId: org1._id,
      userId: userApexViewer._id,
      role: 'viewer',
      status: 'ACTIVE',
    },
    { upsert: true }
  );

  // Brand Profile for Org 1
  await BrandProfile.findOneAndUpdate(
    { organizationId: org1._id },
    {
      organizationId: org1._id,
      primaryColor: '#000000',
      secondaryColor: '#525252',
      accentColor: '#D4AF37',
      tone: 'Ultra Luxury, Exclusive, Sophisticated',
      supportedLanguages: ['English', 'Hindi', 'Hinglish'],
      defaultDisclaimer:
        'Artistic impression only. Specifications subject to change without notice. RERA Approved.',
    },
    { upsert: true }
  );

  // Subscription for Org 1
  await Subscription.findOneAndUpdate(
    { organizationId: org1._id },
    {
      organizationId: org1._id,
      plan: 'ENTERPRISE',
      status: 'ACTIVE',
      billingInterval: 'ANNUAL',
      creditsAllocated: 15000,
      creditsRemaining: 14200,
    },
    { upsert: true }
  );

  // Project 1.1: The Palm Residences (Residential)
  const projPalm = await Project.findOneAndUpdate(
    { organizationId: org1._id, slug: 'the-palm-residences' },
    {
      organizationId: org1._id,
      name: 'The Palm Residences',
      slug: 'the-palm-residences',
      category: 'RESIDENTIAL',
      subtype: 'Apartment',
      status: 'ACTIVE',
      reraNumber: 'RERA-MAH-2026-0881',
      location: {
        address: 'Worli Sea Face, Boulevard 4',
        city: 'Mumbai',
        microMarket: 'Worli',
        state: 'Maharashtra',
        pincode: '400018',
      },
      priceRange: {
        min: 85000000,
        max: 240000000,
        display: '₹8.5 Cr - ₹24 Cr',
      },
      details: {
        bedrooms: [3, 4, 5],
        parking: '3 Reserved Covered Slots',
        facing: 'Arabian Sea Panoramic View',
        possession: 'Q4 2027',
      },
      amenities: [
        'Private Oceanfront Clubhouse',
        'Helipad Access',
        'Olympic Infinity Pool',
        'Concierge 24/7',
      ],
    },
    { upsert: true, new: true }
  );

  // Units for The Palm Residences
  const palmUnits = [
    {
      unitNumber: 'A-101',
      unitType: '3 BHK Sea View Residence',
      floor: 10,
      tower: 'Azure Tower',
      carpetAreaSqFt: 2450,
      price: 85000000,
      priceDisplay: '₹8.50 Cr',
      status: 'AVAILABLE' as const,
    },
    {
      unitNumber: 'A-1802',
      unitType: '4 BHK Grand Royal Suite',
      floor: 18,
      tower: 'Azure Tower',
      carpetAreaSqFt: 3800,
      price: 142000000,
      priceDisplay: '₹14.20 Cr',
      status: 'BLOCKED' as const,
    },
    {
      unitNumber: 'PH-32',
      unitType: '5 BHK Duplex Penthouse',
      floor: 32,
      tower: 'Celeste Tower',
      carpetAreaSqFt: 5200,
      price: 240000000,
      priceDisplay: '₹24.00 Cr',
      status: 'SOLD' as const,
    },
  ];

  for (const unit of palmUnits) {
    await PropertyUnit.findOneAndUpdate(
      { organizationId: org1._id, projectId: projPalm._id, unitNumber: unit.unitNumber },
      {
        organizationId: org1._id,
        projectId: projPalm._id,
        ...unit,
      },
      { upsert: true }
    );
  }

  // Budget for Org 1
  await Budget.findOneAndUpdate(
    { organizationId: org1._id, month: 11, year: 2026 },
    {
      organizationId: org1._id,
      month: 11,
      year: 2026,
      overallCap: 2500000,
      projectAllocations: [
        {
          projectId: projPalm._id,
          projectName: projPalm.name,
          amount: 1750000,
        },
      ],
      currency: 'INR',
    },
    { upsert: true }
  );

  // Leads for Org 1
  await Lead.findOneAndUpdate(
    { organizationId: org1._id, dedupeKey: '+919820111223' },
    {
      organizationId: org1._id,
      dedupeKey: '+919820111223',
      name: 'Aarav Mehta',
      phone: '+91 98201 11223',
      email: 'aarav.mehta@equityventures.in',
      projectId: projPalm._id,
      projectName: projPalm.name,
      budget: 150000000,
      budgetDisplay: '₹15 Cr',
      stage: 'Qualified',
      assignedTo: userApexSales._id,
      assignedAgentName: userApexSales.fullName,
      source: 'META_AD',
      lastContactedAt: new Date(),
    },
    { upsert: true }
  );

  await Lead.findOneAndUpdate(
    { organizationId: org1._id, dedupeKey: 'phone:+919811122334' },
    {
      organizationId: org1._id,
      dedupeKey: 'phone:+919811122334',
      name: 'Rajesh K. Khurana',
      phone: '+91 98111 22334',
      email: 'rajesh.khurana@fortune500.in',
      projectId: projPalm._id,
      projectName: projPalm.name,
      budget: 45000000,
      budgetDisplay: '₹ 4.5 Cr',
      stage: 'New',
      source: 'META_AD',
      consentGiven: true,
      consentTimestamp: new Date(),
      consentSource: 'Meta Instant Form',
    },
    { upsert: true }
  );

  // Marketing Plan & Plan Items for Org 1
  const planApex = await Plan.findOneAndUpdate(
    { organizationId: org1._id, month: 11, year: 2026 },
    {
      organizationId: org1._id,
      projectId: projPalm._id,
      month: 11,
      year: 2026,
      cycleName: 'November 2026 Luxury Launch',
      status: 'IN_REVIEW',
    },
    { upsert: true, new: true }
  );

  const planItemApex = await PlanItem.findOneAndUpdate(
    { organizationId: org1._id, title: 'Penthouse Panorama Teaser' },
    {
      organizationId: org1._id,
      planId: planApex._id,
      projectId: projPalm._id,
      projectName: projPalm.name,
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
    },
    { upsert: true, new: true }
  );

  // Creative for Org 1
  const creativeApex = await Creative.findOneAndUpdate(
    { organizationId: org1._id, planItemId: planItemApex._id },
    {
      organizationId: org1._id,
      planItemId: planItemApex._id,
      projectId: projPalm._id,
      version: 1,
      format: '4:5',
      headline: 'Sky-High Elegance at The Palm Residences',
      caption: 'Experience unmatched luxury living with private plunge pools and panoramic ocean vistas.',
      hashtags: ['#LuxuryLiving', '#ThePalmResidences', '#MumbaiLuxury'],
      status: 'GENERATED',
      approvalStatus: 'PENDING_APPROVAL',
      factCheckPassed: true,
      factCheckIssues: [],
      reReviewRequired: false,
      renderedAssetUrl: 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=800&auto=format&fit=crop',
    },
    { upsert: true, new: true }
  );

  // Approval for Org 1
  await Approval.findOneAndUpdate(
    { organizationId: org1._id, planItemId: planItemApex._id },
    {
      organizationId: org1._id,
      planItemId: planItemApex._id,
      creativeId: creativeApex._id,
      title: 'Approval: Penthouse Panorama Teaser',
      status: 'PENDING',
      factChecklist: {
        priceVerified: true,
        bedroomsVerified: true,
        amenitiesVerified: true,
        ctaVerified: true,
        reraDisclaimerVerified: true,
      },
    },
    { upsert: true }
  );

  // Campaign for Org 1
  await Campaign.findOneAndUpdate(
    { organizationId: org1._id, name: 'Emerald Bay Penthouse Launch - Lead Gen' },
    {
      organizationId: org1._id,
      projectId: projPalm._id,
      planItemId: planItemApex._id,
      creativeId: creativeApex._id,
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
    },
    { upsert: true }
  );

  // ===========================================================================
  // 2. TENANT 2: ZENITH COMMERCIAL INFRASTRUCTURE
  // ===========================================================================
  logger.info('Seeding Tenant 2: Zenith Commercial Infrastructure...');

  const org2 = await Organization.findOneAndUpdate(
    { slug: 'zenith-commercial' },
    {
      name: 'Zenith Commercial & Industrial Infrastructure',
      slug: 'zenith-commercial',
      status: 'ACTIVE',
      settings: {
        currency: 'INR',
        defaultTimezone: 'Asia/Kolkata',
      },
    },
    { upsert: true, new: true }
  );

  // Users for Org 2
  const userZenithOwner = await User.findOneAndUpdate(
    { email: 'director@zenith-commercial.in' },
    {
      email: 'director@zenith-commercial.in',
      passwordHash: commonPasswordHash,
      fullName: 'Devendra Kothari',
      isPlatformAdmin: false,
    },
    { upsert: true, new: true }
  );

  const userZenithViewer = await User.findOneAndUpdate(
    { email: 'analyst@zenith-commercial.in' },
    {
      email: 'analyst@zenith-commercial.in',
      passwordHash: commonPasswordHash,
      fullName: 'Meera Iyer',
      isPlatformAdmin: false,
    },
    { upsert: true, new: true }
  );

  // Memberships for Org 2
  await Membership.findOneAndUpdate(
    { organizationId: org2._id, userId: userZenithOwner._id },
    {
      organizationId: org2._id,
      userId: userZenithOwner._id,
      role: 'OWNER',
      status: 'ACTIVE',
    },
    { upsert: true }
  );

  await Membership.findOneAndUpdate(
    { organizationId: org2._id, userId: userZenithViewer._id },
    {
      organizationId: org2._id,
      userId: userZenithViewer._id,
      role: 'VIEWER',
      status: 'ACTIVE',
    },
    { upsert: true }
  );

  // Brand Profile for Org 2
  await BrandProfile.findOneAndUpdate(
    { organizationId: org2._id },
    {
      organizationId: org2._id,
      primaryColor: '#111827',
      secondaryColor: '#4B5563',
      accentColor: '#2563EB',
      tone: 'Institutional, ESG Compliant, Scalable Commercial Infrastructure',
      supportedLanguages: ['English'],
      defaultDisclaimer:
        'All industrial load capacities verified by certified structural engineers.',
    },
    { upsert: true }
  );

  // Subscription for Org 2
  await Subscription.findOneAndUpdate(
    { organizationId: org2._id },
    {
      organizationId: org2._id,
      plan: 'GROWTH',
      status: 'ACTIVE',
      billingInterval: 'MONTHLY',
      creditsAllocated: 5000,
      creditsRemaining: 4850,
    },
    { upsert: true }
  );

  // Project 2.1: Apex Logistics & Cargo Dry Port (Industrial)
  const projLogistics = await Project.findOneAndUpdate(
    { organizationId: org2._id, slug: 'apex-logistics-hub' },
    {
      organizationId: org2._id,
      name: 'Apex Logistics & Cargo Hub',
      slug: 'apex-logistics-hub',
      category: 'INDUSTRIAL',
      subtype: 'Warehouse',
      status: 'ACTIVE',
      reraNumber: 'RERA-GUJ-2026-0919',
      location: {
        address: 'National Highway 48, Logistics Corridor',
        city: 'Surat',
        microMarket: 'Palsana Industrial Belt',
        state: 'Gujarat',
        pincode: '394315',
      },
      priceRange: {
        min: 120000000,
        max: 350000000,
        display: '₹12 Cr - ₹35 Cr',
      },
      details: {
        powerCapacity: '1500 KVA Dedicated Industrial Substation',
        ceilingHeight: '42 ft Clear Height',
        dockLevelers: '18 Hydraulic Docking Bays',
      },
      amenities: [
        'Heavy Multi-Axle Truck Terminal',
        'Cold Storage Cryogenic Bay',
        '24/7 RFID Gate Automation',
      ],
    },
    { upsert: true, new: true }
  );

  // Units for Apex Logistics Hub
  const logisticsUnits = [
    {
      unitNumber: 'BAY-A1',
      unitType: 'Grade-A FMCG Fulfillment Warehouse',
      carpetAreaSqFt: 45000,
      price: 120000000,
      priceDisplay: '₹12.00 Cr',
      status: 'AVAILABLE' as const,
    },
    {
      unitNumber: 'BAY-C4',
      unitType: 'Temperature-Controlled Pharma Logistics Bay',
      carpetAreaSqFt: 65000,
      price: 195000000,
      priceDisplay: '₹19.50 Cr',
      status: 'AVAILABLE' as const,
    },
  ];

  for (const unit of logisticsUnits) {
    await PropertyUnit.findOneAndUpdate(
      { organizationId: org2._id, projectId: projLogistics._id, unitNumber: unit.unitNumber },
      {
        organizationId: org2._id,
        projectId: projLogistics._id,
        ...unit,
      },
      { upsert: true }
    );
  }

  // Budget for Org 2
  await Budget.findOneAndUpdate(
    { organizationId: org2._id, month: 11, year: 2026 },
    {
      organizationId: org2._id,
      month: 11,
      year: 2026,
      overallCap: 1800000,
      projectAllocations: [
        {
          projectId: projLogistics._id,
          projectName: projLogistics.name,
          amount: 1200000,
        },
      ],
      currency: 'INR',
    },
    { upsert: true }
  );

  // Lead for Org 2
  await Lead.findOneAndUpdate(
    { organizationId: org2._id, dedupeKey: '+919920088776' },
    {
      organizationId: org2._id,
      dedupeKey: '+919920088776',
      name: 'Rajesh Gokhale',
      phone: '+91 99200 88776',
      email: 'rajesh.g@omnilogistics.in',
      projectId: projLogistics._id,
      projectName: projLogistics.name,
      budget: 150000000,
      budgetDisplay: '₹15 Cr',
      stage: 'Negotiation',
      source: 'DIRECT',
      lastContactedAt: new Date(),
    },
    { upsert: true }
  );

  logger.info('Database seeding completed successfully for 2 tenant organizations!');
}

// Direct execution entrypoint
runSeed()
  .then(async () => {
    logger.info('Database seed script finished.');
    await mongoose.disconnect();
    process.exit(0);
  })
  .catch(async (err) => {
    logger.error({ err }, 'Error during database seed execution');
    await mongoose.disconnect();
    process.exit(1);
  });
