import { Schema, model, Document, Types } from 'mongoose';

export interface IBrandProfile extends Document {
  organizationId: Types.ObjectId;
  logoUrl?: string;
  watermarkUrl?: string;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  tone: string;
  supportedLanguages: ('English' | 'Hindi' | 'Hinglish')[];
  defaultDisclaimer: string;
  createdAt: Date;
  updatedAt: Date;
}

const brandProfileSchema = new Schema<IBrandProfile>(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      unique: true,
      index: true,
    },
    logoUrl: {
      type: String,
    },
    watermarkUrl: {
      type: String,
    },
    primaryColor: {
      type: String,
      default: '#000000',
    },
    secondaryColor: {
      type: String,
      default: '#525252',
    },
    accentColor: {
      type: String,
      default: '#D4AF37', // Gold accent for luxury real estate
    },
    tone: {
      type: String,
      default: 'Ultra Luxury, Exclusive, Sophisticated',
    },
    supportedLanguages: [
      {
        type: String,
        enum: ['English', 'Hindi', 'Hinglish'],
        default: 'English',
      },
    ],
    defaultDisclaimer: {
      type: String,
      default:
        'All images and specifications are artistic impressions. Prices subject to change without prior notice. Subject to State RERA conditions.',
    },
  },
  {
    timestamps: true,
  }
);

export const BrandProfile = model<IBrandProfile>('BrandProfile', brandProfileSchema);
