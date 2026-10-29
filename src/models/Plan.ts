import { Schema, model, Document, Types } from 'mongoose';

export interface IPlan extends Document {
  organizationId: Types.ObjectId;
  projectId?: Types.ObjectId;
  cycleName: string;
  month: number;
  year: number;
  version: number;
  status: 'DRAFT' | 'IN_REVIEW' | 'APPROVED' | 'CHANGES_REQUESTED' | 'SUBMITTED' | 'ACTIVE';
  itemsCount: number;
  allocatedBudget?: number;
  strategySummary?: string;
  approvedBy?: Types.ObjectId;
  approvedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const planSchema = new Schema<IPlan>(
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
    cycleName: {
      type: String,
      default: '',
    },
    month: {
      type: Number,
      required: true,
      min: 1,
      max: 12,
    },
    year: {
      type: Number,
      required: true,
    },
    version: {
      type: Number,
      default: 1,
    },
    status: {
      type: String,
      enum: ['DRAFT', 'IN_REVIEW', 'APPROVED', 'CHANGES_REQUESTED', 'SUBMITTED', 'ACTIVE'],
      default: 'DRAFT',
      index: true,
    },
    itemsCount: {
      type: Number,
      default: 0,
    },
    allocatedBudget: {
      type: Number,
      default: 0,
    },
    strategySummary: {
      type: String,
      default: '',
    },
    approvedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
    approvedAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
  }
);

planSchema.index({ organizationId: 1, projectId: 1, month: 1, year: 1 });

export const Plan = model<IPlan>('Plan', planSchema);
