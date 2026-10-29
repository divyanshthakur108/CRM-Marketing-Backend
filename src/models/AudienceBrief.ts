import { Schema, model, Document, Types } from 'mongoose';

export interface IAudienceBrief extends Document {
  organizationId: Types.ObjectId;
  projectId?: Types.ObjectId;
  name: string;
  targetPersona: string;
  locations: string[];
  ageRange: {
    min: number;
    max: number;
  };
  incomeBracket: string;
  interests: string[];
  housingAdPolicyAcknowledged: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const audienceBriefSchema = new Schema<IAudienceBrief>(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true,
    },
    projectId: {
      type: Schema.Types.ObjectId,
      ref: 'Project',
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    targetPersona: {
      type: String,
      required: true,
    },
    locations: [
      {
        type: String,
      },
    ],
    ageRange: {
      min: { type: Number, default: 30 },
      max: { type: Number, default: 65 },
    },
    incomeBracket: {
      type: String,
      default: 'Top 1% HNIs / Enterprise Directors',
    },
    interests: [
      {
        type: String,
      },
    ],
    housingAdPolicyAcknowledged: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

audienceBriefSchema.index({ organizationId: 1, name: 1 });

export const AudienceBrief = model<IAudienceBrief>('AudienceBrief', audienceBriefSchema);
