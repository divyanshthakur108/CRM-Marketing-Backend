import { Schema, model, Document, Types } from 'mongoose';

export type CreditType = 'IMAGE_RENDER' | 'VIDEO_REEL' | 'AI_COPY' | 'META_API_CALL';

export interface IUsageLedger extends Document {
  organizationId: Types.ObjectId;
  creditType: CreditType;
  amount: number;
  balanceAfter: number;
  description: string;
  referenceId?: string;
  aiModel?: string;
  units?: number;
  estimatedCostUsd?: number;
  actualCostUsd?: number;
  jobId?: string;
  status?: 'RESERVED' | 'DEDUCTED' | 'RELEASED';
  idempotencyKey?: string;
  createdAt: Date;
  updatedAt: Date;
}

const usageLedgerSchema = new Schema<IUsageLedger>(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true,
    },
    creditType: {
      type: String,
      enum: ['IMAGE_RENDER', 'VIDEO_REEL', 'AI_COPY', 'META_API_CALL'],
      required: true,
      index: true,
    },
    amount: {
      type: Number,
      required: true,
    },
    balanceAfter: {
      type: Number,
      required: true,
    },
    description: {
      type: String,
      required: true,
    },
    referenceId: {
      type: String,
    },
    aiModel: {
      type: String,
    },
    units: {
      type: Number,
    },
    estimatedCostUsd: {
      type: Number,
    },
    actualCostUsd: {
      type: Number,
    },
    jobId: {
      type: String,
      index: true,
    },
    status: {
      type: String,
      enum: ['RESERVED', 'DEDUCTED', 'RELEASED'],
      default: 'DEDUCTED',
    },
    idempotencyKey: {
      type: String,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

usageLedgerSchema.index({ organizationId: 1, createdAt: -1 });

export const UsageLedger = model<IUsageLedger>('UsageLedger', usageLedgerSchema);
