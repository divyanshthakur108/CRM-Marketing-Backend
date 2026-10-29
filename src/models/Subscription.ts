import { Schema, model, Document, Types } from 'mongoose';

export type SubscriptionPlan = 'STARTER' | 'GROWTH' | 'ENTERPRISE';
export type SubscriptionStatus = 'ACTIVE' | 'PAST_DUE' | 'CANCELLED' | 'TRIALING';

export interface ISubscription extends Document {
  organizationId: Types.ObjectId;
  plan: SubscriptionPlan;
  status: SubscriptionStatus;
  billingInterval: 'MONTHLY' | 'ANNUAL';
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  creditsAllocated: number;
  creditsRemaining: number;
  createdAt: Date;
  updatedAt: Date;
}

const subscriptionSchema = new Schema<ISubscription>(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      unique: true,
      index: true,
    },
    plan: {
      type: String,
      enum: ['STARTER', 'GROWTH', 'ENTERPRISE'],
      default: 'GROWTH',
    },
    status: {
      type: String,
      enum: ['ACTIVE', 'PAST_DUE', 'CANCELLED', 'TRIALING'],
      default: 'ACTIVE',
      index: true,
    },
    billingInterval: {
      type: String,
      enum: ['MONTHLY', 'ANNUAL'],
      default: 'MONTHLY',
    },
    currentPeriodStart: {
      type: Date,
      default: Date.now,
    },
    currentPeriodEnd: {
      type: Date,
      default: () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
    creditsAllocated: {
      type: Number,
      default: 5000,
    },
    creditsRemaining: {
      type: Number,
      default: 5000,
    },
  },
  {
    timestamps: true,
  }
);

export const Subscription = model<ISubscription>('Subscription', subscriptionSchema);
