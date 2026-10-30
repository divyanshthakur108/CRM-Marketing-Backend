import { Schema, model, Document, Types } from 'mongoose';

export type CreativeType = 'POSTER' | 'REEL';
export type CreativeFormat = '1:1' | '4:5' | '9:16';
export type CreativeStatus =
  | 'GENERATING'
  | 'GENERATED'
  | 'ready_for_review'
  | 'APPROVED'
  | 'approved'
  | 'CHANGES_REQUESTED'
  | 'changes_requested'
  | 'REJECTED'
  | 'rejected'
  | 'stale'
  | 'FAILED'
  | 'failed';

export interface ICreativeFile {
  ratio: CreativeFormat;
  url: string;
  storageKey?: string;
  mimeType?: string;
}

export interface ICreativeHistory {
  version: number;
  headline: string;
  caption: string;
  hashtags: string[];
  renderedAssetUrl?: string;
  files?: ICreativeFile[];
  sourceAssetIds?: Types.ObjectId[];
  factsSnapshot?: Record<string, string>;
  generatedBy?: 'template' | 'ai';
  status?: string;
  cost?: number;
  approvalStatus?: 'DRAFT' | 'PENDING_APPROVAL' | 'APPROVED' | 'CHANGES_REQUESTED' | 'REJECTED';
  factCheckPassed?: boolean;
  factCheckIssues?: string[];
  revisionNotes?: string;
  generatedAt: Date;
}

export interface ICreative extends Document {
  organizationId: Types.ObjectId;
  planItemId?: Types.ObjectId;
  projectId?: Types.ObjectId;
  unitId?: Types.ObjectId;
  type: CreativeType;
  format: CreativeFormat;
  mediaAssetId?: Types.ObjectId;
  heroAssetId?: Types.ObjectId;
  renderedAssetUrl?: string;
  posterFrameUrl?: string;
  files: ICreativeFile[];
  sourceAssetIds: Types.ObjectId[];
  factsSnapshot?: Record<string, string>;
  generatedBy: 'template' | 'ai';
  isIllustrative: boolean;
  cost: number;
  errorMessage?: string;
  headline: string;
  caption: string;
  hashtags: string[];
  language: 'English' | 'Hindi' | 'Hinglish';
  status: CreativeStatus;
  approvalStatus: 'DRAFT' | 'PENDING_APPROVAL' | 'APPROVED' | 'CHANGES_REQUESTED' | 'REJECTED';
  version: number;
  factCheckPassed: boolean;
  factCheckIssues: string[];
  reReviewRequired: boolean;
  revisionNotes?: string;
  history: ICreativeHistory[];
  occasion?: string;
  extensionType?: 'NONE' | 'AI_CONTINUATION';
  stylePreset?: 'HERITAGE_LUXURY' | 'HIGH_GROWTH_ROI';
  isPresenterWalkthrough?: boolean;
  presenterScript?: any;
  createdAt: Date;
  updatedAt: Date;
}

const creativeSchema = new Schema<ICreative>(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true,
    },
    planItemId: {
      type: Schema.Types.ObjectId,
      ref: 'PlanItem',
      index: true,
    },
    projectId: {
      type: Schema.Types.ObjectId,
      ref: 'Project',
      index: true,
    },
    unitId: {
      type: Schema.Types.ObjectId,
      ref: 'PropertyUnit',
      index: true,
    },
    type: {
      type: String,
      enum: ['POSTER', 'REEL'],
      default: 'POSTER',
      index: true,
    },
    format: {
      type: String,
      enum: ['1:1', '4:5', '9:16'],
      required: true,
      default: '4:5',
    },
    mediaAssetId: {
      type: Schema.Types.ObjectId,
      ref: 'MediaAsset',
    },
    heroAssetId: {
      type: Schema.Types.ObjectId,
      ref: 'MediaAsset',
    },
    renderedAssetUrl: {
      type: String,
    },
    posterFrameUrl: {
      type: String,
    },
    files: [
      {
        ratio: { type: String, enum: ['1:1', '4:5', '9:16'], required: true },
        url: { type: String, required: true },
        storageKey: { type: String },
        mimeType: { type: String, default: 'image/png' },
      },
    ],
    sourceAssetIds: [
      {
        type: Schema.Types.ObjectId,
        ref: 'MediaAsset',
      },
    ],
    factsSnapshot: {
      type: Schema.Types.Mixed,
      default: {},
    },
    generatedBy: {
      type: String,
      enum: ['template', 'ai'],
      default: 'template',
    },
    isIllustrative: {
      type: Boolean,
      default: false,
    },
    cost: {
      type: Number,
      default: 1,
    },
    errorMessage: {
      type: String,
    },
    occasion: {
      type: String,
      index: true,
    },
    extensionType: {
      type: String,
      enum: ['NONE', 'AI_CONTINUATION'],
      default: 'NONE',
    },
    stylePreset: {
      type: String,
      enum: ['HERITAGE_LUXURY', 'HIGH_GROWTH_ROI'],
      default: 'HERITAGE_LUXURY',
      index: true,
    },
    isPresenterWalkthrough: {
      type: Boolean,
      default: false,
    },
    presenterScript: {
      type: Schema.Types.Mixed,
    },
    headline: {
      type: String,
      required: true,
    },
    caption: {
      type: String,
      required: true,
    },
    hashtags: [
      {
        type: String,
      },
    ],
    language: {
      type: String,
      enum: ['English', 'Hindi', 'Hinglish'],
      default: 'English',
    },
    status: {
      type: String,
      enum: [
        'GENERATING',
        'GENERATED',
        'ready_for_review',
        'APPROVED',
        'approved',
        'CHANGES_REQUESTED',
        'changes_requested',
        'REJECTED',
        'rejected',
        'stale',
        'FAILED',
        'failed',
      ],
      default: 'ready_for_review',
      index: true,
    },
    approvalStatus: {
      type: String,
      enum: ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'CHANGES_REQUESTED', 'REJECTED'],
      default: 'PENDING_APPROVAL',
      index: true,
    },
    version: {
      type: Number,
      default: 1,
    },
    factCheckPassed: {
      type: Boolean,
      default: true,
    },
    factCheckIssues: [
      {
        type: String,
      },
    ],
    reReviewRequired: {
      type: Boolean,
      default: false,
    },
    revisionNotes: {
      type: String,
    },
    history: [
      {
        version: { type: Number, required: true },
        headline: { type: String, required: true },
        caption: { type: String, required: true },
        hashtags: [{ type: String }],
        renderedAssetUrl: { type: String },
        files: [
          {
            ratio: { type: String },
            url: { type: String },
            storageKey: { type: String },
            mimeType: { type: String },
          },
        ],
        sourceAssetIds: [{ type: Schema.Types.ObjectId, ref: 'MediaAsset' }],
        factsSnapshot: { type: Schema.Types.Mixed },
        generatedBy: { type: String },
        status: { type: String },
        cost: { type: Number },
        approvalStatus: { type: String },
        factCheckPassed: { type: Boolean },
        factCheckIssues: [{ type: String }],
        revisionNotes: { type: String },
        generatedAt: { type: Date, default: Date.now },
      },
    ],
  },
  {
    timestamps: true,
  }
);

creativeSchema.index({ organizationId: 1, planItemId: 1 });
creativeSchema.index({ organizationId: 1, projectId: 1, unitId: 1 });
creativeSchema.index({ organizationId: 1, status: 1 });
creativeSchema.index({ organizationId: 1, approvalStatus: 1 });

export const Creative = model<ICreative>('Creative', creativeSchema);
