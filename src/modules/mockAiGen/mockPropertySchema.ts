import { z } from 'zod';

export const MockAddressSchema = z.object({
  line1: z.string(),
  locality: z.string(),
  city: z.string(),
  state: z.string(),
  country: z.string(),
});

export const MockFloorSchema = z.object({
  unitFloor: z.number(),
  buildingFloors: z.number(),
  isTopFloor: z.boolean(),
  liftAvailable: z.boolean(),
});

export const MockConfigurationSchema = z.object({
  bhk: z.number(),
  bedrooms: z.number(),
  bathrooms: z.number(),
  livingRooms: z.number(),
  diningAreas: z.number(),
  kitchens: z.number(),
  balconies: z.number(),
  rooftopAccess: z.string(), // "shared_common_area"
});

export const MockAreaSchema = z.object({
  carpetSqFt: z.number(),
  builtUpSqFt: z.number(),
  balconySqFt: z.number(),
  measurementsAreVerified: z.boolean(),
});

export const MockCommercialFactsSchema = z.object({
  priceInr: z.number().nullable().optional(),
  reraNumber: z.string().nullable().optional(),
  possessionDate: z.string().nullable().optional(),
  contactPhone: z.string().nullable().optional(),
  contactEmail: z.string().nullable().optional(),
  approvedClaims: z.array(z.string()).default([]),
});

export const MockBrandingSchema = z.object({
  companyName: z.string(),
  logoAssetId: z.string(),
  brandColors: z.array(z.string()),
  fontPreferences: z.array(z.string()),
  cta: z.string(),
});

export const MockProjectDetailsSchema = z.object({
  id: z.string(),
  name: z.string(),
  projectType: z.string(),
  description: z.string(),
  address: MockAddressSchema,
  floor: MockFloorSchema,
  configuration: MockConfigurationSchema,
  area: MockAreaSchema,
  orientation: z.string(),
  ownership: z.string(),
  furnishing: z.string(),
  commercialFacts: MockCommercialFactsSchema,
  branding: MockBrandingSchema,
});

export const MockAreaItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  category: z.string(),
  approxSizeSqFt: z.number().nullable().optional(),
  orientation: z.string().nullable().optional(),
  visibleOrExpectedFeatures: z.array(z.string()),
  assetIds: z.array(z.string()),
  verified: z.boolean().default(false),
});

export const MockMediaAssetSlotSchema = z.object({
  id: z.string(),
  label: z.string(),
  areaId: z.string(),
  assetType: z.string().default('image'),
  fileName: z.string().nullable().optional(),
  storageAssetId: z.string().nullable().optional(),
  storageKey: z.string().nullable().optional(),
  url: z.string().nullable().optional(),
  uploaded: z.boolean().default(false),
  approved: z.boolean().default(false),
  classification: z.enum(['ACTUAL', 'ILLUSTRATIVE']).default('ACTUAL'),
  notes: z.string().optional(),
});

export const MockSceneSchema = z.object({
  assetId: z.string(),
  seconds: z.number(),
  role: z.string(),
  text: z.string(),
  language: z.string(),
  motion: z.string(),
  runwayClip: z.boolean().default(false),
});

export const MockCampaignSchema = z.object({
  id: z.string(),
  campaignName: z.string(),
  goal: z.string(),
  platform: z.string().default('facebook'),
  publishAtLocal: z.string(),
  timezone: z.string().default('Asia/Kolkata'),
  status: z.string().default('DRAFT_NOT_SCHEDULED'),
  language: z.string(),
  designProfile: z.string(),
  visualDirection: z.string(),
  durationSeconds: z.number(),
  output: z.object({
    width: z.number().default(1080),
    height: z.number().default(1920),
    fps: z.number().default(24),
    format: z.string().default('mp4'),
    aspectRatio: z.string().default('9:16'),
  }),
  caption: z.string(),
  music: z.object({
    enabled: z.boolean().default(false),
    licensedTrackAssetId: z.string().nullable().optional(),
  }),
  voiceover: z.object({
    enabled: z.boolean().default(false),
  }),
  scenes: z.array(MockSceneSchema),
  generationPolicy: z.record(z.string(), z.any()).optional(),
});

export const MockSourceVideoSchema = z.object({
  assetId: z.string(),
  originalName: z.string(),
  cleanName: z.string(),
  storageKey: z.string(),
  url: z.string(),
  thumbnailUrl: z.string(),
  durationSeconds: z.number(),
  width: z.number(),
  height: z.number(),
  aspectRatio: z.string(),
  orientation: z.enum(['portrait', 'landscape', 'square']),
  rotation: z.number(),
  fps: z.number(),
  stability: z.enum(['stable', 'moderate', 'shaky']),
  lighting: z.enum(['balanced', 'underexposed', 'overexposed']),
  qualityScore: z.number(),
  inferredRoom: z.string(),
  inferredConfidence: z.number(),
  userRoomOverride: z.string().optional(),
  classification: z.enum(['ACTUAL', 'ILLUSTRATIVE']).default('ACTUAL'),
  highlightSegments: z.array(z.any()).default([]),
  bestAdvertisingShot: z.any().optional(),
});

export const MockPropertyProjectSchema = z.object({
  schemaVersion: z.string(),
  datasetType: z.literal('SYNTHETIC_DEMO_DO_NOT_PUBLISH'),
  project: MockProjectDetailsSchema,
  areas: z.array(MockAreaItemSchema),
  media: z.object({
    logo: z.object({
      id: z.string(),
      fileName: z.string().nullable().optional(),
      uploaded: z.boolean().default(false),
      approved: z.boolean().default(false),
      storageKey: z.string().nullable().optional(),
      url: z.string().nullable().optional(),
    }),
    assets: z.array(MockMediaAssetSlotSchema),
    sourceVideos: z.array(MockSourceVideoSchema).default([]),
    requireManualRoomMapping: z.boolean().default(true),
    neverOverwriteOriginals: z.boolean().default(true),
  }),
  generationSettings: z.record(z.string(), z.any()),
  campaigns: z.array(MockCampaignSchema),
});

export type MockPropertyProject = z.infer<typeof MockPropertyProjectSchema>;
export type MockCampaign = z.infer<typeof MockCampaignSchema>;
export type MockAreaItem = z.infer<typeof MockAreaItemSchema>;
export type MockMediaAssetSlot = z.infer<typeof MockMediaAssetSlotSchema>;
export type MockScene = z.infer<typeof MockSceneSchema>;
export type MockSourceVideo = z.infer<typeof MockSourceVideoSchema>;
