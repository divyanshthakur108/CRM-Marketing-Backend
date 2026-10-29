import { Schema, model, Document, Types } from 'mongoose';

export interface IRefreshToken extends Document {
  organizationId?: Types.ObjectId;
  userId: Types.ObjectId;
  token: string;
  deviceInfo?: string;
  isRevoked: boolean;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const refreshTokenSchema = new Schema<IRefreshToken>(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: 'Organization',
      required: false,
      index: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    token: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    deviceInfo: {
      type: String,
    },
    isRevoked: {
      type: Boolean,
      default: false,
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

refreshTokenSchema.index({ userId: 1, isRevoked: 1 });

export const RefreshToken = model<IRefreshToken>('RefreshToken', refreshTokenSchema);
