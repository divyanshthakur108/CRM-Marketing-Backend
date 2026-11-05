import { Schema, model, Document, Types } from 'mongoose';
import type { EditRecipe, LabInput } from './recipe.js';
import type { RenderStep } from './ffmpegRenderer.js';

export type LabRenderStatus = 'QUEUED' | 'RENDERING' | 'DONE' | 'FAILED';

/** One Video Lab render (admin testing only; not linked to any organization) */
export interface IVideoLabRender extends Document {
  createdBy: Types.ObjectId;
  batchId: string;
  engine: 'ffmpeg';
  status: LabRenderStatus;
  input: LabInput;
  recipe: EditRecipe;
  outputKey?: string;
  outputUrl?: string;
  posterUrl?: string;
  durationSeconds?: number;
  steps: RenderStep[];
  error?: string;
  renderMs?: number;
  startedAt?: Date;
  finishedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const stepSchema = new Schema<RenderStep>(
  { name: { type: String, required: true }, ms: { type: Number, default: 0 }, command: { type: String } },
  { _id: false }
);

const videoLabRenderSchema = new Schema<IVideoLabRender>(
  {
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    batchId: { type: String, required: true, index: true },
    engine: { type: String, enum: ['ffmpeg'], default: 'ffmpeg' },
    status: { type: String, enum: ['QUEUED', 'RENDERING', 'DONE', 'FAILED'], default: 'QUEUED', index: true },
    input: { type: Schema.Types.Mixed, required: true },
    recipe: { type: Schema.Types.Mixed, required: true },
    outputKey: String,
    outputUrl: String,
    posterUrl: String,
    durationSeconds: Number,
    steps: { type: [stepSchema], default: [] },
    error: String,
    renderMs: Number,
    startedAt: Date,
    finishedAt: Date,
  },
  { timestamps: true }
);

videoLabRenderSchema.index({ createdAt: -1 });

export const VideoLabRender = model<IVideoLabRender>('VideoLabRender', videoLabRenderSchema);
