import { Schema, model, Document, Types } from 'mongoose';

export type ProjectCategory = 'RESIDENTIAL' | 'COMMERCIAL' | 'INDUSTRIAL';

export interface IProject extends Document {
  organizationId: Types.ObjectId;
  name: string;
  slug: string;
  category: ProjectCategory;
  subtype: string;
  status: 'DRAFT' | 'ACTIVE' | 'READY' | 'ready' | 'SOLD_OUT' | 'ARCHIVED';
  version: number;
  submittedAt?: Date;
  submittedBy?: Types.ObjectId;
  changeHistory?: Array<{
    changedBy?: Types.ObjectId;
    changedAt: Date;
    reason?: string;
    field?: string;
    oldValue?: unknown;
    newValue?: unknown;
    changes?: Record<string, unknown>;
  }>;
  reraNumber: string;
  location: {
    address: string;
    city: string;
    microMarket: string;
    state: string;
    pincode: string;
  };
  priceRange: {
    min: number;
    max: number;
    display: string;
  };
  details: Record<string, unknown>;
  amenities: string[];
  coverImageUrl?: string;
  heroAssetId?: Types.ObjectId;
  ownerContacts?: Array<{
    name: string;
    phone: string;
    email?: string;
    role?: string;
  }>;
  privateDocuments?: Array<{
    title: string;
    url: string;
    documentType?: string;
  }>;
  privateNotes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const projectSchema = new Schema<IProject>(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    slug: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
    category: {
      type: String,
      enum: ['RESIDENTIAL', 'COMMERCIAL', 'INDUSTRIAL'],
      required: true,
    },
    subtype: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      enum: ['DRAFT', 'ACTIVE', 'READY', 'ready', 'SOLD_OUT', 'ARCHIVED'],
      default: 'DRAFT',
    },
    version: {
      type: Number,
      default: 1,
    },
    submittedAt: {
      type: Date,
    },
    submittedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
    changeHistory: [
      {
        action: { type: String },
        fromStatus: { type: String },
        toStatus: { type: String },
        version: { type: Number },
        changedBy: { type: Schema.Types.ObjectId, ref: 'User' },
        changedAt: { type: Date, default: Date.now },
        reason: { type: String },
        field: { type: String },
        oldValue: { type: Schema.Types.Mixed },
        newValue: { type: Schema.Types.Mixed },
        changes: { type: Schema.Types.Mixed },
      },
    ],
    reraNumber: {
      type: String,
      default: '',
      trim: true,
    },
    location: {
      address: { type: String, default: '' },
      city: { type: String, default: '' },
      microMarket: { type: String, default: '' },
      state: { type: String, default: '' },
      pincode: { type: String, default: '' },
    },
    priceRange: {
      min: { type: Number, required: true, default: 0 },
      max: { type: Number, required: true, default: 0 },
      display: { type: String, required: true },
    },
    details: {
      type: Schema.Types.Mixed,
      default: {},
    },
    amenities: [
      {
        type: String,
      },
    ],
    coverImageUrl: {
      type: String,
    },
    heroAssetId: {
      type: Schema.Types.ObjectId,
      ref: 'MediaAsset',
    },
    ownerContacts: [
      {
        name: { type: String, required: true },
        phone: { type: String, required: true },
        email: { type: String },
        role: { type: String },
      },
    ],
    privateDocuments: [
      {
        title: { type: String, required: true },
        url: { type: String, required: true },
        documentType: { type: String },
      },
    ],
    privateNotes: {
      type: String,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes
projectSchema.index({ organizationId: 1, slug: 1 }, { unique: true });
projectSchema.index({ organizationId: 1, status: 1 });
projectSchema.index({ organizationId: 1, category: 1 });

export const Project = model<IProject>('Project', projectSchema);
