import { Schema, model, Document, Types } from 'mongoose';

export type PostPlatform = 'FACEBOOK' | 'INSTAGRAM' | 'BOTH';
export type PublishedStatus = 'PUBLISHED' | 'FAILED' | 'RETRYING';

export interface IPublishedPost extends Document {
  organizationId: Types.ObjectId;
  planItemId?: Types.ObjectId;
  projectId?: Types.ObjectId;
  platform: PostPlatform;
  metaPostId?: string;
  postUrl?: string;
  caption: string;
  status: PublishedStatus;
  publishedAt?: Date;
  errorMessage?: string;
  retryCount: number;
  createdAt: Date;
  updatedAt: Date;
}

const publishedPostSchema = new Schema<IPublishedPost>(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true,
    },
    planItemId: {
      type: Schema.Types.ObjectId,
      ref: 'PlanItem',
      index: true,
    },
    projectId: {
      type: Schema.Types.ObjectId,
      ref: 'Project',
      index: true,
    },
    platform: {
      type: String,
      enum: ['FACEBOOK', 'INSTAGRAM', 'BOTH'],
      default: 'BOTH',
    },
    metaPostId: {
      type: String,
    },
    postUrl: {
      type: String,
    },
    caption: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      enum: ['PUBLISHED', 'FAILED', 'RETRYING'],
      default: 'PUBLISHED',
      index: true,
    },
    publishedAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    errorMessage: {
      type: String,
    },
    retryCount: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);

publishedPostSchema.index({ organizationId: 1, publishedAt: -1 });

export const PublishedPost = model<IPublishedPost>('PublishedPost', publishedPostSchema);
