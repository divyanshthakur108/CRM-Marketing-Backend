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

/**
 * A finished video made for a test project (e.g. a reel built by the POC scripts in
 * poc/creative-lab/). The file lives in storage (Cloudinary when configured); this record makes it
 * show up on the project's page for every admin, so results made on one machine are visible to all.
 */
export interface ICreativeLabResult extends Document {
  projectId: Types.ObjectId;
  createdBy?: Types.ObjectId;
  title: string;
  /** How it was made and what to check (shown under the player) */
  notes: string;
  /** Which parts are AI-generated (shown as a label, required for honesty) */
  aiDisclosure: string;
  /** Short labels, e.g. "Punjabi voice", "lux captions" */
  tags: string[];
  verdict: 'USE' | 'CHECK' | 'DONT_USE';
  key: string;
  url: string;
  filename: string;
  sizeBytes: number;
  sha256: string;
  width?: number;
  height?: number;
  durationSeconds?: number;
  previewThumb?: string;
  /** "poc-script" (published from a developer machine) or "upload" (added on the page) */
  source: 'poc-script' | 'upload';
  createdAt: Date;
  updatedAt: Date;
}

const resultSchema = new Schema<ICreativeLabResult>(
  {
    projectId: { type: Schema.Types.ObjectId, ref: 'CreativeLabProject', required: true, index: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    title: { type: String, required: true, trim: true, maxlength: 160 },
    notes: { type: String, default: '', maxlength: 2000 },
    aiDisclosure: { type: String, default: '', maxlength: 300 },
    tags: { type: [String], default: [] },
    verdict: { type: String, enum: ['USE', 'CHECK', 'DONT_USE'], default: 'CHECK' },
    key: { type: String, required: true },
    url: { type: String, required: true },
    filename: { type: String, required: true },
    sizeBytes: { type: Number, required: true },
    sha256: { type: String, required: true },
    width: Number,
    height: Number,
    durationSeconds: Number,
    previewThumb: String,
    source: { type: String, enum: ['poc-script', 'upload'], default: 'upload' },
  },
  { timestamps: true }
);
resultSchema.index({ projectId: 1, sha256: 1 }, { unique: true });

export const CreativeLabResult = labDb.model<ICreativeLabResult>('CreativeLabResult', resultSchema);
