import { Schema, model, Document } from 'mongoose';

export interface IOnboardingData {
  step1?: Record<string, unknown>;
  step2?: Record<string, unknown>;
  step3?: Record<string, unknown>;
  step4?: Record<string, unknown>;
}

export interface IOnboarding {
  status: 'pending' | 'in_progress' | 'completed';
  currentStep: number;
  data: IOnboardingData;
  submittedAt?: Date;
}

export interface IOrganization extends Document {
  name: string;
  slug: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'TRIAL' | 'DISABLED' | 'active' | 'disabled';
  settings: {
    currency: string;
    defaultTimezone: string;
  };
  onboarding: IOnboarding;
  createdAt: Date;
  updatedAt: Date;
}

const organizationSchema = new Schema<IOrganization>(
  {
    name: { type: String, required: true, trim: true },
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    status: {
      type: String,
      enum: ['ACTIVE', 'SUSPENDED', 'TRIAL', 'DISABLED', 'active', 'disabled'],
      default: 'ACTIVE',
    },
    settings: {
      currency: { type: String, default: 'INR' },
      defaultTimezone: { type: String, default: 'Asia/Kolkata' },
    },
    onboarding: {
      status: {
        type: String,
        enum: ['pending', 'in_progress', 'completed'],
        default: 'pending',
      },
      currentStep: {
        type: Number,
        default: 1,
        min: 1,
        max: 4,
      },
      data: {
        type: Schema.Types.Mixed,
        default: {
          step1: {},
          step2: {},
          step3: {},
          step4: {},
        },
      },
      submittedAt: {
        type: Date,
      },
    },
  },
  {
    timestamps: true,
  }
);

export const Organization = model<IOrganization>('Organization', organizationSchema);
