/**
 * Creator-style editing rules (R4):
 * 1. Text hook in the first 2.5s (pop-in title, brand accent color, Indic script support, no caption overlap).
 * 2. Punch-in zoom on the presenter (hides jump cuts, snaps to word boundaries, never in first 1s, never on B-roll).
 * 3. Fewer effects (short crossfades 0.15-0.25s, plain cuts between consecutive cuts of the same clip).
 */
import { CaptionCue, CueWord, LabFacts, RecipeCut, RecipeOverlay } from './recipe.js';

export const SHORT_CROSSFADE_SECONDS = 0.2;
export const SAME_CLIP_TRANSITION_SECONDS = 0;
export const HOOK_START_SECONDS = 0.2;
export const HOOK_END_SECONDS = 2.4;

export interface RecipeHook {
  text: string;
  startSeconds: number;
  endSeconds: number;
}

export interface RecipeZoom {
  start: number;
  end: number;
  from: number;
  to: number;
}

export interface CreatorStyleOptions {
  hookText?: boolean;
  punchInZoom?: boolean;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Builds the opening text hook strictly from client-typed facts or caption keywords.
 * NEVER invents unverified claims or prices.
 */
export function buildHookText(params: {
  facts: { projectName: string; phone?: string; rera?: string };
  keywords?: string[];
  cues?: CaptionCue[];
}): string {
  const { facts, keywords, cues } = params;
  const project = (facts.projectName || '').trim();
  const phone = facts.phone?.trim();
  const rera = facts.rera?.trim();

  // 1. Check for a prominent keyword from transcript or explicit keywords
  let firstKeyword = (keywords || []).map((k) => k.trim()).filter(Boolean)[0];
  if (!firstKeyword && cues?.length) {
    for (const cue of cues) {
      const kw = cue.words?.find((w) => w.isKeyword && w.text.trim());
      if (kw) {
        firstKeyword = kw.text.trim();
        break;
      }
    }
  }

  // If a caption keyword exists (e.g. "3 BHK", "Luxury Villa", "Mohali", "ਬੇਡਰੂਮ")
  if (firstKeyword) {
    const cleanKw = firstKeyword.replace(/^[^\p{L}\p{N}\p{M}]+|[^\p{L}\p{N}\p{M}]+$/gu, '').trim();
    if (cleanKw && cleanKw.toLowerCase() !== project.toLowerCase()) {
      return `${cleanKw} · ${project}`;
    }
  }

  // 2. Otherwise build from typed facts (project name, and phone or RERA only if filled in)
  const parts: string[] = [project];
  if (phone) {
    parts.push(phone);
  } else if (rera) {
    parts.push(`RERA: ${rera}`);
  }

  return parts.filter(Boolean).join(' · ') || project || 'Exclusive Tour';
}

/**
 * Plans presenter punch-in zooms for longer continuous talking stretches.
 * Rules:
 * - A-roll only (strictly never on B-roll overlay intervals)
 * - Never during the first 1.0s of the video
 * - Snaps zoom start point to caption word boundaries
 * - Slow 1.00 to 1.08 (or alternating 1.00 to 1.06) zoom-in
 * - Resets at each cut so zooms feel intentional
 */
export function planZooms(params: {
  cuts: RecipeCut[];
  overlays?: RecipeOverlay[];
  speechCues?: CaptionCue[];
  totalDuration: number;
  enabled?: boolean;
}): RecipeZoom[] {
  if (params.enabled === false) return [];
  const { cuts, overlays = [], speechCues = [], totalDuration } = params;
  if (!cuts.length || totalDuration < 3.0) return [];

  // 1. Build word start boundaries (>= 1.0s)
  const wordStarts: number[] = [];
  const wordEnds: number[] = [];
  for (const cue of speechCues) {
    if (cue.words?.length) {
      for (const w of cue.words) {
        if (w.start >= 1.0) wordStarts.push(round2(w.start));
        if (w.end > 1.0) wordEnds.push(round2(w.end));
      }
    } else {
      if (cue.start >= 1.0) wordStarts.push(round2(cue.start));
      if (cue.end > 1.0) wordEnds.push(round2(cue.end));
    }
  }
  wordStarts.sort((a, b) => a - b);
  wordEnds.sort((a, b) => a - b);

  // 2. Identify A-roll timeline intervals
  // Calculate cut boundaries on merged timeline
  const cutIntervals: Array<{ start: number; end: number; key: string }> = [];
  let curTimeline = 0;
  for (let i = 0; i < cuts.length; i++) {
    const cut = cuts[i];
    const dur = Math.max(0.1, (cut.end ?? 10) - cut.start);
    const start = curTimeline;
    const end = curTimeline + dur;
    cutIntervals.push({ start: round2(start), end: round2(end), key: cut.key });
    // transition offset
    const trans = i < cuts.length - 1 && cuts[i].key === cuts[i + 1].key
      ? SAME_CLIP_TRANSITION_SECONDS
      : SHORT_CROSSFADE_SECONDS;
    curTimeline = end - trans;
  }

  // 3. For each cut, find segments not covered by B-roll overlays
  const sortedOverlays = [...overlays].sort((a, b) => a.start - b.start);
  const zooms: RecipeZoom[] = [];
  let zoomIndex = 0;

  for (let cutIdx = 0; cutIdx < cutIntervals.length; cutIdx++) {
    const cut = cutIntervals[cutIdx];
    // Find overlay intervals overlapping this cut
    const cutOverlays = sortedOverlays.filter(
      (ov) => ov.start < cut.end - 0.2 && ov.end > cut.start + 0.2
    );

    // Split cut into presenter-visible stretches
    const presenterStretches: Array<{ start: number; end: number }> = [];
    let stretchStart = cut.start;

    for (const ov of cutOverlays) {
      if (ov.start > stretchStart + 0.5) {
        presenterStretches.push({ start: stretchStart, end: Math.min(ov.start, cut.end) });
      }
      stretchStart = Math.max(stretchStart, ov.end);
    }
    if (stretchStart < cut.end - 0.5) {
      presenterStretches.push({ start: stretchStart, end: cut.end });
    }

    // Evaluate each presenter stretch for punch-in zoom
    for (const stretch of presenterStretches) {
      // Must be after first 1.0s of the video
      const minStart = Math.max(1.0, stretch.start);
      if (stretch.end - minStart < 2.0) {
        // Too short for a slow, intentional zoom
        continue;
      }

      // Snap start to nearest caption word boundary >= minStart
      let snappedStart = wordStarts.find((ws) => ws >= minStart && ws < stretch.end - 1.5);
      if (snappedStart === undefined) {
        // Fallback to minStart if no word boundary found within window
        snappedStart = minStart;
      }

      // Snap end to nearest word end or stretch end
      let snappedEnd = wordEnds.filter((we) => we > snappedStart && we <= stretch.end).pop();
      if (snappedEnd === undefined || snappedEnd - snappedStart < 1.5) {
        snappedEnd = stretch.end;
      }

      const dur = snappedEnd - snappedStart;
      if (dur >= 1.5) {
        // Alternate zoom target between 1.08 and 1.06 across cuts/stretches
        const targetZoom = zoomIndex % 2 === 0 ? 1.08 : 1.06;
        zooms.push({
          start: round2(snappedStart),
          end: round2(snappedEnd),
          from: 1.00,
          to: targetZoom,
        });
        zoomIndex++;
      }
    }
  }

  return zooms;
}

/**
 * Builds the ffmpeg zoompan expression from planned zooms.
 */
export function buildZoomExpression(zooms: RecipeZoom[]): string {
  if (!zooms || !zooms.length) return '1.00';
  let expr = '1.00';
  for (let i = zooms.length - 1; i >= 0; i--) {
    const z = zooms[i];
    const dur = Math.max(0.1, z.end - z.start);
    const zExpr = `${z.from.toFixed(2)}+${(z.to - z.from).toFixed(2)}*(time-${z.start.toFixed(2)})/${dur.toFixed(2)}`;
    expr = `if(between(time,${z.start.toFixed(2)},${z.end.toFixed(2)}),${zExpr},${expr})`;
  }
  return expr;
}

