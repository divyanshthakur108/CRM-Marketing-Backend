import { Schema, model, Document, Types } from 'mongoose';

export type JobType =
  | 'RENDER_IMAGE'
  | 'RENDER_VIDEO'
  | 'GENERATE_CREATIVE'
  | 'GENERATE_CREATIVE_SET'
  | 'GENERATE_CAPTION'
  | 'PUBLISH_META'
  | 'PUBLISH_ORGANIC'
  | 'PUBLISH_PAID_AD'
  | 'POLL_ANALYTICS'
  | 'APPOINTMENT_REMINDER'
  | 'WHATSAPP_FOLLOWUP';
export type JobStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';

export interface IJob extends Document {
  organizationId: Types.ObjectId;
  idempotencyKey: string;
  queueName: string;
  jobType: JobType;
  status: JobStatus;
  payload: Record<string, unknown>;
  result?: Record<string, unknown>;
  errorMessage?: string;
  attempts: number;
  maxAttempts: number;
  nextRunAt?: Date;
  startedAt?: Date;
  completedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const jobSchema = new Schema<IJob>(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true,
    },
    idempotencyKey: {
      type: String,
      required: true,
      trim: true,
    },
    queueName: {
      type: String,
      required: true,
      default: 'media-rendering',
    },
    jobType: {
      type: String,
      enum: [
        'RENDER_IMAGE',
        'RENDER_VIDEO',
        'GENERATE_CREATIVE',
        'GENERATE_CREATIVE_SET',
        'GENERATE_CAPTION',
        'PUBLISH_META',
        'PUBLISH_ORGANIC',
        'PUBLISH_PAID_AD',
        'POLL_ANALYTICS',
        'APPOINTMENT_REMINDER',
        'WHATSAPP_FOLLOWUP',
      ],
      required: true,
    },
    status: {
      type: String,
      enum: ['PENDING', 'RUNNING', 'COMPLETED', 'FAILED'],
      default: 'PENDING',
      index: true,
    },
    payload: {
      type: Schema.Types.Mixed,
      default: {},
    },
    result: {
      type: Schema.Types.Mixed,
    },
    errorMessage: {
      type: String,
    },
    attempts: {
      type: Number,
      default: 0,
    },
    maxAttempts: {
      type: Number,
      default: 3,
    },
    nextRunAt: {
      type: Date,
      index: true,
    },
    startedAt: {
      type: Date,
    },
    completedAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
  }
);

// Unique idempotency key per organization prevents duplicate queue dispatches
jobSchema.index({ organizationId: 1, idempotencyKey: 1 }, { unique: true });
jobSchema.index({ organizationId: 1, status: 1 });

export const Job = model<IJob>('Job', jobSchema);
