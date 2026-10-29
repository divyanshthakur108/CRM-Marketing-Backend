import { Schema, model, Document, Types } from 'mongoose';

export type PlanItemType =
  | 'POST_4x5'
  | 'REEL_9x16'
  | 'CAROUSEL'
  | 'PAID_AD'
  | 'INSTAGRAM_REEL'
  | 'FACEBOOK_CAROUSEL'
  | 'LINKEDIN_POST'
  | 'WHATSAPP_BROADCAST'
  | 'YOUTUBE_SHORTS'
  | 'PRINT_FLYER';

export type PlanItemChannel =
  | 'INSTAGRAM'
  | 'FACEBOOK'
  | 'BOTH'
  | 'LINKEDIN'
  | 'WHATSAPP'
  | 'YOUTUBE';

export type ApprovalStatus =
  | 'DRAFT'
  | 'PENDING_APPROVAL'
  | 'APPROVED'
  | 'REJECTED'
  | 'CHANGES_REQUESTED';

export type PublishStatus =
  | 'UNSCHEDULED'
  | 'SCHEDULED'
  | 'PUBLISHING'
  | 'PUBLISHED'
  | 'FAILED'
  | 'PAUSED'
  | 'CANCELLED';

export interface IPlanItem extends Document {
  organizationId: Types.ObjectId;
  planId: Types.ObjectId;
  projectId: Types.ObjectId;
  projectName?: string;
  title: string;
  type: PlanItemType;
  channel: PlanItemChannel;
  scheduledDate: Date;
  scheduledTime: string;
  scheduledAt?: Date;
  timezone: string;
  version: number;
  isPaid: boolean;
  proposedBudget?: number;
  topic: string;
  creativeBrief: string;
  copySnippet?: string;
  previewUrl?: string;
  targetAudience?: string;
  ctaText?: string;
  approvalStatus: ApprovalStatus;
  publishStatus: PublishStatus;
  creativeId?: Types.ObjectId;
  externalPostId?: string;
  createdAt: Date;
  updatedAt: Date;
}

const planItemSchema = new Schema<IPlanItem>(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true,
    },
    planId: {
      type: Schema.Types.ObjectId,
      ref: 'Plan',
      required: true,
      index: true,
    },
    projectId: {
      type: Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
      index: true,
    },
    projectName: {
      type: String,
      default: '',
    },
    title: {
      type: String,
      default: '',
    },
    type: {
      type: String,
      enum: [
        'POST_4x5',
        'REEL_9x16',
        'CAROUSEL',
        'PAID_AD',
        'INSTAGRAM_REEL',
        'FACEBOOK_CAROUSEL',
        'LINKEDIN_POST',
        'WHATSAPP_BROADCAST',
        'YOUTUBE_SHORTS',
        'PRINT_FLYER',
      ],
      required: true,
    },
    channel: {
      type: String,
      enum: ['INSTAGRAM', 'FACEBOOK', 'BOTH', 'LINKEDIN', 'WHATSAPP', 'YOUTUBE'],
      default: 'BOTH',
    },
    scheduledDate: {
      type: Date,
      required: true,
      index: true,
    },
    scheduledTime: {
      type: String,
      required: true,
      default: '18:00',
    },
    scheduledAt: {
      type: Date,
    },
    timezone: {
      type: String,
      default: 'Asia/Kolkata',
    },
    version: {
      type: Number,
      default: 1,
    },
    isPaid: {
      type: Boolean,
      default: false,
    },
    proposedBudget: {
      type: Number,
      default: 0,
    },
    topic: {
      type: String,
      required: true,
    },
    creativeBrief: {
      type: String,
      required: true,
    },
    copySnippet: {
      type: String,
      default: '',
    },
    previewUrl: {
      type: String,
      default: '',
    },
    targetAudience: {
      type: String,
      default: '',
    },
    ctaText: {
      type: String,
      default: '',
    },
    approvalStatus: {
      type: String,
      enum: ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'CHANGES_REQUESTED'],
      default: 'DRAFT',
      index: true,
    },
    publishStatus: {
      type: String,
      enum: ['UNSCHEDULED', 'SCHEDULED', 'PUBLISHING', 'PUBLISHED', 'FAILED', 'PAUSED', 'CANCELLED'],
      default: 'UNSCHEDULED',
      index: true,
    },
    creativeId: {
      type: Schema.Types.ObjectId,
      ref: 'Creative',
      index: true,
    },
    externalPostId: {
      type: String,
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

planItemSchema.index({ organizationId: 1, scheduledDate: 1 });
planItemSchema.index({ organizationId: 1, publishStatus: 1 });
planItemSchema.index({ organizationId: 1, approvalStatus: 1 });

export const PlanItem = model<IPlanItem>('PlanItem', planItemSchema);
