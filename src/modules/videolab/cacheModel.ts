import mongoose, { Schema, model, Document } from 'mongoose';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';

export const CURRENT_ANALYZER_VERSION = 'v1';

export type CacheKind = 'ANALYZE' | 'TRANSCRIBE';

export interface IClipAnalysisCache {
  kind: CacheKind;
  clipKey: string;
  language: string;
  analyzerVersion: string;
  result: any;
  createdAt: Date;
}

const ClipAnalysisCacheSchema = new Schema<IClipAnalysisCache>(
  {
    kind: { type: String, required: true, enum: ['ANALYZE', 'TRANSCRIBE'] },
    clipKey: { type: String, required: true, index: true },
    language: { type: String, default: '' },
    analyzerVersion: { type: String, required: true, default: CURRENT_ANALYZER_VERSION },
    result: { type: Schema.Types.Mixed, required: true },
    createdAt: { type: Date, default: Date.now },
  },
  { timestamps: false }
);

ClipAnalysisCacheSchema.index(
  { kind: 1, clipKey: 1, language: 1, analyzerVersion: 1 },
  { unique: true }
);

export const ClipAnalysisCache =
  (mongoose.models.ClipAnalysisCache as mongoose.Model<IClipAnalysisCache>) ||
  model<IClipAnalysisCache>('ClipAnalysisCache', ClipAnalysisCacheSchema);

export interface IGeminiUsage {
  date: string; // YYYY-MM-DD in IST
  model: string;
  count: number;
}

const GeminiUsageSchema = new Schema<IGeminiUsage>(
  {
    date: { type: String, required: true },
    model: { type: String, required: true },
    count: { type: Number, required: true, default: 0 },
  },
  { timestamps: false }
);

GeminiUsageSchema.index({ date: 1, model: 1 }, { unique: true });

export const GeminiUsage =
  (mongoose.models.GeminiUsage as mongoose.Model<IGeminiUsage>) ||
  model<IGeminiUsage>('GeminiUsage', GeminiUsageSchema);

export function getTodayIST(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export async function recordGeminiUsage(modelName: string): Promise<number> {
  if (mongoose.connection.readyState !== 1) return 0;
  const date = getTodayIST();
  try {
    const doc = await GeminiUsage.findOneAndUpdate(
      { date, model: modelName },
      { $inc: { count: 1 } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    const count = doc?.count || 1;
    if (count >= env.GEMINI_DAILY_LIMIT) {
      logger.warn(
        { date, model: modelName, count, limit: env.GEMINI_DAILY_LIMIT },
        `Gemini daily usage limit reached or exceeded (soft limit: ${env.GEMINI_DAILY_LIMIT})`
      );
    }
    return count;
  } catch (err) {
    logger.warn({ err }, 'Failed to record Gemini usage');
    return 0;
  }
}

export async function getTodayGeminiUsage(): Promise<{
  date: string;
  totalCount: number;
  limit: number;
  byModel: Record<string, number>;
}> {
  const date = getTodayIST();
  const limit = env.GEMINI_DAILY_LIMIT;
  if (mongoose.connection.readyState !== 1) {
    return { date, totalCount: 0, limit, byModel: {} };
  }
  try {
    const docs = await GeminiUsage.find({ date });
    let totalCount = 0;
    const byModel: Record<string, number> = {};
    for (const doc of docs) {
      byModel[doc.model] = doc.count;
      totalCount += doc.count;
    }
    return { date, totalCount, limit, byModel };
  } catch (err) {
    logger.warn({ err }, 'Failed to get today Gemini usage');
    return { date, totalCount: 0, limit, byModel: {} };
  }
}

export async function getCachedAnalysis<T = any>(
  kind: CacheKind,
  clipKey: string,
  language = ''
): Promise<T | null> {
  if (mongoose.connection.readyState !== 1) return null;
  try {
    const entry = await ClipAnalysisCache.findOne({
      kind,
      clipKey,
      language,
      analyzerVersion: CURRENT_ANALYZER_VERSION,
    }).lean();
    return (entry?.result as T) ?? null;
  } catch (err) {
    logger.warn({ err, kind, clipKey }, 'Failed to read from clip analysis cache');
    return null;
  }
}

export async function setCachedAnalysis(
  kind: CacheKind,
  clipKey: string,
  language: string,
  result: any
): Promise<void> {
  if (mongoose.connection.readyState !== 1) return;
  try {
    await ClipAnalysisCache.findOneAndUpdate(
      {
        kind,
        clipKey,
        language,
        analyzerVersion: CURRENT_ANALYZER_VERSION,
      },
      {
        $set: {
          result,
          createdAt: new Date(),
        },
      },
      { upsert: true }
    );
  } catch (err) {
    logger.warn({ err, kind, clipKey }, 'Failed to write to clip analysis cache');
  }
}

export async function clearCachedAnalysis(
  kind: CacheKind,
  clipKey: string,
  language = ''
): Promise<void> {
  if (mongoose.connection.readyState !== 1) return;
  try {
    await ClipAnalysisCache.deleteOne({
      kind,
      clipKey,
      language,
      analyzerVersion: CURRENT_ANALYZER_VERSION,
    });
  } catch (err) {
    logger.warn({ err, kind, clipKey }, 'Failed to clear cached analysis');
  }
}
