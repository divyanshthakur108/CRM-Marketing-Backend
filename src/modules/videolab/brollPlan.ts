import mongoose, { Types } from 'mongoose';
import { CaptionCue, CueWord, LabClip, RecipeCut, ShotCategory, TimeRange } from './recipe.js';
import { snapToSilence } from './cutPlan.js';
import { searchShots, DEFAULT_EXCLUDE_RECENT_DAYS } from './memorySearch.js';
import { IContentItem } from './memoryModel.js';
import { logger } from '../../config/logger.js';

export interface BrollCandidate {
  key: string;
  clipIndex: number;
  start: number;
  end: number;
  label: string;
  category: ShotCategory;
  quality: number;
  hookScore: number;
  problems: number;
  score: number;
  kind?: 'clip' | 'photo';
  origin?: 'this_clip' | 'library_video' | 'library_photo';
  isIllustrative?: boolean;
  usedIn?: Array<{ renderId?: any; at: Date }>;
}

export interface SpeechCandidate {
  key: string;
  clipIndex: number;
  start: number;
  end: number;
  label: string;
  category: ShotCategory;
  quality: number;
  cues?: CaptionCue[];
}

export interface RecipeOverlay {
  start: number; // Seconds on final merged timeline
  end: number;   // Seconds on final merged timeline
  source: {
    kind: 'clip' | 'photo';
    key: string;
    in?: number;  // Start timestamp inside source clip
    out?: number; // End timestamp inside source clip
  };
  style?: 'FULL' | 'CARD';
  motion?: 'NONE' | 'ZOOM_IN' | 'PAN_LEFT' | 'PAN_RIGHT';
  label?: string;
  reason?: string;
  decidedBy?: 'ai' | 'rules';
  origin?: 'this_clip' | 'library_video' | 'library_photo';
  isIllustrative?: boolean;
}

const SERIOUS_ISSUES = new Set(['text_or_watermark', 'blurry', 'too_dark', 'overexposed', 'obstructed', 'camera_pointing_down']);

const round2 = (n: number) => Math.round(n * 100) / 100;

export const CATEGORY_KEYWORDS: Record<ShotCategory, string[]> = {
  KITCHEN: [
    'kitchen', 'modular kitchen', 'pantry', 'cooktop', 'chimney', 'hob', 'cabinets', 'granite counter',
    'किचन', 'रसोई', 'मॉड्यूलर किचन', 'चूल्हा',
    'ਰਸੋਈ', 'ਕਿਚਨ',
    'rasoi', 'modular'
  ],
  BEDROOM: [
    'bedroom', 'master bedroom', 'bed', 'wardrobe', 'guest room', 'kids room',
    'बेडरूम', 'कमरा', 'मास्टर बेडरूम', 'शयनकक्ष',
    'ਕਮਰਾ', 'ਬੈੱਡਰੂਮ',
    'kamra', 'master bed'
  ],
  LIVING: [
    'living', 'living room', 'hall', 'drawing room', 'lounge', 'dining', 'foyer',
    'लिविंग रूम', 'हॉल', 'बैठक', 'ड्राइंग रूम', 'डाइनिंग',
    'ਲਿਵਿੰਗ ਰੂਮ', 'ਹਾਲ',
    'drawing hall', 'dining area'
  ],
  BALCONY_VIEW: [
    'balcony', 'view', 'skyline', 'terrace', 'deck', 'open view', 'scenic', 'patio',
    'बालकनी', 'व्यू', 'टेरेस', 'नजारा', 'खुला व्यू',
    'ਬਾਲਕੋਨੀ', 'ਵਿਊ', 'ਨਜ਼ਾਰਾ',
    'terrace', 'skyline view', 'open view'
  ],
  BATHROOM: [
    'bathroom', 'washroom', 'toilet', 'vanity', 'fittings', 'bathtub', 'shower',
    'बाथरूम', 'वाशरूम', 'टॉयलेट',
    'ਬਾਥਰੂਮ', 'ਗੁਸਲਖਾਨਾ',
    'attached bath'
  ],
  EXTERIOR: [
    'exterior', 'building', 'facade', 'elevation', 'tower', 'architecture', 'outdoors',
    'इमारत', 'बिल्डिंग', 'बाहर', 'टावर', 'एलिवेशन',
    'ਇਮਾਰਤ', 'ਟਾਵਰ', 'ਬਾਹਰ',
    'elevation', 'tower'
  ],
  AERIAL: [
    'drone', 'aerial', 'top view', 'bird eye', 'birds-eye', 'overview',
    'ड्रोन', 'ऊंचाई', 'हवाई नजारा',
    'ਡਰੋਨ', 'ਉਚਾਈ',
    'drone view', 'aerial shot'
  ],
  ENTRANCE: [
    'entrance', 'entry', 'lobby', 'gate', 'foyer', 'reception', 'main door',
    'गेट', 'प्रवेश', 'लॉबी', 'मुख्य द्वार',
    'ਗੇਟ', 'ਲਾਬੀ', 'ਮੁੱਖ ਦਰਵਾਜ਼ਾ',
    'grand lobby', 'main gate'
  ],
  AMENITY: [
    'amenity', 'amenities', 'pool', 'swimming pool', 'gym', 'fitness', 'club', 'clubhouse', 'park', 'garden', 'parking', 'lift', 'sports', 'play area',
    'स्विमिंग पूल', 'जिम', 'क्लब', 'पार्क', 'बगीचा', 'पार्किंग', 'लिफ्ट', 'सुविधाएं',
    'ਸਵਿਮਿੰਗ ਪੂਲ', 'ਜਿਮ', 'ਪਾਰਕ', 'ਪਾਰਕਿੰਗ', 'ਸਹੂਲਤਾਂ',
    'clubhouse', 'swimming pool', 'garden'
  ],
  LOCATION: [
    'location', 'highway', 'airport', 'metro', 'road', 'connectivity', 'sector', 'school', 'hospital',
    'लोकेशन', 'हाईवे', 'एयरपोर्ट', 'मेट्रो', 'सेक्टर', 'सड़क',
    'ਲੋਕੇਸ਼ਨ', 'ਹਾਈਵੇ', 'ਸੈਕਟਰ',
    'prime location', 'highway', 'metro connectivity'
  ],
  PRESENTER: [],
  OTHER: []
};

/**
 * Extracts continuous speech shots from clips to build the A-roll narration backbone.
 * Rejoins cuts that continue each other in the same clip so speech flows naturally without unnecessary cuts.
 */
export function extractSpeechBlocks(clips: LabClip[], targetSeconds = 45): RecipeCut[] {
  const candidates: SpeechCandidate[] = [];

  clips.forEach((clip, clipIndex) => {
    const shots = [...(clip.shots || [])].filter((s) => s.keep && s.hasSpeech).sort((a, b) => a.start - b.start);
    for (const shot of shots) {
      const start = snapToSilence(shot.start, clip.silences);
      const end = snapToSilence(shot.end, clip.silences);
      if (end - start >= 1.2) {
        candidates.push({
          key: clip.key,
          clipIndex,
          start: round2(start),
          end: round2(end),
          label: shot.label,
          category: shot.category,
          quality: shot.quality,
        });
      }
    }
  });

  // Preserve natural chronological order of speech
  candidates.sort((a, b) => a.clipIndex - b.clipIndex || a.start - b.start);

  const merged: RecipeCut[] = [];
  let totalDuration = 0;

  for (const c of candidates) {
    const cutDuration = c.end - c.start;
    if (totalDuration + cutDuration > targetSeconds + 4 && merged.length > 0) {
      break;
    }

    const prev = merged[merged.length - 1];
    if (prev && prev.key === c.key && Math.abs(c.start - (prev.end ?? 0)) < 0.35) {
      prev.end = round2(c.end);
      if (!prev.label?.includes(c.label)) {
        prev.label = `${prev.label} → ${c.label}`;
      }
    } else {
      merged.push({
        key: c.key,
        start: c.start,
        end: c.end,
        label: c.label,
      });
      totalDuration += cutDuration;
    }
  }

  return merged;
}

/**
 * Extracts B-roll footage (non-speech shots with quality >= 3).
 * Returns ranked pool of available visual cutaways.
 */
export function extractBrollPool(clips: LabClip[]): BrollCandidate[] {
  const pool: BrollCandidate[] = [];

  clips.forEach((clip, clipIndex) => {
    const shots = [...(clip.shots || [])]
      .filter((s) => s.keep && !s.hasSpeech && s.quality >= 3)
      .sort((a, b) => a.start - b.start);

    for (const shot of shots) {
      const start = round2(shot.bestStart);
      const end = round2(shot.bestEnd);
      if (end - start < 1.4) continue;

      const problems = (shot.issues || []).filter((i) => SERIOUS_ISSUES.has(i)).length;
      const bScore = shot.quality * 2 + shot.hookScore * 0.5 - problems * 2;

      pool.push({
        key: clip.key,
        clipIndex,
        start,
        end,
        label: shot.label,
        category: shot.category,
        quality: shot.quality,
        hookScore: shot.hookScore,
        problems,
        score: bScore,
        kind: 'clip',
        origin: 'this_clip',
        isIllustrative: false,
      });
    }
  });

  // Sort by highest quality and hookScore
  return pool.sort((a, b) => b.score - a.score || a.clipIndex - b.clipIndex);
}

/**
 * Checks if a word or phrase matches any category in CATEGORY_KEYWORDS.
 */
export function matchWordToCategory(wordText: string): ShotCategory | null {
  const clean = wordText.toLowerCase().replace(/^[^\p{L}\p{N}\p{M}]+|[^\p{L}\p{N}\p{M}]+$/gu, '');
  if (!clean || clean.length < 2) return null;

  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS) as [ShotCategory, string[]][]) {
    for (const kw of keywords) {
      const cleanKw = kw.toLowerCase();
      if (clean === cleanKw) return category;
      const kwTokens = cleanKw.split(/\s+/);
      if (kwTokens.length > 1 && kwTokens.includes(clean)) {
        return category;
      }
    }
  }
  return null;
}

export interface MatchedCueMoment {
  category: ShotCategory;
  cueIndex: number;
  wordIndex: number;
  word: CueWord;
  start: number; // Mapped final timeline start
  end: number;   // Mapped final timeline end
}

/**
 * Scans final-timeline speech cues to find moments where a category keyword was uttered.
 */
export function findCategoryMomentsInCues(cues: CaptionCue[]): MatchedCueMoment[] {
  const moments: MatchedCueMoment[] = [];

  cues.forEach((cue, cueIndex) => {
    const words = cue.words || [];
    words.forEach((w, wordIndex) => {
      const cat = matchWordToCategory(w.text);
      if (cat && cat !== 'PRESENTER' && cat !== 'OTHER') {
        moments.push({
          category: cat,
          cueIndex,
          wordIndex,
          word: w,
          start: w.start,
          end: w.end,
        });
      }
    });
  });

  return moments;
}

/**
 * Finds a suitable end boundary for a B-roll overlay, snapping to a word boundary
 * within the ideal window [start + minDuration, start + maxDuration].
 */
function findSnappedEnd(
  startTime: number,
  targetDuration: number,
  cues: CaptionCue[],
  minDuration = 1.5,
  maxDuration = 4.0
): number {
  const idealEnd = startTime + targetDuration;
  let bestEnd = idealEnd;
  let smallestDiff = Infinity;

  for (const cue of cues) {
    for (const w of cue.words || []) {
      const dur = w.end - startTime;
      if (dur >= minDuration && dur <= maxDuration) {
        const diff = Math.abs(w.end - idealEnd);
        if (diff < smallestDiff) {
          smallestDiff = diff;
          bestEnd = w.end;
        }
      }
    }
  }

  return round2(Math.min(startTime + maxDuration, Math.max(startTime + minDuration, bestEnd)));
}

/**
 * Fetches B-roll candidates from Content Memory (past video shots and photos)
 * for missing categories not found in current clips.
 * Strictly skips items without consentOk.
 */
export async function fetchMemoryBrollCandidates(
  neededCategories: ShotCategory[],
  opts?: {
    organizationId?: Types.ObjectId | string;
    projectId?: Types.ObjectId | string;
    excludeRecentDays?: number;
    relaxIfEmpty?: boolean;
    limitPerCategory?: number;
  }
): Promise<BrollCandidate[]> {
  if (!neededCategories.length) return [];
  if (mongoose.connection.readyState !== 1 || !mongoose.connection.db) {
    return [];
  }

  const result: BrollCandidate[] = [];
  const seenKeys = new Set<string>();

  for (const category of neededCategories) {
    try {
      const shots = await searchShots({
        room: category,
        organizationId: opts?.organizationId,
        projectId: opts?.projectId,
        excludeRecentDays: opts?.excludeRecentDays ?? DEFAULT_EXCLUDE_RECENT_DAYS,
        relaxIfEmpty: opts?.relaxIfEmpty ?? false,
        limit: opts?.limitPerCategory ?? 5,
      });

      for (const shot of shots) {
        const item = shot.itemId as IContentItem | undefined;
        // Strictly exclude items with consentOk === false or heuristic photo analysis
        if (item && item.consentOk === false) continue;
        if (item && item.kind === 'PHOTO' && item.analysisSource === 'heuristic') continue;

        const isPhoto = item?.kind === 'PHOTO' || /\.(png|jpg|jpeg|webp)$/i.test(shot.clipKey);
        const isIllustrative = item?.actualOrIllustrative === 'ILLUSTRATIVE';
        const keyId = `${shot.clipKey}:${shot.start}`;
        if (seenKeys.has(keyId)) continue;
        seenKeys.add(keyId);

        const problems = (shot.issues || []).filter((i) => SERIOUS_ISSUES.has(i)).length;
        const bScore = (shot.quality || 4) * 2 - problems * 2;

        result.push({
          key: shot.clipKey,
          clipIndex: -1,
          start: isPhoto ? 0 : (shot.start ?? 0),
          end: isPhoto ? 4.0 : (shot.end ?? 4.0),
          label: shot.spokenText || item?.summary || shot.room || 'Library asset',
          category: (shot.room as ShotCategory) || category,
          quality: shot.quality || 4,
          hookScore: 3,
          problems,
          score: bScore,
          kind: isPhoto ? 'photo' : 'clip',
          origin: isPhoto ? 'library_photo' : 'library_video',
          isIllustrative,
          usedIn: shot.usedIn,
        });
      }
    } catch (err) {
      logger.warn({ err, category }, 'Failed to fetch memory B-roll candidates for category');
    }
  }

  return result;
}

/**
 * Enforces all professional placement rules on candidate overlays:
 * 1. Opening hook protected: no B-roll before t = 2.5s.
 * 2. Duration: each overlay is 1.5s to 4.0s.
 * 3. Presenter face resurfacing: at least 1.5s between overlays.
 * 4. Maximum B-roll budget: <= 60% of total narration duration.
 * 5. Word boundary alignment: snaps to word start/end.
 * 6. No duplicate B-roll shots in the same video.
 * 7. End card safety: no overlays within 1.0s of the narration end.
 * 8. Fallback: only include an overlay when an eligible B-roll shot exists.
 */
export function buildBrollPlan(params: {
  clips: LabClip[];
  speechCues: CaptionCue[];
  totalNarrationDuration: number;
  minDuration?: number;
  maxDuration?: number;
  hookProtectedSeconds?: number;
  resurfaceFaceSeconds?: number;
  maxBrollBudgetPercent?: number;
  memoryCandidates?: BrollCandidate[];
}): RecipeOverlay[] {
  const {
    clips,
    speechCues,
    totalNarrationDuration,
    minDuration = 1.5,
    maxDuration = 4.0,
    hookProtectedSeconds = 2.5,
    resurfaceFaceSeconds = 1.5,
    maxBrollBudgetPercent = 0.6,
    memoryCandidates = [],
  } = params;

  if ((!clips.length && !memoryCandidates.length) || !speechCues.length || totalNarrationDuration < 6) {
    return [];
  }

  const brollPool = extractBrollPool(clips);
  if (!brollPool.length && !memoryCandidates.length) {
    return [];
  }

  const moments = findCategoryMomentsInCues(speechCues);
  if (!moments.length) {
    return [];
  }

  const maxTotalBrollDuration = totalNarrationDuration * maxBrollBudgetPercent;
  const overlays: RecipeOverlay[] = [];
  const usedBrollKeys = new Set<string>();
  let currentTotalBroll = 0;
  let lastOverlayEnd = 0;

  for (const moment of moments) {
    // Rule 1: First 2.5s protected for presenter's face
    if (moment.start < hookProtectedSeconds) {
      continue;
    }

    // Rule 7: Don't place B-roll right before end-card transition
    if (moment.start >= totalNarrationDuration - 1.5) {
      continue;
    }

    // Rule 3: Presenter visibility: at least 1.5s of face between B-roll cutaways
    if (lastOverlayEnd > 0 && moment.start < lastOverlayEnd + resurfaceFaceSeconds) {
      continue;
    }

    // Priority 1: Current clips first
    let matchingShot = brollPool.find(
      (b) => b.category === moment.category && !usedBrollKeys.has(`${b.key}:${b.start}`)
    );

    // Priority 2: Old video shots from memory
    if (!matchingShot && memoryCandidates.length) {
      matchingShot = memoryCandidates.find(
        (b) => b.category === moment.category && b.kind !== 'photo' && !usedBrollKeys.has(`${b.key}:${b.start}`)
      );
    }

    // Priority 3: Photos from memory
    if (!matchingShot && memoryCandidates.length) {
      matchingShot = memoryCandidates.find(
        (b) => b.category === moment.category && b.kind === 'photo' && !usedBrollKeys.has(`${b.key}:${b.start}`)
      );
    }

    // Rule 8: If no matching visual shot exists, show the face (no fallback to wrong room)
    if (!matchingShot) {
      continue;
    }

    const isPhoto = matchingShot.kind === 'photo';
    const availableShotLength = isPhoto ? 4.0 : matchingShot.end - matchingShot.start;
    const targetDur = Math.min(maxDuration, Math.max(minDuration, availableShotLength));

    // Rule 5: Word-boundary alignment
    const overlayStart = round2(moment.start);
    const overlayEnd = findSnappedEnd(overlayStart, targetDur, speechCues, minDuration, Math.min(maxDuration, availableShotLength));
    const overlayDuration = round2(overlayEnd - overlayStart);

    // Rule 2 & 7: Check duration and end card boundary
    if (overlayDuration < minDuration || overlayEnd > totalNarrationDuration - 0.5) {
      continue;
    }

    // Rule 4: Maximum B-roll budget
    if (currentTotalBroll + overlayDuration > maxTotalBrollDuration) {
      break;
    }

    usedBrollKeys.add(`${matchingShot.key}:${matchingShot.start}`);
    overlays.push({
      start: overlayStart,
      end: overlayEnd,
      source: {
        kind: isPhoto ? 'photo' : 'clip',
        key: matchingShot.key,
        ...(isPhoto ? {} : { in: matchingShot.start, out: round2(matchingShot.start + overlayDuration) }),
      },
      style: isPhoto ? 'CARD' : 'FULL',
      motion: 'ZOOM_IN',
      label: matchingShot.label,
      reason: `Mentioned ${moment.word.text} (${moment.category.toLowerCase()}) at ${moment.start.toFixed(1)}s`,
      decidedBy: 'rules',
      origin: matchingShot.origin || (isPhoto ? 'library_photo' : 'this_clip'),
      isIllustrative: matchingShot.isIllustrative,
    });

    currentTotalBroll += overlayDuration;
    lastOverlayEnd = overlayEnd;
  }

  return overlays;
}

