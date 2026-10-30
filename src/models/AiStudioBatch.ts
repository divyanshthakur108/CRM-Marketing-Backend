import { Schema, model, Document, Types } from 'mongoose';

export interface IAiStudioImage {
  id: string;
  url: string;
  storageKey: string;
  title: string;
  category: string;
  cameraAngle: string;
  lightingStyle: string;
  aspectRatio: '4:5' | '1:1' | '9:16';
  isSelected: boolean;
  isRegenerated?: boolean;
  prompt?: string;
  generatedAt: Date;
  sourceAssetId?: string;
  sourceAssetUrl?: string;
  featureHighlighted?: string;
  compositionType?: string;
  visualHash?: string;
  similarityScore?: number;
  isDuplicateWarning?: boolean;
}

export type ReelVariationStyle = 'CINEMATIC_SHOWCASE' | 'LUXURY_PRESENTATION' | 'MODERN_PROMO_AD';

export interface IAiStudioReel {
  id: string;
  versionNumber: number;
  variationStyle: ReelVariationStyle;
  title: string;
  subtitle: string;
  videoUrl: string;
  posterFrameUrl: string;
  storageKey: string;
  durationSeconds: number;
  selectedImageIds: string[];
  musicTrack?: string;
  approvalStatus: 'DRAFT' | 'APPROVED' | 'REJECTED';
  createdAt: Date;
}

export interface IAnalyzedSourcePhoto {
  assetId: string;
  url: string;
  filename: string;
  category: string;
  detectedFeatures: string[];
  lighting: string;
  perspective?: string;
}

export interface IPropertyVisionAnalysis {
  propertyType: string;
  architecturalStyle: string;
  dominantColors: string[];
  lightingProfile: string;
  roomLayouts: string[];
  detectedSpaces: string[];
  uniqueFeatures: string[];
  analysisSummary: string;
  analyzedAt: Date;
  analyzedPhotos?: IAnalyzedSourcePhoto[];
}

export interface IAiStudioBatch extends Document {
  organizationId: Types.ObjectId;
  projectId: Types.ObjectId;
  unitId?: Types.ObjectId;
  version: number;
  status: 'IDLE' | 'ANALYZING' | 'GENERATING' | 'READY' | 'FAILED';
  visionAnalysis?: IPropertyVisionAnalysis;
  images: IAiStudioImage[];
  reels: IAiStudioReel[];
  sourceMediaAssetIds: Types.ObjectId[];
  errorMessage?: string;
  createdAt: Date;
  updatedAt: Date;
}

const aiStudioImageSchema = new Schema<IAiStudioImage>(
  {
    id: { type: String, required: true },
    url: { type: String, required: true },
    storageKey: { type: String, required: true },
    title: { type: String, required: true },
    category: { type: String, required: true },
    cameraAngle: { type: String, default: 'Eye-Level Architectural' },
    lightingStyle: { type: String, default: 'Natural Ambient Daylight' },
    aspectRatio: { type: String, enum: ['4:5', '1:1', '9:16'], default: '4:5' },
    isSelected: { type: Boolean, default: true },
    isRegenerated: { type: Boolean, default: false },
    prompt: { type: String },
    generatedAt: { type: Date, default: Date.now },
    sourceAssetId: { type: String },
    sourceAssetUrl: { type: String },
    featureHighlighted: { type: String },
    compositionType: { type: String },
    visualHash: { type: String },
    similarityScore: { type: Number, default: 0 },
    isDuplicateWarning: { type: Boolean, default: false },
  },
  { _id: false }
);

const aiStudioReelSchema = new Schema<IAiStudioReel>(
  {
    id: { type: String, required: true },
    versionNumber: { type: Number, required: true, default: 1 },
    variationStyle: {
      type: String,
      enum: ['CINEMATIC_SHOWCASE', 'LUXURY_PRESENTATION', 'MODERN_PROMO_AD'],
      required: true,
      default: 'CINEMATIC_SHOWCASE',
    },
    title: { type: String, required: true },
    subtitle: { type: String, default: '' },
    videoUrl: { type: String, required: true },
    posterFrameUrl: { type: String, default: '' },
    storageKey: { type: String, required: true },
    durationSeconds: { type: Number, default: 15 },
    selectedImageIds: [{ type: String }],
    musicTrack: { type: String },
    approvalStatus: {
      type: String,
      enum: ['DRAFT', 'APPROVED', 'REJECTED'],
      default: 'DRAFT',
    },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const propertyVisionAnalysisSchema = new Schema<IPropertyVisionAnalysis>(
  {
    propertyType: { type: String, default: 'Premium Residential Property' },
    architecturalStyle: { type: String, default: 'Modern Contemporary Luxury' },
    dominantColors: [{ type: String }],
    lightingProfile: { type: String, default: 'Balanced Natural Daylight' },
    roomLayouts: [{ type: String }],
    detectedSpaces: [{ type: String }],
    uniqueFeatures: [{ type: String }],
    analysisSummary: { type: String, default: '' },
    analyzedAt: { type: Date, default: Date.now },
    analyzedPhotos: [
      {
        assetId: { type: String },
        url: { type: String },
        filename: { type: String },
        category: { type: String },
        detectedFeatures: [{ type: String }],
        lighting: { type: String },
        perspective: { type: String },
      },
    ],
  },
  { _id: false }
);

const aiStudioBatchSchema = new Schema<IAiStudioBatch>(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true,
    },
    projectId: {
      type: Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
      index: true,
    },
    unitId: {
      type: Schema.Types.ObjectId,
      ref: 'PropertyUnit',
      index: true,
    },
    version: {
      type: Number,
      required: true,
      default: 1,
    },
    status: {
      type: String,
      enum: ['IDLE', 'ANALYZING', 'GENERATING', 'READY', 'FAILED'],
      default: 'IDLE',
    },
    visionAnalysis: {
      type: propertyVisionAnalysisSchema,
    },
    images: [aiStudioImageSchema],
    reels: [aiStudioReelSchema],
    sourceMediaAssetIds: [
      {
        type: Schema.Types.ObjectId,
        ref: 'MediaAsset',
      },
    ],
    errorMessage: { type: String },
  },
  {
    timestamps: true,
  }
);

aiStudioBatchSchema.index({ organizationId: 1, projectId: 1, version: -1 });

export const AiStudioBatch = model<IAiStudioBatch>('AiStudioBatch', aiStudioBatchSchema);
