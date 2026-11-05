import type { LabClip, ShotCategory, TimeRange } from './recipe.js';

/**
 * Smart cut: turns the shots the AI found in each clip into an ordered list of cuts.
 *
 * Rules (plain editing rules, no AI here):
 * - Only shots marked "keep" are used. Each shot uses its best part (skips shaky starts / accidental ends).
 * - Shots with speech are never trimmed mid-sentence: their edges move to the nearest quiet moment.
 * - Speech keeps its original order. Shots without speech (b-roll) follow a property-tour order:
 *   aerial → exterior → entrance → living → kitchen → bedroom → bathroom → balcony/view → amenities → location.
 * - The best shots are picked until the target length is reached.
 */

export type CutStyle = 'STORY' | 'HOOK_FIRST' | 'FAST';

export interface PlannedCut {
  key: string;
  start: number;
  end: number;
  label: string;
}

const STORY_RANK: Record<ShotCategory, number> = {
  AERIAL: 0,
  EXTERIOR: 1,
  ENTRANCE: 2,
  LIVING: 3,
  KITCHEN: 4,
  BEDROOM: 5,
  BATHROOM: 6,
  BALCONY_VIEW: 7,
  AMENITY: 8,
  LOCATION: 9,
  PRESENTER: 10,
  OTHER: 11,
};

/** Shortest cut worth showing */
export const MIN_CUT_SECONDS = 1.2;
/** Longest b-roll cut per style */
const MAX_BROLL_SECONDS: Record<CutStyle, number> = { STORY: 4.5, HOOK_FIRST: 4.5, FAST: 2.5 };
const HOOK_SECONDS = 2.5;
/** Problems that make a shot a bad opening, and lower its priority elsewhere */
const SERIOUS_ISSUES = new Set(['text_or_watermark', 'blurry', 'too_dark', 'overexposed', 'obstructed', 'camera_pointing_down']);

interface Candidate {
  key: string;
  clipIndex: number;
  start: number;
  end: number;
  label: string;
  category: ShotCategory;
  quality: number;
  hookScore: number;
  /** Number of serious problems (watermark, blur, dark…) */
  problems: number;
  speech: boolean;
}

/** Higher = better b-roll: quality matters most, each serious problem costs a full quality point */
const score = (c: Candidate) => c.quality * 2 + c.hookScore * 0.5 - c.problems * 2;

const round2 = (n: number) => Math.round(n * 100) / 100;
const length = (c: { start: number; end: number }) => c.end - c.start;

/** Moves a time to the nearest quiet moment (within maxShift seconds), so a cut never splits a word */
export function snapToSilence(t: number, silences: TimeRange[] | undefined, maxShift = 0.8): number {
  let best = t;
  let bestDistance = Infinity;
  for (const s of silences || []) {
    const point = Math.min(Math.max(t, s.start), s.end);
    const distance = Math.abs(point - t);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = point;
    }
  }
  return bestDistance <= maxShift ? best : t;
}

/** Visible length after crossfades */
function timelineLength(cuts: Array<{ start: number; end: number }>, transition: number): number {
  if (!cuts.length) return 0;
  return cuts.reduce((sum, c) => sum + length(c), 0) - transition * (cuts.length - 1);
}

export function buildCutPlan(
  clips: LabClip[],
  opts: { targetSeconds: number; style: CutStyle; transitionSeconds: number }
): PlannedCut[] {
  const { targetSeconds, style, transitionSeconds } = opts;
  const speech: Candidate[] = [];
  const broll: Candidate[] = [];

  clips.forEach((clip, clipIndex) => {
    const shots = [...(clip.shots || [])].filter((s) => s.keep).sort((a, b) => a.start - b.start);
    for (const shot of shots) {
      const base = {
        key: clip.key,
        clipIndex,
        label: shot.label,
        category: shot.category,
        quality: shot.quality,
        hookScore: shot.hookScore,
        problems: (shot.issues || []).filter((i) => SERIOUS_ISSUES.has(i)).length,
      };
      if (shot.hasSpeech) {
        const start = snapToSilence(shot.start, clip.silences);
        const end = snapToSilence(shot.end, clip.silences);
        if (end - start >= MIN_CUT_SECONDS) speech.push({ ...base, start, end, speech: true });
      } else {
        const start = shot.bestStart;
        const end = Math.min(shot.bestEnd, start + MAX_BROLL_SECONDS[style]);
        if (end - start >= MIN_CUT_SECONDS) broll.push({ ...base, start, end, speech: false });
      }
    }
  });

  // 1. Speech first (it carries the message), in the order it was said. Leave room for b-roll if there is any.
  const speechBudget = broll.length ? targetSeconds * 0.7 : targetSeconds;
  const pickedSpeech: Candidate[] = [];
  for (const cand of speech.sort((a, b) => a.clipIndex - b.clipIndex || a.start - b.start)) {
    const used = timelineLength(pickedSpeech, transitionSeconds);
    if (pickedSpeech.length && used >= speechBudget) break;
    const room = speechBudget - used;
    if (length(cand) > room + 3) {
      // Too long: end at a quiet moment near the budget
      const clip = clips[cand.clipIndex];
      const end = snapToSilence(cand.start + Math.max(room, MIN_CUT_SECONDS), clip.silences, 2.5);
      if (end - cand.start >= MIN_CUT_SECONDS) pickedSpeech.push({ ...cand, end });
      break;
    }
    pickedSpeech.push(cand);
  }

  // 2. Best b-roll until the target length is reached
  const pickedBroll: Candidate[] = [];
  const byScore = [...broll].sort((a, b) => score(b) - score(a) || a.clipIndex - b.clipIndex);
  for (const cand of byScore) {
    if (timelineLength([...pickedSpeech, ...pickedBroll], transitionSeconds) >= targetSeconds) break;
    pickedBroll.push(cand);
  }

  // 3. Order: b-roll in property-tour order; the strongest hook first for HOOK_FIRST
  const storyOrder = pickedBroll.sort(
    (a, b) => STORY_RANK[a.category] - STORY_RANK[b.category] || a.clipIndex - b.clipIndex || a.start - b.start
  );
  let hook: Candidate | null = null;
  const hookOptions = storyOrder.filter((c) => c.problems === 0);
  if (style === 'HOOK_FIRST' && hookOptions.length) {
    const best = [...hookOptions].sort((a, b) => b.hookScore - a.hookScore || b.quality - a.quality)[0];
    storyOrder.splice(storyOrder.indexOf(best), 1);
    hook = { ...best, end: Math.min(best.end, best.start + HOOK_SECONDS) };
  }

  // 4. Speech blocks with b-roll spread between them (cutaways between sentences)
  const ordered: Candidate[] = hook ? [hook] : [];
  if (!pickedSpeech.length) {
    ordered.push(...storyOrder);
  } else {
    let remaining = [...storyOrder];
    pickedSpeech.forEach((block, i) => {
      ordered.push(block);
      const take = Math.ceil(remaining.length / (pickedSpeech.length - i));
      ordered.push(...remaining.slice(0, take));
      remaining = remaining.slice(take);
    });
  }

  // 5. Join cuts that continue each other in the same clip (no crossfade in the middle of a sentence)
  const merged: PlannedCut[] = [];
  for (const c of ordered) {
    const prev = merged[merged.length - 1];
    if (prev && prev.key === c.key && Math.abs(c.start - prev.end) < 0.35) {
      prev.end = round2(c.end);
      if (!prev.label.includes(c.label)) prev.label = `${prev.label} → ${c.label}`;
      continue;
    }
    merged.push({ key: c.key, start: round2(c.start), end: round2(c.end), label: c.label });
  }
  return merged;
}
