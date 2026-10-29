import { Schema, model, Document, Types } from 'mongoose';

export interface IMetaConnection extends Document {
  organizationId: Types.ObjectId;
  facebookPage: {
    pageId: string;
    pageName: string;
    accessToken?: string;
    connected: boolean;
  };
  instagramAccount: {
    accountId: string;
    handle: string;
    connected: boolean;
  };
  adAccount: {
    accountId: string;
    name: string;
    currency: string;
    connected: boolean;
  };
  systemUserActive: boolean;
  tokenExpiresAt?: Date;
  webhookSecret?: string;
  createdAt: Date;
  updatedAt: Date;
}

const metaConnectionSchema = new Schema<IMetaConnection>(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      unique: true,
      index: true,
    },
    facebookPage: {
      pageId: { type: String, default: '' },
      pageName: { type: String, default: '' },
      accessToken: { type: String },
      connected: { type: Boolean, default: false },
    },
    instagramAccount: {
      accountId: { type: String, default: '' },
      handle: { type: String, default: '' },
      connected: { type: Boolean, default: false },
    },
    adAccount: {
      accountId: { type: String, default: '' },
      name: { type: String, default: '' },
      currency: { type: String, default: 'INR' },
      connected: { type: Boolean, default: false },
    },
    systemUserActive: {
      type: Boolean,
      default: false,
    },
    tokenExpiresAt: {
      type: Date,
    },
    webhookSecret: {
      type: String,
    },
  },
  {
    timestamps: true,
  }
);

export const MetaConnection = model<IMetaConnection>('MetaConnection', metaConnectionSchema);
