import { Schema, model, Document } from 'mongoose';

export interface IDemoRequest extends Document {
  name: string;
  email: string;
  phone: string;
  company: string;
  teamSize: string;
  source: string;
  status: 'New' | 'Contacted' | 'Scheduled' | 'Closed';
  adminNotified: boolean;
  customerConfirmed: boolean;
  notificationError?: string;
  ipAddress?: string;
  userAgent?: string;
  createdAt: Date;
  updatedAt: Date;
}

const demoRequestSchema = new Schema<IDemoRequest>(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      index: true,
    },
    phone: {
      type: String,
      required: true,
      trim: true,
    },
    company: {
      type: String,
      required: true,
      trim: true,
    },
    teamSize: {
      type: String,
      required: true,
      trim: true,
    },
    source: {
      type: String,
      default: 'Website Demo Request',
    },
    status: {
      type: String,
      enum: ['New', 'Contacted', 'Scheduled', 'Closed'],
      default: 'New',
      index: true,
    },
    adminNotified: {
      type: Boolean,
      default: false,
    },
    customerConfirmed: {
      type: Boolean,
      default: false,
    },
    notificationError: {
      type: String,
    },
    ipAddress: {
      type: String,
    },
    userAgent: {
      type: String,
    },
  },
  {
    timestamps: true,
  }
);

// Compound index to help query recent submissions from same email
demoRequestSchema.index({ email: 1, createdAt: -1 });

export const DemoRequest = model<IDemoRequest>('DemoRequest', demoRequestSchema);

