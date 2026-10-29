import { Schema, model, Document, Types } from 'mongoose';

export interface IUnitChangeHistory {
  field: 'price' | 'status' | string;
  oldValue: unknown;
  newValue: unknown;
  changedBy?: Types.ObjectId;
  timestamp: Date;
  reason?: string;
}

export interface IPropertyUnit extends Document {
  organizationId: Types.ObjectId;
  projectId: Types.ObjectId;
  unitNumber: string;
  unitType: string;
  floor?: number;
  tower?: string;
  carpetAreaSqFt: number;
  superBuiltUpAreaSqFt?: number;
  price: number;
  priceDisplay?: string;
  heroAssetId?: Types.ObjectId;
  status: 'AVAILABLE' | 'BLOCKED' | 'SOLD';
  attributes: Record<string, unknown>;
  changeHistory: IUnitChangeHistory[];
  createdAt: Date;
  updatedAt: Date;
}

const propertyUnitSchema = new Schema<IPropertyUnit>(
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
    unitNumber: {
      type: String,
      required: true,
      trim: true,
    },
    unitType: {
      type: String,
      required: true,
      trim: true,
    },
    floor: {
      type: Number,
    },
    tower: {
      type: String,
    },
    carpetAreaSqFt: {
      type: Number,
      required: true,
    },
    superBuiltUpAreaSqFt: {
      type: Number,
    },
    price: {
      type: Number,
      required: true,
    },
    priceDisplay: {
      type: String,
    },
    heroAssetId: {
      type: Schema.Types.ObjectId,
      ref: 'MediaAsset',
    },
    status: {
      type: String,
      enum: ['AVAILABLE', 'BLOCKED', 'SOLD'],
      default: 'AVAILABLE',
      index: true,
    },
    attributes: {
      type: Schema.Types.Mixed,
      default: {},
    },
    changeHistory: [
      {
        field: { type: String, required: true },
        oldValue: { type: Schema.Types.Mixed },
        newValue: { type: Schema.Types.Mixed },
        changedBy: { type: Schema.Types.ObjectId, ref: 'User' },
        timestamp: { type: Date, default: Date.now },
        reason: { type: String },
      },
    ],
  },
  {
    timestamps: true,
  }
);

// Unique unit number per project per organization
propertyUnitSchema.index(
  { organizationId: 1, projectId: 1, unitNumber: 1 },
  { unique: true }
);

export const PropertyUnit = model<IPropertyUnit>('PropertyUnit', propertyUnitSchema);
