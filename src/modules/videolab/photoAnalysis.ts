import fsp from 'fs/promises';
import { Types } from 'mongoose';
import { defaultStorage } from '../../storage/localStorage.adapter.js';
import { getCachedAnalysis, setCachedAnalysis, CURRENT_ANALYZER_VERSION } from './cacheModel.js';
import { ContentItem, ContentShot } from './memoryModel.js';
import { getAIProvider } from '../ai/providers/index.js';
import { SHOT_CATEGORIES, ShotCategory } from './recipe.js';
import { logger } from '../../config/logger.js';

export interface PhotoInputItem {
  key: string;
  filename?: string;
  isIllustrative?: boolean;
  consentOk?: boolean;
}

export interface AnalyzedPhotoResult {
  key: string;
  category: ShotCategory;
  label: string;
  features: string[];
  quality: number;
  actualOrIllustrative: 'ACTUAL' | 'ILLUSTRATIVE';
  analysisSource?: 'gemini' | 'heuristic';
  fromCache?: boolean;
}

/**
 * Analyzes a batch of property photos with Gemini in a single request,
 * caches the result per photo key, and saves ContentItem + ContentShot records.
 */
export async function analyzePhotos(
  photos: PhotoInputItem[],
  opts?: {
    organizationId?: Types.ObjectId | string;
    projectId?: Types.ObjectId | string;
    force?: boolean;
  }
): Promise<AnalyzedPhotoResult[]> {
  if (!photos.length) return [];

  const results: AnalyzedPhotoResult[] = [];
  const uncached: Array<{ index: number; photo: PhotoInputItem; localPath: string; buffer: Buffer; mimeType: string }> = [];

  // 1. Check cache for each photo
  for (let i = 0; i < photos.length; i++) {
    const p = photos[i];
    if (!opts?.force) {
      const cached = await getCachedAnalysis<AnalyzedPhotoResult>('ANALYZE', p.key, '');
      if (cached) {
        results.push({
          ...cached,
          actualOrIllustrative: p.isIllustrative ? 'ILLUSTRATIVE' : cached.actualOrIllustrative || 'ACTUAL',
          fromCache: true,
        });
        continue;
      }
    }

    try {
      const localPath = await defaultStorage.ensureLocal(p.key);
      const buffer = await fsp.readFile(localPath);
      const ext = p.key.split('.').pop()?.toLowerCase();
      const mimeType = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
      uncached.push({ index: i, photo: p, localPath, buffer, mimeType });
    } catch (err) {
      logger.warn({ err, key: p.key }, 'Could not read photo for analysis, falling back to default');
      results.push({
        key: p.key,
        category: 'OTHER',
        label: p.filename || 'Property photo',
        features: [p.filename || 'Photo'],
        quality: 4,
        actualOrIllustrative: p.isIllustrative ? 'ILLUSTRATIVE' : 'ACTUAL',
        fromCache: false,
      });
    }
  }

  // 2. Batch analyze uncached photos with Gemini in ONE request
  if (uncached.length > 0) {
    const ai = getAIProvider();
    let aiResponse: any[] = [];

    if (ai.isConfigured()) {
      try {
        const prompt = `You are a senior real-estate photographer and architectural visualizer for Indian properties.
Analyze these ${uncached.length} property photo(s) in order.
For each photo (indexed 0 to ${uncached.length - 1}), identify:
- "index": 0-based integer matching the photo order
- "category": one of ${SHOT_CATEGORIES.join(', ')} (e.g. KITCHEN, LIVING, BEDROOM, BATHROOM, BALCONY_VIEW, AMENITY, EXTERIOR, AERIAL, ENTRANCE, LOCATION)
- "label": 3–8 words describing what is visible (e.g. "Modern modular kitchen with marble counter")
- "features": array of 2-5 detected keywords (e.g. ["modular kitchen", "granite island", "cabinets"])
- "quality": 1–5 (5 = sharp, luxury lighting and composition)
- "actualOrIllustrative": "ACTUAL" (real photograph) or "ILLUSTRATIVE" (3D computer render / architectural visualization)

Return JSON array: [{"index": 0, "category": "KITCHEN", "label": "...", "features": [...], "quality": 4, "actualOrIllustrative": "ACTUAL"}]`;

        const images = uncached.map((u) => ({ data: u.buffer, mimeType: u.mimeType }));
        const raw = await ai.generateJson<any[]>(prompt, { images, feature: 'Photo understanding' });
        if (Array.isArray(raw)) aiResponse = raw;
      } catch (err) {
        logger.warn({ err }, 'Gemini photo analysis failed, using heuristic fallback');
      }
    }

    for (let uIdx = 0; uIdx < uncached.length; uIdx++) {
      const u = uncached[uIdx];
      const match = aiResponse.find((r) => r.index === uIdx) || aiResponse[uIdx] || {};

      const hasAiCategory = match.category && (SHOT_CATEGORIES as readonly string[]).includes(match.category);
      const category = hasAiCategory
        ? (match.category as ShotCategory)
        : inferCategoryFromFilename(u.photo.filename || u.photo.key);
      const analysisSource: 'gemini' | 'heuristic' = hasAiCategory ? 'gemini' : 'heuristic';

      const label = String(match.label || u.photo.filename || 'Property photo').trim().slice(0, 80);
      const features = Array.isArray(match.features) && match.features.length
        ? match.features.map(String)
        : [label];
      const quality = typeof match.quality === 'number' ? Math.max(1, Math.min(5, Math.round(match.quality))) : 4;
      const actualOrIllustrative = u.photo.isIllustrative
        ? 'ILLUSTRATIVE'
        : match.actualOrIllustrative === 'ILLUSTRATIVE'
          ? 'ILLUSTRATIVE'
          : 'ACTUAL';

      const analyzed: AnalyzedPhotoResult = {
        key: u.photo.key,
        category,
        label,
        features,
        quality,
        actualOrIllustrative,
        analysisSource,
        fromCache: false,
      };

      await setCachedAnalysis('ANALYZE', u.photo.key, '', analyzed).catch(() => undefined);
      results.push(analyzed);
    }
  }

  // 3. Upsert into Content Memory (ContentItem + ContentShot)
  const orgId = opts?.organizationId ? new Types.ObjectId(opts.organizationId) : undefined;
  const projId = opts?.projectId ? new Types.ObjectId(opts.projectId) : undefined;

  for (const item of results) {
    const photoInput = photos.find((p) => p.key === item.key);
    const consentOk = photoInput?.consentOk !== false;

    try {
      const contentItem = await ContentItem.findOneAndUpdate(
        { sourceKey: item.key, kind: 'PHOTO' },
        {
          $set: {
            organizationId: orgId,
            projectId: projId,
            kind: 'PHOTO',
            sourceKey: item.key,
            summary: item.label,
            rooms: [item.category],
            features: item.features,
            actualOrIllustrative: item.actualOrIllustrative,
            consentOk,
            analysisSource: item.analysisSource || 'gemini',
            analyzerVersion: CURRENT_ANALYZER_VERSION,
          },
          $setOnInsert: {
            createdAt: new Date(),
          },
        },
        { upsert: true, new: true }
      );

      if (contentItem) {
        await ContentShot.findOneAndUpdate(
          { clipKey: item.key, start: 0, end: 4.0 },
          {
            $set: {
              itemId: contentItem._id,
              organizationId: orgId,
              projectId: projId,
              room: item.category,
              features: item.features,
              quality: item.quality,
              issues: [],
              spokenText: item.label,
              thumbnailUrl: defaultStorage.getUrl(item.key),
            },
            $setOnInsert: {
              clipKey: item.key,
              start: 0,
              end: 4.0,
              usedIn: [],
              createdAt: new Date(),
            },
          },
          { upsert: true }
        );
      }
    } catch (err) {
      logger.warn({ err, key: item.key }, 'Failed to save photo in Content Memory');
    }
  }

  return results;
}

function inferCategoryFromFilename(name: string): ShotCategory {
  const lower = name.toLowerCase();
  if (lower.includes('kitchen') || lower.includes('rasoi')) return 'KITCHEN';
  if (lower.includes('bed') || lower.includes('bedroom')) return 'BEDROOM';
  if (lower.includes('living') || lower.includes('hall') || lower.includes('drawing')) return 'LIVING';
  if (lower.includes('balcony') || lower.includes('view') || lower.includes('terrace')) return 'BALCONY_VIEW';
  if (lower.includes('bath') || lower.includes('toilet') || lower.includes('washroom')) return 'BATHROOM';
  if (lower.includes('pool') || lower.includes('gym') || lower.includes('club') || lower.includes('amenity')) return 'AMENITY';
  if (lower.includes('exterior') || lower.includes('facade') || lower.includes('tower') || lower.includes('elevation')) return 'EXTERIOR';
  if (lower.includes('aerial') || lower.includes('drone')) return 'AERIAL';
  if (lower.includes('entry') || lower.includes('entrance') || lower.includes('lobby')) return 'ENTRANCE';
  return 'OTHER';
}

