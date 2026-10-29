import { Schema, model, Document, Types } from 'mongoose';

export interface IApprovalComment {
  authorId?: Types.ObjectId;
  authorName: string;
  text: string;
  createdAt: Date;
}

export interface IApproval extends Document {
  organizationId: Types.ObjectId;
  entityType?: 'PLAN' | 'CREATIVE' | 'PLAN_ITEM';
  creativeId?: Types.ObjectId;
  planId?: Types.ObjectId;
  planItemId?: Types.ObjectId;
  title?: string;
  status: 'PENDING' | 'APPROVED' | 'CHANGES_REQUESTED';
  factChecklist: {
    priceVerified: boolean;
    bedroomsVerified: boolean;
    amenitiesVerified: boolean;
    ctaVerified: boolean;
    reraDisclaimerVerified?: boolean;
  };
  comments: IApprovalComment[];
  decidedBy?: Types.ObjectId;
  decidedByName?: string;
  decidedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const approvalSchema = new Schema<IApproval>(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true,
    },
    entityType: {
      type: String,
      enum: ['PLAN', 'CREATIVE', 'PLAN_ITEM'],
      default: 'PLAN',
      index: true,
    },
    creativeId: {
      type: Schema.Types.ObjectId,
      ref: 'Creative',
      index: true,
    },
    planId: {
      type: Schema.Types.ObjectId,
      ref: 'Plan',
      index: true,
    },
    planItemId: {
      type: Schema.Types.ObjectId,
      ref: 'PlanItem',
      index: true,
    },
    title: {
      type: String,
      default: '',
    },
    status: {
      type: String,
      enum: ['PENDING', 'APPROVED', 'CHANGES_REQUESTED'],
      default: 'PENDING',
      index: true,
    },
    factChecklist: {
      priceVerified: { type: Boolean, default: false },
      bedroomsVerified: { type: Boolean, default: false },
      amenitiesVerified: { type: Boolean, default: false },
      ctaVerified: { type: Boolean, default: false },
      reraDisclaimerVerified: { type: Boolean, default: false },
    },
    comments: [
      {
        authorId: { type: Schema.Types.ObjectId, ref: 'User' },
        authorName: { type: String, required: true },
        text: { type: String, required: true },
        createdAt: { type: Date, default: Date.now },
      },
    ],
    decidedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
    decidedByName: {
      type: String,
    },
    decidedAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
  }
);

approvalSchema.index({ organizationId: 1, status: 1 });

export const Approval = model<IApproval>('Approval', approvalSchema);
