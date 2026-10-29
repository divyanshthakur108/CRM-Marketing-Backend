import { Schema, model, Document, Types } from 'mongoose';

export type CampaignObjective = 'LEAD_GEN' | 'SITE_VISIT' | 'AWARENESS' | 'CONVERSIONS';
export type CampaignStatus = 'ACTIVE' | 'PAUSED' | 'LEARNING' | 'COMPLETED';
export type PaidAdStep = 'CAMPAIGN' | 'AD_SET' | 'CREATIVE' | 'AD';

export interface ICampaignMetrics {
  impressions: number;
  clicks: number;
  leads: number;
  spend: number;
  cpl?: number;
  ctr?: string;
  roas?: string;
}

export interface ICampaign extends Document {
  organizationId: Types.ObjectId;
  projectId: Types.ObjectId;
  planItemId?: Types.ObjectId;
  creativeId?: Types.ObjectId;
  metaCampaignId?: string;
  metaAdSetId?: string;
  metaCreativeId?: string;
  metaAdId?: string;
  name: string;
  objective: CampaignObjective;
  dailyBudget: number;
  totalSpend: number;
  status: CampaignStatus;
  completedSteps: PaidAdStep[];
  specialAdCategories: string[];
  targeting?: Record<string, unknown>;
  needsAction: boolean;
  lastErrorStep?: string;
  lastErrorMessage?: string;
  jobId?: Types.ObjectId;
  metrics: ICampaignMetrics;
  createdAt: Date;
  updatedAt: Date;
}

const campaignSchema = new Schema<ICampaign>(
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
    planItemId: {
      type: Schema.Types.ObjectId,
      ref: 'PlanItem',
      index: true,
    },
    creativeId: {
      type: Schema.Types.ObjectId,
      ref: 'Creative',
      index: true,
    },
    metaCampaignId: {
      type: String,
      trim: true,
    },
    metaAdSetId: {
      type: String,
      trim: true,
    },
    metaCreativeId: {
      type: String,
      trim: true,
    },
    metaAdId: {
      type: String,
      trim: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    objective: {
      type: String,
      enum: ['LEAD_GEN', 'SITE_VISIT', 'AWARENESS', 'CONVERSIONS'],
      default: 'LEAD_GEN',
    },
    dailyBudget: {
      type: Number,
      required: true,
      min: 0,
    },
    totalSpend: {
      type: Number,
      default: 0,
    },
    status: {
      type: String,
      enum: ['ACTIVE', 'PAUSED', 'LEARNING', 'COMPLETED'],
      default: 'PAUSED',
      index: true,
    },
    completedSteps: {
      type: [String],
      enum: ['CAMPAIGN', 'AD_SET', 'CREATIVE', 'AD'],
      default: [],
    },
    specialAdCategories: {
      type: [String],
      default: ['HOUSING'],
    },
    targeting: {
      type: Schema.Types.Mixed,
      default: {},
    },
    needsAction: {
      type: Boolean,
      default: false,
      index: true,
    },
    lastErrorStep: {
      type: String,
    },
    lastErrorMessage: {
      type: String,
    },
    jobId: {
      type: Schema.Types.ObjectId,
      ref: 'Job',
    },
    metrics: {
      impressions: { type: Number, default: 0 },
      clicks: { type: Number, default: 0 },
      leads: { type: Number, default: 0 },
      spend: { type: Number, default: 0 },
      cpl: { type: Number, default: 0 },
      ctr: { type: String, default: '0%' },
      roas: { type: String, default: '0x' },
    },
  },
  {
    timestamps: true,
  }
);

campaignSchema.index({ organizationId: 1, status: 1 });
campaignSchema.index({ organizationId: 1, projectId: 1 });
campaignSchema.index({ organizationId: 1, needsAction: 1 });

export const Campaign = model<ICampaign>('Campaign', campaignSchema);
