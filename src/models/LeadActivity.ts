import { Schema, model, Document, Types } from 'mongoose';

export type ActivityType =
  | 'STAGE_PROGRESSION'
  | 'CALL_LOG'
  | 'AGENT_NOTE'
  | 'WHATSAPP_MESSAGE'
  | 'SITE_VISIT_BOOKED'
  | 'INBOUND_SUBMISSION'
  | 'ASSIGNMENT';

export interface ILeadActivity extends Document {
  organizationId: Types.ObjectId;
  leadId: Types.ObjectId;
  authorId?: Types.ObjectId;
  authorName: string;
  type: ActivityType;
  summary: string;
  details: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

const leadActivitySchema = new Schema<ILeadActivity>(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true,
    },
    leadId: {
      type: Schema.Types.ObjectId,
      ref: 'Lead',
      required: true,
      index: true,
    },
    authorId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
    authorName: {
      type: String,
      required: true,
      default: 'Sales Agent',
    },
    type: {
      type: String,
      enum: [
        'STAGE_PROGRESSION',
        'CALL_LOG',
        'AGENT_NOTE',
        'WHATSAPP_MESSAGE',
        'SITE_VISIT_BOOKED',
        'INBOUND_SUBMISSION',
        'ASSIGNMENT',
      ],
      required: true,
    },
    summary: {
      type: String,
      required: true,
    },
    details: {
      type: Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
  }
);

leadActivitySchema.index({ organizationId: 1, leadId: 1, createdAt: -1 });

export const LeadActivity = model<ILeadActivity>('LeadActivity', leadActivitySchema);
