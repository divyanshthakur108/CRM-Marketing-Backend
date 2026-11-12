import { Types } from 'mongoose';
import { ContentShot, ContentItem, IContentShot, IContentItem } from './memoryModel.js';

export const DEFAULT_EXCLUDE_RECENT_DAYS = Number(process.env.VIDEOLAB_EXCLUDE_RECENT_DAYS) || 14;

export const SERIOUS_SHOT_ISSUES = new Set([
  'shaky',
  'blurry',
  'too_dark',
  'overexposed',
  'camera_pointing_down',
  'obstructed',
  'frozen',
  'black',
  'accidental',
  'people_unprepared',
  'text_or_watermark',
]);

export interface SearchShotsParams {
  room?: string;
  keywords?: string[];
  q?: string;
  organizationId?: Types.ObjectId | string;
  projectId?: Types.ObjectId | string;
  excludeRecentDays?: number;
  relaxIfEmpty?: boolean;
  excludeHeuristic?: boolean;
  limit?: number;
}

export type PopulatedShot = Omit<IContentShot, 'itemId'> & {
  itemId?: IContentItem | null;
};

/**
 * Searches ContentShot records with tenant isolation, room filtering,
 * keyword matching, and deterministic multi-criteria ranking.
 *
 * Ranking criteria (highest priority first):
 * 1. ACTUAL before ILLUSTRATIVE (from parent ContentItem)
 * 2. No serious issues before serious issues
 * 3. Least recently used (never used > older usage > recent usage)
 * 4. Quality (5 down to 1)
 */
export async function searchShots(params: SearchShotsParams): Promise<PopulatedShot[]> {
  const query: Record<string, unknown> = {};

  if (params.organizationId) {
    query.organizationId = new Types.ObjectId(params.organizationId);
  }
  if (params.projectId) {
    query.projectId = new Types.ObjectId(params.projectId);
  }
  if (params.room && params.room !== 'ALL') {
    query.room = { $regex: new RegExp(`^${params.room.trim()}$`, 'i') };
  }

  const tokens = [
    ...(params.keywords || []),
    ...(params.q ? params.q.split(/\s+/).filter(Boolean) : []),
  ].map((t) => t.trim()).filter(Boolean);

  if (tokens.length > 0) {
    const tokenRegexes = tokens.map((t) => new RegExp(t, 'i'));
    query.$or = [
      { room: { $in: tokenRegexes } },
      { features: { $in: tokenRegexes } },
      { spokenText: { $in: tokenRegexes } },
    ];
  }

  const limit = params.limit && params.limit > 0 ? params.limit : 10;

  const rawShots = (await ContentShot.find(query)
    .populate('itemId')
    .lean()) as unknown as PopulatedShot[];

  let candidates = rawShots;

  if (params.excludeHeuristic) {
    candidates = candidates.filter((shot) => {
      const item = shot.itemId as IContentItem | undefined;
      return item?.analysisSource !== 'heuristic';
    });
  }

  if (params.excludeRecentDays && params.excludeRecentDays > 0) {
    const cutoffMs = Date.now() - params.excludeRecentDays * 86400000;
    const filtered = candidates.filter((shot) => {
      if (!shot.usedIn || shot.usedIn.length === 0) return true;
      return !shot.usedIn.some((u) => new Date(u.at).getTime() >= cutoffMs);
    });
    if (params.relaxIfEmpty) {
      if (filtered.length > 0) candidates = filtered;
    } else {
      candidates = filtered;
    }
  }

  candidates.sort((a, b) => {
    // 1. ACTUAL before ILLUSTRATIVE
    const aItem = a.itemId as IContentItem | undefined;
    const bItem = b.itemId as IContentItem | undefined;
    const aActual = aItem?.actualOrIllustrative !== 'ILLUSTRATIVE' ? 1 : 0;
    const bActual = bItem?.actualOrIllustrative !== 'ILLUSTRATIVE' ? 1 : 0;
    if (aActual !== bActual) return bActual - aActual;

    // 2. No serious issues first
    const aSerious = (a.issues || []).some((i) => SERIOUS_SHOT_ISSUES.has(i)) ? 1 : 0;
    const bSerious = (b.issues || []).some((i) => SERIOUS_SHOT_ISSUES.has(i)) ? 1 : 0;
    if (aSerious !== bSerious) return aSerious - bSerious;

    // 3. Least recently used: never used (0) > older timestamp > newer timestamp
    const aLastUsed = a.usedIn && a.usedIn.length
      ? Math.max(...a.usedIn.map((u) => new Date(u.at).getTime()))
      : 0;
    const bLastUsed = b.usedIn && b.usedIn.length
      ? Math.max(...b.usedIn.map((u) => new Date(u.at).getTime()))
      : 0;

    if (aLastUsed === 0 && bLastUsed > 0) return -1;
    if (bLastUsed === 0 && aLastUsed > 0) return 1;
    if (aLastUsed !== bLastUsed) return aLastUsed - bLastUsed;

    // 4. Quality (5 down to 1)
    const aQuality = a.quality ?? 3;
    const bQuality = b.quality ?? 3;
    if (aQuality !== bQuality) return bQuality - aQuality;

    return 0;
  });

  return candidates.slice(0, limit);
}

/**
 * Returns content memory statistics (counts of items and shots).
 */
export async function getContentMemoryStats(opts?: {
  organizationId?: Types.ObjectId | string;
  projectId?: Types.ObjectId | string;
}): Promise<{ itemCount: number; shotCount: number }> {
  const query: Record<string, unknown> = {};
  if (opts?.organizationId) query.organizationId = new Types.ObjectId(opts.organizationId);
  if (opts?.projectId) query.projectId = new Types.ObjectId(opts.projectId);

  const [itemCount, shotCount] = await Promise.all([
    ContentItem.countDocuments(query),
    ContentShot.countDocuments(query),
  ]);

  return { itemCount, shotCount };
}

