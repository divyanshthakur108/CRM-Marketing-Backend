import { Schema, model, Document, Types } from 'mongoose';

export type NotificationCategory =
  | 'RERA_COMPLIANCE'
  | 'LEAD_INBOUND'
  | 'BUDGET_ALERT'
  | 'APPROVAL_REQUIRED'
  | 'SYSTEM';

export interface INotification extends Document {
  organizationId: Types.ObjectId;
  userId?: Types.ObjectId;
  title: string;
  message: string;
  category: NotificationCategory;
  read: boolean;
  link?: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

const notificationSchema = new Schema<INotification>(
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
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    message: {
      type: String,
      required: true,
    },
    category: {
      type: String,
      enum: [
        'RERA_COMPLIANCE',
        'LEAD_INBOUND',
        'BUDGET_ALERT',
        'APPROVAL_REQUIRED',
        'SYSTEM',
      ],
      default: 'SYSTEM',
    },
    read: {
      type: Boolean,
      default: false,
      index: true,
    },
    link: {
      type: String,
    },
    metadata: {
      type: Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
  }
);

notificationSchema.index({ organizationId: 1, read: 1 });
notificationSchema.index({ organizationId: 1, createdAt: -1 });

export const Notification = model<INotification>('Notification', notificationSchema);
