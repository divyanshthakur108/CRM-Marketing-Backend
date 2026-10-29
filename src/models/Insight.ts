import { Schema, model, Document, Types } from 'mongoose';

export type InsightStatus = 'SYNCED' | 'DELAYED' | 'MISSING';
export type InsightChannel = 'META_PAID' | 'META_ORGANIC' | 'GOOGLE_ADS' | 'PRINT';

export interface IInsight extends Document {
  organizationId: Types.ObjectId;
  projectId?: Types.ObjectId;
  campaignId?: Types.ObjectId;
  date: Date;
  channel: InsightChannel;
  status: InsightStatus;
  missingFields?: string[];
  impressions: number;
  reach: number;
  clicks: number;
  leads: number;
  spend: number;
  ctr: number;
  cpl: number;
  roas: number;
  createdAt: Date;
  updatedAt: Date;
}

const insightSchema = new Schema<IInsight>(
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
    campaignId: {
      type: Schema.Types.ObjectId,
      ref: 'Campaign',
      index: true,
    },
    date: {
      type: Date,
      required: true,
      index: true,
    },
    channel: {
      type: String,
      enum: ['META_PAID', 'META_ORGANIC', 'GOOGLE_ADS', 'PRINT'],
      default: 'META_PAID',
    },
    status: {
      type: String,
      enum: ['SYNCED', 'DELAYED', 'MISSING'],
      default: 'SYNCED',
    },
    missingFields: {
      type: [String],
      default: [],
    },
    impressions: { type: Number, default: 0 },
    reach: { type: Number, default: 0 },
    clicks: { type: Number, default: 0 },
    leads: { type: Number, default: 0 },
    spend: { type: Number, default: 0 },
    ctr: { type: Number, default: 0 },
    cpl: { type: Number, default: 0 },
    roas: { type: Number, default: 0 },
  },
  {
    timestamps: true,
  }
);

insightSchema.index({ organizationId: 1, date: -1 });
insightSchema.index({ organizationId: 1, projectId: 1, date: -1 });

export const Insight = model<IInsight>('Insight', insightSchema);
