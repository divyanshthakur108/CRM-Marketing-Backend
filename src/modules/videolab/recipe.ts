/**
 * Engine-independent "edit recipe" for one reel.
 * ffmpeg renders it today; Shotstack / Creatomate / Remotion adapters can render the same recipe later.
 */
import { buildCutPlan, CutStyle } from './cutPlan.js';

export type CaptionLanguage = 'hi' | 'pa' | 'en' | 'hinglish';
export type CaptionStyle = 'BOXED' | 'OUTLINE';
export type EndCardTemplate = 'HERITAGE_LUXURY' | 'HIGH_GROWTH_ROI';
/** 'speech' = captions come from what is said in each clip; 'typed' = lines typed by the admin */
export type CaptionSource = 'speech' | 'typed';
/** 'smart' = AI watched the clips and picks the best shots; 'whole' = use each clip from the start */
export type EditingMode = 'smart' | 'whole';

/** One caption on screen. Times are in seconds from the start of its clip (or cut). */
export interface CaptionCue {
  start: number;
  end: number;
  text: string;
}

export const SHOT_CATEGORIES = [
  'AERIAL',
  'EXTERIOR',
  'ENTRANCE',
  'LIVING',
  'KITCHEN',
  'BEDROOM',
  'BATHROOM',
  'BALCONY_VIEW',
  'AMENITY',
  'LOCATION',
  'PRESENTER',
  'OTHER',
] as const;
export type ShotCategory = (typeof SHOT_CATEGORIES)[number];

/** One shot inside a clip, as understood by the AI (times in seconds from the start of the clip) */
export interface ClipShot {
  start: number;
  end: number;
  label: string;
  category: ShotCategory;
  /** 1–5: steady, sharp, well lit, well framed */
  quality: number;
  /** 1–5: how strong it is as the first 2 seconds of a reel */
  hookScore: number;
  issues: string[];
  hasSpeech: boolean;
  /** The best usable part of the shot (skips shaky starts, accidental ends) */
  bestStart: number;
  bestEnd: number;
  keep: boolean;
  reason: string;
}

export interface TimeRange {
  start: number;
  end: number;
}

export interface LabClip {
  key: string;
  filename?: string;
  /** Duration of the uploaded clip */
  durationSeconds?: number;
  /** Timed captions from the speech in this clip (source = 'speech') */
  cues?: CaptionCue[];
  /** Shots found by "Understand clips" (editing = 'smart') */
  shots?: ClipShot[];
  /** Quiet moments, so cuts never land in the middle of a word */
  silences?: TimeRange[];
}

export interface LabFacts {
  orgName: string;
  projectName: string;
  phone?: string;
  rera?: string;
}

/** What the admin submits in the Video Lab */
export interface LabInput {
  clips: LabClip[];
  logoKey?: string;
  musicKey?: string;
  facts: LabFacts;
  captions: { language: CaptionLanguage; source?: CaptionSource; lines: string[] };
  editing?: EditingMode;
  /** Smart cut: wanted length of the video before the end card */
  targetSeconds?: number;
}

/** One piece of a source clip, placed on the final timeline in recipe order */
export interface RecipeCut {
  key: string;
  filename?: string;
  /** Seconds into the source clip */
  start: number;
  /** Seconds into the source clip; omitted = until the clip ends (max output.maxSecondsPerClip) */
  end?: number;
  label?: string;
  /** Speech captions inside this cut, in seconds from the start of the cut */
  cues?: CaptionCue[];
}

export interface EditRecipe {
  version: 2;
  variant: { index: number; label: string };
  output: { width: 1080; height: 1920; fps: 30; maxSecondsPerClip: number };
  editing: EditingMode;
  targetSeconds?: number;
  cuts: RecipeCut[];
  transitionSeconds: number;
  captions: { language: CaptionLanguage; style: CaptionStyle; source: CaptionSource; lines: string[] } | null;
  watermark: { logoKey?: string; text?: string };
  endCard: {
    template: EndCardTemplate;
    seconds: number;
    projectName: string;
    orgName: string;
    phone?: string;
    rera?: string;
    logoKey?: string;
  };
  music: { key: string; volume: number } | null;
}

/** End-card colours per template (from the existing style presets) */
export const END_CARD_THEMES: Record<EndCardTemplate, { background: string; accent: string; text: string }> = {
  HERITAGE_LUXURY: { background: '#0B1F3A', accent: '#C9A227', text: '#FFFFFF' },
  HIGH_GROWTH_ROI: { background: '#0A0A0A', accent: '#22D3EE', text: '#FFFFFF' },
};

type ClipOrder = 'original' | 'rotated' | 'reversed';

/** Each variant changes presentation only. Facts are identical in every variant. */
const VARIANT_PRESETS: Array<{
  order: ClipOrder;
  cutStyle: CutStyle;
  style: CaptionStyle;
  template: EndCardTemplate;
  musicVolume: number;
}> = [
  { order: 'original', cutStyle: 'STORY', style: 'BOXED', template: 'HERITAGE_LUXURY', musicVolume: 0.22 },
  { order: 'rotated', cutStyle: 'HOOK_FIRST', style: 'OUTLINE', template: 'HIGH_GROWTH_ROI', musicVolume: 0.16 },
  { order: 'reversed', cutStyle: 'FAST', style: 'OUTLINE', template: 'HERITAGE_LUXURY', musicVolume: 0.3 },
];

const CUT_STYLE_LABEL: Record<CutStyle, string> = {
  STORY: 'story order',
  HOOK_FIRST: 'best shot first',
  FAST: 'fast cuts',
};

export const MAX_VARIANTS = VARIANT_PRESETS.length;
export const DEFAULT_TARGET_SECONDS = 30;
const MAX_SECONDS_PER_CLIP = 25;

const clean = (value?: string): string | undefined => {
  const v = value?.trim();
  return v ? v : undefined;
};

function orderClips<T>(clips: T[], order: ClipOrder): T[] {
  if (clips.length < 2 || order === 'original') return [...clips];
  if (order === 'rotated') return [...clips.slice(1), clips[0]];
  return [...clips].reverse();
}

export function buildVariants(input: LabInput, count: number): EditRecipe[] {
  const total = Math.max(1, Math.min(MAX_VARIANTS, Math.floor(count) || 1));
  const facts = {
    orgName: input.facts.orgName.trim(),
    projectName: input.facts.projectName.trim(),
    phone: clean(input.facts.phone),
    rera: clean(input.facts.rera),
  };
  const source: CaptionSource = input.captions.source === 'speech' ? 'speech' : 'typed';
  const lines = source === 'typed' ? input.captions.lines.map((l) => l.trim()).filter(Boolean) : [];
  const clips: LabClip[] = input.clips.map((c) => ({ ...c, cues: source === 'speech' ? cleanCues(c.cues) : [] }));
  const smart = input.editing === 'smart' && clips.some((c) => c.shots?.some((s) => s.keep));
  const targetSeconds = Math.max(8, Math.min(90, input.targetSeconds || DEFAULT_TARGET_SECONDS));
  const transitionSeconds = smart ? 0.25 : 0.4;

  return VARIANT_PRESETS.slice(0, total).map((preset, index) => {
    const cuts: RecipeCut[] = smart
      ? buildCutPlan(clips, { targetSeconds, style: preset.cutStyle, transitionSeconds }).map((seg) => {
          const clip = clips.find((c) => c.key === seg.key)!;
          const cues = cuesForCut(clip.cues, seg.start, seg.end);
          return {
            key: seg.key,
            ...(clip.filename ? { filename: clip.filename } : {}),
            start: seg.start,
            end: seg.end,
            label: seg.label,
            ...(cues.length ? { cues } : {}),
          };
        })
      : orderClips(clips, preset.order).map((clip) => {
          const cues = cleanCues(clip.cues, MAX_SECONDS_PER_CLIP);
          return {
            key: clip.key,
            ...(clip.filename ? { filename: clip.filename } : {}),
            start: 0,
            ...(cues.length ? { cues } : {}),
          };
        });

    const hasCaptions = source === 'speech' ? cuts.some((c) => c.cues?.length) : lines.length > 0;
    const labelParts = [
      `Variant ${String.fromCharCode(65 + index)}`,
      smart ? `smart cut, ${CUT_STYLE_LABEL[preset.cutStyle]}` : clips.length > 1 ? `${preset.order} clip order` : null,
      hasCaptions ? `${preset.style === 'BOXED' ? 'boxed' : 'outline'} ${source === 'speech' ? 'speech ' : ''}captions` : null,
      preset.template === 'HERITAGE_LUXURY' ? 'Heritage end card' : 'High-Growth end card',
      input.musicKey ? `music ${Math.round(preset.musicVolume * 100)}%` : null,
    ].filter(Boolean);

    return {
      version: 2,
      variant: { index, label: labelParts.join(' · ') },
      output: { width: 1080, height: 1920, fps: 30, maxSecondsPerClip: MAX_SECONDS_PER_CLIP },
      editing: smart ? 'smart' : 'whole',
      ...(smart ? { targetSeconds } : {}),
      cuts,
      transitionSeconds,
      captions: hasCaptions ? { language: input.captions.language, style: preset.style, source, lines } : null,
      watermark: input.logoKey ? { logoKey: input.logoKey } : { text: facts.orgName },
      endCard: {
        template: preset.template,
        seconds: 2.4,
        projectName: facts.projectName,
        orgName: facts.orgName,
        ...(facts.phone ? { phone: facts.phone } : {}),
        ...(facts.rera ? { rera: facts.rera } : {}),
        ...(input.logoKey ? { logoKey: input.logoKey } : {}),
      },
      music: input.musicKey ? { key: input.musicKey, volume: preset.musicVolume } : null,
    };
  });
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Sorts cues, drops empty ones and fixes bad or overlapping times */
export function cleanCues(cues: CaptionCue[] | undefined, maxSeconds = Infinity): CaptionCue[] {
  const sorted = (cues || [])
    .map((c) => ({ start: Number(c.start), end: Number(c.end), text: String(c.text ?? '').trim() }))
    .filter((c) => c.text && Number.isFinite(c.start) && Number.isFinite(c.end) && c.start >= 0 && c.start < maxSeconds)
    .sort((a, b) => a.start - b.start);

  const out: CaptionCue[] = [];
  sorted.forEach((c, i) => {
    const next = sorted[i + 1];
    let end = Math.min(c.end, maxSeconds);
    if (end - c.start < 0.6) end = c.start + 0.6; // keep every caption readable
    if (next && end > next.start - 0.05) end = next.start - 0.05; // never overlap the next caption
    end = Math.min(end, maxSeconds);
    if (end > c.start) out.push({ start: round2(c.start), end: round2(end), text: c.text });
  });
  return out;
}

/** Captions that are spoken inside [start, end] of a clip, re-timed from the start of the cut */
export function cuesForCut(cues: CaptionCue[] | undefined, start: number, end: number): CaptionCue[] {
  const out: CaptionCue[] = [];
  for (const cue of cues || []) {
    const overlap = Math.min(cue.end, end) - Math.max(cue.start, start);
    // Keep a caption only if most of it is inside the cut
    if (overlap < Math.min(0.5, (cue.end - cue.start) / 2)) continue;
    out.push({
      start: round2(Math.max(cue.start, start) - start),
      end: round2(Math.min(cue.end, end) - start),
      text: cue.text,
    });
  }
  return cleanCues(out, end - start);
}

/**
 * Moves each cut's cues onto the merged timeline.
 * Cut i starts at sum(previous durations) - i × crossfade.
 */
export function placeCuesOnTimeline(
  cuts: Array<{ cues?: CaptionCue[] }>,
  segmentDurations: number[],
  crossfadeSeconds: number
): CaptionCue[] {
  const all: CaptionCue[] = [];
  let offset = 0;
  cuts.forEach((cut, i) => {
    const duration = segmentDurations[i] ?? 0;
    for (const cue of cleanCues(cut.cues, duration)) {
      all.push({ start: offset + cue.start, end: offset + cue.end, text: cue.text });
    }
    offset += duration - crossfadeSeconds;
  });
  return cleanCues(all);
}
