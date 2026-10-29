import { Schema, model, Document, Types } from 'mongoose';

export interface IProjectAllocation {
  projectId: Types.ObjectId;
  projectName: string;
  amount: number;
  metaAds?: number;
  googleAds?: number;
  linkedinAds?: number;
  directWhatsapp?: number;
}

export interface IBudget extends Document {
  organizationId: Types.ObjectId;
  month: number;
  year: number;
  overallCap: number;
  projectAllocations: IProjectAllocation[];
  currency: string;
  createdAt: Date;
  updatedAt: Date;
}

const budgetSchema = new Schema<IBudget>(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true,
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
    overallCap: {
      type: Number,
      required: true,
      min: 0,
    },
    projectAllocations: [
      {
        projectId: {
          type: Schema.Types.ObjectId,
          ref: 'Project',
          required: true,
        },
        projectName: {
          type: String,
          required: true,
        },
        amount: {
          type: Number,
          required: true,
          min: 0,
        },
        metaAds: {
          type: Number,
          default: 0,
        },
        googleAds: {
          type: Number,
          default: 0,
        },
        linkedinAds: {
          type: Number,
          default: 0,
        },
        directWhatsapp: {
          type: Number,
          default: 0,
        },
      },
    ],
    currency: {
      type: String,
      default: 'INR',
    },
  },
  {
    timestamps: true,
  }
);

// Unique compound index: unique budget per organization per month per year
budgetSchema.index({ organizationId: 1, month: 1, year: 1 }, { unique: true });

export const Budget = model<IBudget>('Budget', budgetSchema);
