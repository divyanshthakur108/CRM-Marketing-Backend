import mongoose, { Schema, Document, Types } from 'mongoose';
import type { ImageKnowledge, ProjectBrief, VideoKnowledge } from './knowledge.js';

/**
 * Creative Lab (admin POC): a test project described in plain text, plus the photos and videos
 * uploaded for it. Each file gets a "knowledge card": what the AI understood from it, saved once
 * so later steps (planner, generators) can read text instead of re-watching the media.
 *
 * Test data lives in its OWN database (CREATIVE_LAB_DB, default "realcrm_creative_lab") on the same
 * MongoDB cluster, so it never mixes with the app's real projects and media.
 */

export const CREATIVE_LAB_DB = process.env.CREATIVE_LAB_DB || 'realcrm_creative_lab';
const labDb = mongoose.connection.useDb(CREATIVE_LAB_DB, { useCache: true });

export type BriefStatus = 'PENDING' | 'DONE' | 'FAILED';
export type AssetStatus = 'QUEUED' | 'ANALYZING' | 'DONE' | 'FAILED';
export type AssetKind = 'image' | 'video';

export interface ICreativeLabProject extends Document {
  createdBy: Types.ObjectId;
  name: string;
  /** What the tester typed about the project (size, location, price, amenities, ...) */
  infoText: string;
  briefStatus: BriefStatus;
  /** Facts the AI pulled out of infoText (only what was written) */
  brief?: ProjectBrief;
  briefError?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface AnalysisStep {
  name: string;
  ms: number;
}

export interface ICreativeLabAsset extends Document {
  projectId: Types.ObjectId;
  createdBy: Types.ObjectId;
  kind: AssetKind;
  key: string;
  url: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  width?: number;
  height?: number;
  durationSeconds?: number;
  hasAudio?: boolean;
  /** Small preview image (data URL) for the list */
  previewThumb?: string;
  status: AssetStatus;
  knowledge?: ImageKnowledge | VideoKnowledge;
  /** Knowledge copied from an identical file analyzed before (no Gemini request used) */
  reusedFromAssetId?: Types.ObjectId;
  aiModel?: string;
  steps: AnalysisStep[];
  error?: string;
  analysisMs?: number;
  startedAt?: Date;
  finishedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const projectSchema = new Schema<ICreativeLabProject>(
  {
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    infoText: { type: String, default: '', maxlength: 8000 },
    briefStatus: { type: String, enum: ['PENDING', 'DONE', 'FAILED'], default: 'PENDING' },
    brief: { type: Schema.Types.Mixed },
    briefError: String,
  },
  { timestamps: true }
);
projectSchema.index({ createdAt: -1 });

const stepSchema = new Schema<AnalysisStep>(
  { name: { type: String, required: true }, ms: { type: Number, default: 0 } },
  { _id: false }
);

const assetSchema = new Schema<ICreativeLabAsset>(
  {
    projectId: { type: Schema.Types.ObjectId, ref: 'CreativeLabProject', required: true, index: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    kind: { type: String, enum: ['image', 'video'], required: true },
    key: { type: String, required: true },
    url: { type: String, required: true },
    filename: { type: String, required: true },
    mimeType: { type: String, required: true },
    sizeBytes: { type: Number, required: true },
    sha256: { type: String, required: true, index: true },
    width: Number,
    height: Number,
    durationSeconds: Number,
    hasAudio: Boolean,
    previewThumb: String,
    status: { type: String, enum: ['QUEUED', 'ANALYZING', 'DONE', 'FAILED'], default: 'QUEUED', index: true },
    knowledge: { type: Schema.Types.Mixed },
    reusedFromAssetId: { type: Schema.Types.ObjectId, ref: 'CreativeLabAsset' },
    aiModel: String,
    steps: { type: [stepSchema], default: [] },
    error: String,
    analysisMs: Number,
    startedAt: Date,
    finishedAt: Date,
  },
  { timestamps: true }
);
assetSchema.index({ projectId: 1, createdAt: 1 });

export const CreativeLabProject = labDb.model<ICreativeLabProject>('CreativeLabProject', projectSchema);
export const CreativeLabAsset = labDb.model<ICreativeLabAsset>('CreativeLabAsset', assetSchema);
