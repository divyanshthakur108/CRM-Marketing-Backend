import { Schema, model, Document, Types } from 'mongoose';
import { RoleType } from './Membership.js';

export interface IInvitation extends Document {
  organizationId: Types.ObjectId;
  email: string;
  role: RoleType;
  token?: string;
  tokenHash?: string;
  invitedBy?: Types.ObjectId;
  status: 'PENDING' | 'ACCEPTED' | 'REVOKED' | 'EXPIRED';
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const invitationSchema = new Schema<IInvitation>(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true,
    },
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
    role: {
      type: String,
      enum: [
        'platform_admin',
        'org_owner',
        'marketing_manager',
        'creative_contributor',
        'client_approver',
        'sales_agent',
        'viewer',
        'OWNER',
        'ADMIN',
        'MARKETING_MANAGER',
        'SALES_AGENT',
        'CREATIVE_EDITOR',
        'VIEWER',
      ],
      required: true,
    },
    token: {
      type: String,
      required: false,
      unique: true,
    },
    tokenHash: {
      type: String,
      required: false,
      index: true,
    },
    invitedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: false,
    },
    status: {
      type: String,
      enum: ['PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED'],
      default: 'PENDING',
    },
    expiresAt: {
      type: Date,
      required: true,
      index: { expireAfterSeconds: 0 }, // MongoDB TTL auto-cleanup
    },
  },
  {
    timestamps: true,
  }
);

invitationSchema.index({ organizationId: 1, email: 1 });

export const Invitation = model<IInvitation>('Invitation', invitationSchema);
