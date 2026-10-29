import { Schema, model, Document, Types } from 'mongoose';

export type RoleType =
  | 'platform_admin'
  | 'org_owner'
  | 'marketing_manager'
  | 'creative_contributor'
  | 'client_approver'
  | 'sales_agent'
  | 'viewer'
  | 'OWNER'
  | 'ADMIN'
  | 'MARKETING_MANAGER'
  | 'SALES_AGENT'
  | 'CREATIVE_EDITOR'
  | 'VIEWER';

export interface IMembership extends Document {
  organizationId: Types.ObjectId;
  userId: Types.ObjectId;
  role: RoleType;
  status: 'ACTIVE' | 'INACTIVE';
  assignedProjects: Types.ObjectId[];
  createdAt: Date;
  updatedAt: Date;
}

const membershipSchema = new Schema<IMembership>(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
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
      default: 'viewer',
    },
    status: {
      type: String,
      enum: ['ACTIVE', 'INACTIVE'],
      default: 'ACTIVE',
    },
    assignedProjects: [
      {
        type: Schema.Types.ObjectId,
        ref: 'Project',
      },
    ],
  },
  {
    timestamps: true,
  }
);

// Compound unique index ensuring one membership record per user per organization
membershipSchema.index({ organizationId: 1, userId: 1 }, { unique: true });

export const Membership = model<IMembership>('Membership', membershipSchema);
