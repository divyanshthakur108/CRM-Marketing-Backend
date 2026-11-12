import { CaptionCue, CueWord, LabClip, RecipeOverlay, ShotCategory } from './recipe.js';
import {
  BrollCandidate,
  buildBrollPlan,
  CATEGORY_KEYWORDS,
  extractBrollPool,
  fetchMemoryBrollCandidates,
  findCategoryMomentsInCues,
  matchWordToCategory,
} from './brollPlan.js';
import { getAIProvider } from '../ai/providers/index.js';
import { logger } from '../../config/logger.js';

export interface IdentifiedBrollShot extends BrollCandidate {
  shotId: string;
}

export interface AiBrollDecision {
  /** Stable shot ID matching the Edit Sheet (e.g., 'shot_0') */
  shotId?: string;
  /** Fallback index into B-roll pool (0-based) */
  shotIndex?: number;
  /** Target start time on the final merged timeline (seconds) */
  targetTimelineStart: number;
  /** Target end time on the final merged timeline (seconds) */
  targetTimelineEnd: number;
  /** Spoken words or phrase that justified this B-roll cutaway */
  spokenPhrase?: string;
  /** Editorial reasoning */
  reason?: string;
}

export interface AiEditProposal {
  editorialTheme?: string;
  brollDecisions: AiBrollDecision[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const GEMINI_TIMEOUT_MS = 5000;

/**
 * Assigns stable identifiers to each shot in the B-roll pool.
 */
export function identifyBrollPool(pool: BrollCandidate[]): IdentifiedBrollShot[] {
  return pool.map((shot, idx) => ({
    ...shot,
    shotId: `shot_${idx}`,
  }));
}

/**
 * Builds a compact, token-efficient plain text Edit Sheet for Gemini.
 */
export function buildEditSheet(params: {
  projectName?: string;
  orgName?: string;
  language?: string;
  targetSeconds?: number;
  speechCues: CaptionCue[];
  identifiedPool: IdentifiedBrollShot[];
  totalNarrationDuration: number;
}): string {
  const {
    projectName = 'Property',
    orgName = 'Agency',
    language = 'Hinglish',
    targetSeconds = 30,
    speechCues,
    identifiedPool,
    totalNarrationDuration,
  } = params;

  const transcriptLines = speechCues.map((c) => {
    return `[${c.start.toFixed(1)}s - ${c.end.toFixed(1)}s]: "${c.text}"`;
  });

  const shotLines = identifiedPool.map((s) => {
    const dur = (s.end - s.start).toFixed(1);
    const sourcePrefix =
      s.origin === 'library_photo'
        ? `Source: Library photo${s.isIllustrative ? ' [Artist Impression]' : ''} | `
        : s.origin === 'library_video'
          ? `Source: Library video${s.isIllustrative ? ' [Artist Impression]' : ''} | `
          : s.origin === 'this_clip'
            ? 'Source: Current footage | '
            : '';
    return `[${s.shotId}] ${sourcePrefix}Category: ${s.category} | Dur: ${dur}s | Quality: ${s.quality}/5 | Label: ${s.label}`;
  });

  return `You are a senior video editor for Indian real-estate social reels (9:16 vertical, Instagram / YouTube Shorts).
Select the most suitable visual B-roll cutaways to show over the presenter's continuous narration.

=== PROPERTY & EDIT CONTEXT ===
Project: ${projectName} | Agency: ${orgName} | Language: ${language}
Target Duration: ~${targetSeconds}s (Total Narration: ${totalNarrationDuration.toFixed(1)}s)

=== NARRATION SCRIPT (Final Merged Timeline) ===
${transcriptLines.join('\n')}

=== AVAILABLE B-ROLL FOOTAGE POOL ===
${shotLines.length ? shotLines.join('\n') : 'No B-roll available.'}

=== EDITORIAL RULES ===
1. The first 2.5s MUST show the presenter's face (the hook). Never place B-roll before 2.5s.
2. Each B-roll cutaway must last between 1.5s and 4.0s.
3. Keep at least 1.5s of presenter face visible between consecutive B-roll cutaways.
4. Total B-roll cutaway duration must NOT exceed 60% of total narration time.
5. Only select a shot if the presenter is actively praising, explaining or pointing out that specific property feature.
   - If the presenter is discussing prices, greetings, location, or general talk, DO NOT show irrelevant interior shots.
   - If the presenter mentions a feature negatively or says it's under construction, DO NOT show a finished shot.
6. Never reuse the same shot ID twice.
7. Do not schedule B-roll within 1.0s of the narration end.

Return strictly JSON with this structure:
{
  "editorialTheme": "One-line editorial strategy",
  "brollDecisions": [
    {
      "shotId": "shot_0",
      "shotIndex": 0,
      "targetTimelineStart": 3.0,
      "targetTimelineEnd": 5.5,
      "spokenPhrase": "modular kitchen",
      "reason": "Shows the modular kitchen layout as the presenter describes it"
    }
  ]
}`;
}

/**
 * Requests an Edit Decision List (EDL) from Gemini with a strict 5-second timeout.
 */
export async function proposeAiEdit(editSheet: string): Promise<AiEditProposal> {
  const ai = getAIProvider();
  if (!ai.isConfigured()) {
    throw new Error('AI provider is not configured');
  }

  const timeoutPromise = new Promise<never>((_, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Gemini AI Edit Director timed out after ${GEMINI_TIMEOUT_MS}ms`));
    }, GEMINI_TIMEOUT_MS);
    // Allow Node to exit if timer is pending
    if (typeof timer.unref === 'function') timer.unref();
  });

  const requestPromise = ai.generateJson<AiEditProposal>(editSheet, {
    feature: 'AI Edit Director',
  });

  const response = await Promise.race([requestPromise, timeoutPromise]);
  if (!response || typeof response !== 'object' || !Array.isArray(response.brollDecisions)) {
    throw new Error('Invalid JSON format returned by Gemini AI Edit Director');
  }

  return response;
}

/**
 * Finds the closest spoken word boundary to snap an overlay timestamp.
 */
function findNearestWordStart(time: number, cues: CaptionCue[], minAllowed = 2.5): number {
  let best = Math.max(minAllowed, time);
  let smallestDiff = Infinity;

  for (const cue of cues) {
    for (const w of cue.words || []) {
      if (w.start >= minAllowed) {
        const diff = Math.abs(w.start - time);
        if (diff < smallestDiff && diff <= 0.8) {
          smallestDiff = diff;
          best = w.start;
        }
      }
    }
  }
  return round2(best);
}

function findNearestWordEnd(
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
 * Verifies that the spoken dialogue around the suggested window actually relates
 * to the shot's category or label metadata. Rejects ungrounded AI hallucinations.
 */
export function isVisuallyRelevant(
  category: ShotCategory,
  label: string,
  start: number,
  end: number,
  speechCues: CaptionCue[]
): boolean {
  // Extract all words spoken in a slightly expanded window [-0.6s, +0.6s]
  const windowStart = Math.max(0, start - 0.6);
  const windowEnd = end + 0.6;

  const spokenTokens: string[] = [];
  for (const cue of speechCues) {
    if (cue.end < windowStart || cue.start > windowEnd) continue;
    for (const w of cue.words || []) {
      if (w.end >= windowStart && w.start <= windowEnd) {
        spokenTokens.push(w.text.toLowerCase());
      }
    }
  }

  if (!spokenTokens.length) return false;

  // 1. Direct category keyword match
  const categoryKeywords = CATEGORY_KEYWORDS[category] || [];
  for (const token of spokenTokens) {
    const matchedCategory = matchWordToCategory(token);
    if (matchedCategory === category) return true;
    for (const kw of categoryKeywords) {
      const cleanKw = kw.toLowerCase().trim();
      if (token === cleanKw) return true;
      if (token.length >= 4 && (token.includes(cleanKw) || cleanKw.includes(token))) {
        return true;
      }
    }
  }

  // 2. Shot label keyword match
  const labelTokens = label
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
    .filter((t) => t.length > 2);

  for (const spoken of spokenTokens) {
    const cleanSpoken = spoken.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
    if (cleanSpoken.length > 2 && labelTokens.includes(cleanSpoken)) {
      return true;
    }
  }

  return false;
}

/**
 * Deterministically validates every AI decision against clip durations,
 * spoken content, and editing placement rules.
 */
export function validateAiProposal(params: {
  proposal: AiEditProposal;
  clips: LabClip[];
  identifiedPool: IdentifiedBrollShot[];
  speechCues: CaptionCue[];
  totalNarrationDuration: number;
  hookProtectedSeconds?: number;
  minDuration?: number;
  maxDuration?: number;
  resurfaceFaceSeconds?: number;
  maxBrollBudgetPercent?: number;
}): RecipeOverlay[] {
  const {
    proposal,
    clips,
    identifiedPool,
    speechCues,
    totalNarrationDuration,
    hookProtectedSeconds = 2.5,
    minDuration = 1.5,
    maxDuration = 4.0,
    resurfaceFaceSeconds = 1.5,
    maxBrollBudgetPercent = 0.6,
  } = params;

  if (!proposal.brollDecisions?.length || !identifiedPool.length) {
    return [];
  }

  const maxTotalBrollDuration = totalNarrationDuration * maxBrollBudgetPercent;
  const overlays: RecipeOverlay[] = [];
  const usedShotIds = new Set<string>();
  let currentTotalBroll = 0;
  let lastOverlayEnd = 0;

  for (const decision of proposal.brollDecisions) {
    // 1. Locate the shot using stable shotId first, then shotIndex fallback
    const shot =
      identifiedPool.find((s) => decision.shotId && s.shotId === decision.shotId) ||
      (typeof decision.shotIndex === 'number' ? identifiedPool[decision.shotIndex] : undefined);

    if (!shot) {
      logger.warn({ decision }, 'AI Edit Director: rejected invalid or unknown shotId');
      continue;
    }

    // 2. Validate source in/out against actual source clip duration
    const sourceClip = clips.find((c) => c.key === shot.key);
    const clipMaxDuration = sourceClip?.durationSeconds ?? Math.max(3600, shot.end + 10);
    if (shot.start < 0 || isNaN(shot.start) || shot.start >= clipMaxDuration) {
      logger.warn({ shot, clipMaxDuration }, 'AI Edit Director: shot start is invalid or exceeds source clip duration');
      continue;
    }

    const availableShotDuration = Math.min(shot.end, clipMaxDuration) - shot.start;
    if (availableShotDuration < minDuration) {
      logger.warn({ shot, availableShotDuration }, 'AI Edit Director: shot length too short for B-roll overlay');
      continue;
    }

    // 3. Prevent duplicate shots in the same reel
    if (usedShotIds.has(shot.shotId)) {
      continue;
    }

    // 4. Rule 1: Hook protection (Presenter face only in first 2.5s)
    if (decision.targetTimelineStart < hookProtectedSeconds) {
      continue;
    }

    // 5. Rule 7: End card boundary protection (no B-roll within 1.0s of end)
    if (decision.targetTimelineStart >= totalNarrationDuration - 1.5) {
      continue;
    }

    // 6. Rule 3: Presenter visibility: minimum 1.5s of face between B-roll cutaways
    if (lastOverlayEnd > 0 && decision.targetTimelineStart < lastOverlayEnd + resurfaceFaceSeconds) {
      continue;
    }

    // 7. Validate visual relevance against spoken dialogue and shot metadata
    const isRelevant = isVisuallyRelevant(
      shot.category,
      shot.label,
      decision.targetTimelineStart,
      decision.targetTimelineEnd,
      speechCues
    );
    if (!isRelevant) {
      logger.warn(
        { category: shot.category, label: shot.label, window: [decision.targetTimelineStart, decision.targetTimelineEnd] },
        'AI Edit Director: rejected visually irrelevant B-roll decision'
      );
      continue;
    }

    // 8. Snap start and end to exact spoken word boundaries
    const overlayStart = findNearestWordStart(decision.targetTimelineStart, speechCues, hookProtectedSeconds);
    const rawEnd = Math.max(decision.targetTimelineEnd, overlayStart + minDuration);
    const targetDur = Math.min(maxDuration, Math.min(availableShotDuration, rawEnd - overlayStart));
    const overlayEnd = findNearestWordEnd(overlayStart, targetDur, speechCues, minDuration, Math.min(maxDuration, availableShotDuration));
    const overlayDuration = round2(overlayEnd - overlayStart);

    if (overlayDuration < minDuration || overlayEnd > totalNarrationDuration - 0.5) {
      continue;
    }

    // 9. Rule 4: Total B-roll budget enforcement
    if (currentTotalBroll + overlayDuration > maxTotalBrollDuration) {
      break;
    }

    const isPhoto = shot.kind === 'photo';
    usedShotIds.add(shot.shotId);
    overlays.push({
      start: overlayStart,
      end: overlayEnd,
      source: {
        kind: isPhoto ? 'photo' : 'clip',
        key: shot.key,
        ...(isPhoto ? {} : { in: shot.start, out: round2(shot.start + overlayDuration) }),
      },
      style: isPhoto ? 'CARD' : 'FULL',
      motion: 'ZOOM_IN',
      label: shot.label,
      reason: decision.reason || `AI matched ${shot.category.toLowerCase()} to spoken dialogue`,
      decidedBy: 'ai',
      origin: shot.origin || (isPhoto ? 'library_photo' : 'this_clip'),
      isIllustrative: shot.isIllustrative,
    });

    currentTotalBroll += overlayDuration;
    lastOverlayEnd = overlayEnd;
  }

  return overlays;
}

/**
 * Main AI Edit Director workflow:
 * 1. Checks available pool and transcription cues.
 * 2. Compiles Edit Sheet and requests Gemini proposal with 5s timeout.
 * 3. Deterministically validates all decisions.
 * 4. Falls back to Phase 2 deterministic planner if Gemini is unavailable or fails.
 */
export async function planSmartEditsWithDirector(params: {
  clips: LabClip[];
  speechCues: CaptionCue[];
  totalNarrationDuration: number;
  projectName?: string;
  orgName?: string;
  language?: string;
  targetSeconds?: number;
  memoryCandidates?: BrollCandidate[];
}): Promise<RecipeOverlay[]> {
  const {
    clips,
    speechCues,
    totalNarrationDuration,
    projectName,
    orgName,
    language,
    targetSeconds,
    memoryCandidates,
  } = params;

  const rawPool = extractBrollPool(clips);

  // If memory candidates were not passed, discover missing categories from dialogue and search memory
  let memoryPool = memoryCandidates;
  if (!memoryPool) {
    const moments = findCategoryMomentsInCues(speechCues);
    const mentioned = Array.from(new Set(moments.map((m) => m.category)));
    const present = new Set(rawPool.map((r) => r.category));
    const missing = mentioned.filter((c) => !present.has(c));
    if (missing.length > 0) {
      memoryPool = await fetchMemoryBrollCandidates(missing).catch(() => []);
    }
  }

  const combinedPool = [...rawPool, ...(memoryPool || [])];
  if (!combinedPool.length || !speechCues.length || totalNarrationDuration < 6) {
    return [];
  }

  const identifiedPool = identifyBrollPool(combinedPool);
  const ai = getAIProvider();

  // If Gemini is not configured, immediately use Phase 2 deterministic planner with memory candidates
  if (!ai.isConfigured()) {
    logger.info('AI provider not configured, falling back to Phase 2 deterministic B-roll planner');
    return buildBrollPlan({ clips, speechCues, totalNarrationDuration, memoryCandidates: memoryPool });
  }

  try {
    const editSheet = buildEditSheet({
      projectName,
      orgName,
      language,
      targetSeconds,
      speechCues,
      identifiedPool,
      totalNarrationDuration,
    });

    const proposal = await proposeAiEdit(editSheet);
    const validatedOverlays = validateAiProposal({
      proposal,
      clips,
      identifiedPool,
      speechCues,
      totalNarrationDuration,
    });

    if (validatedOverlays.length > 0) {
      logger.info({ count: validatedOverlays.length }, 'AI Edit Director successfully produced validated B-roll overlays');
      return validatedOverlays;
    }

    // If AI decisions were all rejected by the rules engine, fallback to Phase 2
    logger.warn('AI Edit Director decisions were empty or rejected by validation rules, falling back to Phase 2 keyword planner');
    return buildBrollPlan({ clips, speechCues, totalNarrationDuration, memoryCandidates: memoryPool });
  } catch (err) {
    logger.warn({ err }, 'AI Edit Director failed or timed out, safely falling back to Phase 2 deterministic planner');
    return buildBrollPlan({ clips, speechCues, totalNarrationDuration, memoryCandidates: memoryPool });
  }
}

