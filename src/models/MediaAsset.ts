import { Schema, model, Document, Types } from 'mongoose';

export type MediaAspectRatio = '1:1' | '4:5' | '9:16' | '16:9' | 'OTHER';
export type MediaType = 'IMAGE' | 'VIDEO' | 'DOCUMENT';
export type MediaCategory =
  | 'EXTERIOR'
  | 'INTERIOR'
  | 'ROOMS'
  | 'FLOOR_PLANS'
  | 'AMENITIES'
  | 'BROCHURE'
  | 'VIDEOS'
  | 'LOGO'
  | 'OTHER';
export type ProcessingStatus = 'uploaded' | 'processing' | 'ready' | 'failed' | 'no_poster';

export interface IMediaAsset extends Document {
  organizationId: Types.ObjectId;
  projectId?: Types.ObjectId;
  unitId?: Types.ObjectId;
  filename: string;
  storageKey: string;
  url: string;
  mimetype: string;
  sizeBytes: number;
  type: MediaType;
  category: MediaCategory;
  roomType?: string;
  room?: string;
  actualOrIllustrative: 'ACTUAL' | 'ILLUSTRATIVE';
  rightsConsent: {
    confirmed: boolean;
    by?: Types.ObjectId;
    at?: Date;
  };
  aspectRatio: MediaAspectRatio;
  width?: number;
  height?: number;
  duration?: number;
  thumbnailKey?: string;
  posterKey?: string;
  tags: string[];
  isApproved: boolean;
  approvalStatus: 'PENDING' | 'APPROVED' | 'REJECTED';
  isCover: boolean;
  sortOrder: number;
  processingStatus: ProcessingStatus;
  uploadedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const mediaAssetSchema = new Schema<IMediaAsset>(
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
      index: true,
    },
    unitId: {
      type: Schema.Types.ObjectId,
      ref: 'PropertyUnit',
      index: true,
    },
    filename: {
      type: String,
      required: true,
    },
    storageKey: {
      type: String,
      required: true,
    },
    url: {
      type: String,
      required: true,
    },
    mimetype: {
      type: String,
      required: true,
    },
    sizeBytes: {
      type: Number,
      required: true,
    },
    type: {
      type: String,
      enum: ['IMAGE', 'VIDEO', 'DOCUMENT'],
      default: 'IMAGE',
      index: true,
    },
    category: {
      type: String,
      enum: [
        'EXTERIOR',
        'INTERIOR',
        'ROOMS',
        'FLOOR_PLANS',
        'AMENITIES',
        'BROCHURE',
        'VIDEOS',
        'LOGO',
        'OTHER',
      ],
      default: 'EXTERIOR',
      index: true,
    },
    aspectRatio: {
      type: String,
      enum: ['1:1', '4:5', '9:16', '16:9', 'OTHER'],
      default: 'OTHER',
      index: true,
    },
    width: {
      type: Number,
    },
    height: {
      type: Number,
    },
    duration: {
      type: Number,
    },
    thumbnailKey: {
      type: String,
    },
    posterKey: {
      type: String,
    },
    tags: [
      {
        type: String,
      },
    ],
    roomType: {
      type: String,
    },
    room: {
      type: String,
    },
    actualOrIllustrative: {
      type: String,
      enum: ['ACTUAL', 'ILLUSTRATIVE'],
      default: 'ACTUAL',
    },
    rightsConsent: {
      confirmed: { type: Boolean, default: false },
      by: { type: Schema.Types.ObjectId, ref: 'User' },
      at: { type: Date },
    },
    isApproved: {
      type: Boolean,
      default: true,
    },
    approvalStatus: {
      type: String,
      enum: ['PENDING', 'APPROVED', 'REJECTED'],
      default: 'APPROVED',
      index: true,
    },
    isCover: {
      type: Boolean,
      default: false,
      index: true,
    },
    sortOrder: {
      type: Number,
      default: 0,
    },
    processingStatus: {
      type: String,
      enum: ['uploaded', 'processing', 'ready', 'failed', 'no_poster'],
      default: 'ready',
    },
    uploadedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
  },
  {
    timestamps: true,
  }
);

mediaAssetSchema.index({ organizationId: 1, projectId: 1, category: 1 });
mediaAssetSchema.index({ organizationId: 1, projectId: 1, isCover: 1 });
mediaAssetSchema.index({ organizationId: 1, projectId: 1, sortOrder: 1 });
mediaAssetSchema.index({ organizationId: 1, aspectRatio: 1 });
mediaAssetSchema.index({ organizationId: 1, tags: 1 });

export const MediaAsset = model<IMediaAsset>('MediaAsset', mediaAssetSchema);
