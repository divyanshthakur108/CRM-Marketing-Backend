import { Schema, model, Document, Types } from 'mongoose';

export type LeadStage =
  | 'New'
  | 'Contacted'
  | 'Qualified'
  | 'Visit scheduled'
  | 'Visit done'
  | 'Negotiation'
  | 'Won/Lost';

export type LeadSource = 'META_AD' | 'WHATSAPP' | 'DIRECT' | 'PORTAL' | 'MANUAL';

export interface ILead extends Document {
  organizationId: Types.ObjectId;
  dedupeKey: string;
  name: string;
  phone: string;
  email?: string;
  projectId?: Types.ObjectId;
  projectName?: string;
  budget?: number;
  budgetDisplay?: string;
  stage: LeadStage;
  assignedTo?: Types.ObjectId;
  assignedAgentName?: string;
  source: LeadSource;
  metaLeadId?: string;
  lastContactedAt?: Date;
  notes?: string;
  consentGiven: boolean;
  consentTimestamp?: Date;
  consentSource?: string;
  tags?: string[];
  createdAt: Date;
  updatedAt: Date;
}

export function normalizePhone(rawPhone?: string): string {
  if (!rawPhone) return '';
  // Keep digits and leading + if present
  const cleaned = rawPhone.replace(/[^\d+]/g, '').trim();
  return cleaned;
}

export function normalizeEmail(rawEmail?: string): string {
  if (!rawEmail) return '';
  return rawEmail.toLowerCase().trim();
}

export function computeLeadDedupeKey(phone?: string, email?: string): string {
  const normPhone = normalizePhone(phone);
  const normEmail = normalizeEmail(email);

  if (normPhone) {
    return `phone:${normPhone}`;
  }
  if (normEmail) {
    return `email:${normEmail}`;
  }
  throw new Error('Lead requires at least a valid phone number or email to compute dedupeKey');
}

const leadSchema = new Schema<ILead>(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true,
    },
    dedupeKey: {
      type: String,
      required: true,
      trim: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    phone: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      lowercase: true,
      trim: true,
    },
    projectId: {
      type: Schema.Types.ObjectId,
      ref: 'Project',
      index: true,
    },
    projectName: {
      type: String,
    },
    budget: {
      type: Number,
    },
    budgetDisplay: {
      type: String,
    },
    stage: {
      type: String,
      enum: [
        'New',
        'Contacted',
        'Qualified',
        'Visit scheduled',
        'Visit done',
        'Negotiation',
        'Won/Lost',
      ],
      default: 'New',
      index: true,
    },
    assignedTo: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      index: true,
    },
    assignedAgentName: {
      type: String,
    },
    source: {
      type: String,
      enum: ['META_AD', 'WHATSAPP', 'DIRECT', 'PORTAL', 'MANUAL'],
      default: 'DIRECT',
    },
    metaLeadId: {
      type: String,
    },
    lastContactedAt: {
      type: Date,
    },
    notes: {
      type: String,
    },
    consentGiven: {
      type: Boolean,
      default: true,
    },
    consentTimestamp: {
      type: Date,
      default: Date.now,
    },
    consentSource: {
      type: String,
      default: 'DIRECT_FORM',
    },
    tags: {
      type: [String],
      default: [],
    },
  },
  {
    timestamps: true,
  }
);

// Unique dedupeKey per organization prevents duplicate lead creation
leadSchema.index({ organizationId: 1, dedupeKey: 1 }, { unique: true });
leadSchema.index({ organizationId: 1, stage: 1 });
leadSchema.index({ organizationId: 1, assignedTo: 1 });

export const Lead = model<ILead>('Lead', leadSchema);
