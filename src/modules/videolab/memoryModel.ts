import mongoose, { Schema, model, Document, Types } from 'mongoose';
import { CURRENT_ANALYZER_VERSION } from './cacheModel.js';
import type { ClipAnalysis } from './analyze.js';
import type { EditRecipe, LabInput } from './recipe.js';
import { logger } from '../../config/logger.js';

export type ContentItemKind = 'REEL' | 'VIDEO' | 'PHOTO' | 'CLIP';
export type ActualOrIllustrative = 'ACTUAL' | 'ILLUSTRATIVE';

export interface IContentItem extends Document {
  organizationId?: Types.ObjectId;
  projectId?: Types.ObjectId;
  kind: ContentItemKind;
  sourceKey: string;
  renderId?: Types.ObjectId;
  language?: string;
  contentType?: string;
  hook?: string;
  captionText?: string;
  summary?: string;
  rooms: string[];
  features: string[];
  actualOrIllustrative: ActualOrIllustrative;
  consentOk: boolean;
  analyzerVersion?: string;
  analysisSource?: 'gemini' | 'heuristic';
  createdAt: Date;
  updatedAt: Date;
}

const ContentItemSchema = new Schema<IContentItem>(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', index: true },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', index: true },
    kind: {
      type: String,
      required: true,
      enum: ['REEL', 'VIDEO', 'PHOTO', 'CLIP'],
      default: 'CLIP',
    },
    sourceKey: { type: String, required: true, index: true },
    renderId: { type: Schema.Types.ObjectId, ref: 'VideoLabRender' },
    language: { type: String },
    contentType: { type: String },
    hook: { type: String },
    captionText: { type: String },
    summary: { type: String },
    rooms: { type: [String], default: [] },
    features: { type: [String], default: [] },
    actualOrIllustrative: {
      type: String,
      enum: ['ACTUAL', 'ILLUSTRATIVE'],
      default: 'ACTUAL',
    },
    consentOk: { type: Boolean, default: true },
    analyzerVersion: { type: String, default: CURRENT_ANALYZER_VERSION },
    analysisSource: { type: String, enum: ['gemini', 'heuristic'], default: 'gemini' },
  },
  { timestamps: true }
);

ContentItemSchema.index({ organizationId: 1, projectId: 1, rooms: 1 });
ContentItemSchema.index({ summary: 'text', hook: 'text', captionText: 'text' });

export const ContentItem =
  (mongoose.models.ContentItem as mongoose.Model<IContentItem>) ||
  model<IContentItem>('ContentItem', ContentItemSchema);

export interface IShotUsage {
  renderId: Types.ObjectId | string;
  at: Date;
}

export interface IContentShot extends Document {
  organizationId?: Types.ObjectId;
  projectId?: Types.ObjectId;
  itemId: Types.ObjectId;
  clipKey: string;
  start: number;
  end: number;
  room: string;
  features: string[];
  quality: number;
  issues: string[];
  spokenText?: string;
  thumbnailKey?: string;
  thumbnailUrl?: string;
  usedIn: IShotUsage[];
  createdAt: Date;
  updatedAt: Date;
}

const ContentShotSchema = new Schema<IContentShot>(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', index: true },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', index: true },
    itemId: { type: Schema.Types.ObjectId, ref: 'ContentItem', required: true, index: true },
    clipKey: { type: String, required: true, index: true },
    start: { type: Number, required: true },
    end: { type: Number, required: true },
    room: { type: String, required: true, index: true },
    features: { type: [String], default: [] },
    quality: { type: Number, min: 1, max: 5, default: 3 },
    issues: { type: [String], default: [] },
    spokenText: { type: String },
    thumbnailKey: { type: String },
    thumbnailUrl: { type: String },
    usedIn: [
      {
        renderId: { type: Schema.Types.Mixed },
        at: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true }
);

ContentShotSchema.index({ organizationId: 1, projectId: 1, room: 1 });
ContentShotSchema.index({ clipKey: 1, start: 1, end: 1 });
ContentShotSchema.index({ room: 'text', features: 'text', spokenText: 'text' });

export const ContentShot =
  (mongoose.models.ContentShot as mongoose.Model<IContentShot>) ||
  model<IContentShot>('ContentShot', ContentShotSchema);

/**
 * Upserts a ContentItem and associated ContentShot records from a clip analysis.
 * Fully idempotent: running multiple times updates rather than duplicates.
 */
export async function upsertContentFromAnalysis(
  analysis: ClipAnalysis,
  opts?: { organizationId?: Types.ObjectId | string; projectId?: Types.ObjectId | string }
): Promise<IContentItem | null> {
  if (mongoose.connection.readyState !== 1 || !mongoose.connection.db) return null;

  const orgId = opts?.organizationId ? new Types.ObjectId(opts.organizationId) : undefined;
  const projId = opts?.projectId ? new Types.ObjectId(opts.projectId) : undefined;

  const rooms = Array.from(new Set(analysis.shots.map((s) => s.category).filter(Boolean)));
  const features = Array.from(new Set(analysis.shots.map((s) => s.label).filter(Boolean)));

  const query: Record<string, unknown> = {
    sourceKey: analysis.clipKey,
    kind: 'CLIP',
  };
  if (orgId) query.organizationId = orgId;
  if (projId) query.projectId = projId;

  const item = await ContentItem.findOneAndUpdate(
    query,
    {
      $set: {
        organizationId: orgId,
        projectId: projId,
        kind: 'CLIP',
        sourceKey: analysis.clipKey,
        summary: analysis.summary || '',
        rooms,
        features,
        actualOrIllustrative: 'ACTUAL',
        consentOk: true,
        analyzerVersion: CURRENT_ANALYZER_VERSION,
      },
      $setOnInsert: {
        createdAt: new Date(),
      },
    },
    { upsert: true, new: true }
  );

  for (const shot of analysis.shots) {
    const shotQuery: Record<string, unknown> = {
      clipKey: analysis.clipKey,
      start: shot.start,
      end: shot.end,
    };
    if (orgId) shotQuery.organizationId = orgId;

    await ContentShot.findOneAndUpdate(
      shotQuery,
      {
        $set: {
          itemId: item._id,
          organizationId: orgId,
          projectId: projId,
          room: shot.category,
          features: [shot.label].filter(Boolean),
          quality: shot.quality,
          issues: shot.issues || [],
          spokenText: shot.hasSpeech ? shot.reason || '' : '',
          thumbnailUrl: shot.thumbnail,
        },
        $setOnInsert: {
          clipKey: analysis.clipKey,
          start: shot.start,
          end: shot.end,
          usedIn: [],
          createdAt: new Date(),
        },
      },
      { upsert: true, new: true }
    );
  }

  return item;
}

/**
 * Saves a ContentItem for a finished reel render and marks usedIn on each ContentShot used.
 */
export async function recordRenderContentMemory(params: {
  renderId: Types.ObjectId | string;
  recipe: EditRecipe;
  input: LabInput;
  outputKey?: string;
  organizationId?: Types.ObjectId | string;
  projectId?: Types.ObjectId | string;
}): Promise<void> {
  if (mongoose.connection.readyState !== 1 || !mongoose.connection.db) return;

  const orgId = params.organizationId ? new Types.ObjectId(params.organizationId) : undefined;
  const projId = params.projectId ? new Types.ObjectId(params.projectId) : undefined;
  const renderObjId = new Types.ObjectId(params.renderId);

  const cutLabels = (params.recipe.cuts || []).map((c) => c.label).filter(Boolean) as string[];
  const overlayLabels = (params.recipe.overlays || []).map((o) => o.label).filter(Boolean) as string[];
  const allFeatures = Array.from(new Set([...cutLabels, ...overlayLabels]));

  const firstCut = params.recipe.cuts?.[0];
  const hook = params.recipe.captions?.lines?.[0] || firstCut?.label || '';
  const captionText = params.recipe.captions?.lines?.join('\n') || '';

  // 1. Create or upsert ContentItem for this reel
  await ContentItem.findOneAndUpdate(
    { renderId: renderObjId },
    {
      $set: {
        organizationId: orgId,
        projectId: projId,
        kind: 'REEL',
        sourceKey: params.outputKey || `video-lab/renders/${params.renderId}/reel.mp4`,
        renderId: renderObjId,
        language: params.recipe.captions?.language || 'en',
        contentType: 'reel',
        hook,
        captionText,
        summary: `${params.input.facts.projectName} reel (${params.recipe.variant.label})`,
        rooms: allFeatures,
        features: allFeatures,
        actualOrIllustrative: 'ACTUAL',
        consentOk: true,
        analyzerVersion: CURRENT_ANALYZER_VERSION,
      },
      $setOnInsert: {
        createdAt: new Date(),
      },
    },
    { upsert: true }
  );

  // 2. Append usedIn on each ContentShot used (in cuts or overlays)
  const now = new Date();
  const usageTargets: Array<{ key: string; start: number; end: number }> = [];

  for (const cut of params.recipe.cuts || []) {
    usageTargets.push({
      key: cut.key,
      start: cut.start || 0,
      end: cut.end ?? (cut.start + 30),
    });
  }

  for (const ov of params.recipe.overlays || []) {
    usageTargets.push({
      key: ov.source.key,
      start: ov.source.in || 0,
      end: ov.source.out ?? ((ov.source.in || 0) + (ov.end - ov.start)),
    });
  }

  for (const target of usageTargets) {
    // Find shots in the same clip that overlap with the used cut/overlay
    await ContentShot.updateMany(
      {
        clipKey: target.key,
        start: { $lte: target.end },
        end: { $gte: target.start },
        'usedIn.renderId': { $ne: renderObjId },
      },
      {
        $push: {
          usedIn: {
            renderId: renderObjId,
            at: now,
          },
        },
      }
    );
  }
}
