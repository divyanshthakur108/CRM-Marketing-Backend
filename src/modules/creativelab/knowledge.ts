/**
 * Knowledge cards for the Creative Lab: the shapes we store, the prompts we send to Gemini,
 * and the functions that clean Gemini's answer (pure functions, unit tested).
 *
 * Rule: describe only what is visible / audible / written. Never invent sizes, prices,
 * distances or brand names. Missing information stays null.
 */

export const SPACES = [
  'EXTERIOR_ELEVATION',
  'AERIAL',
  'ENTRANCE_LOBBY',
  'LIVING',
  'DINING',
  'KITCHEN',
  'BEDROOM',
  'BATHROOM',
  'BALCONY_TERRACE',
  'STAIRCASE',
  'AMENITY',
  'PARKING',
  'LOCATION_SURROUNDINGS',
  'CONSTRUCTION_SITE',
  'FLOOR_PLAN',
  'PRESENTER',
  'BROCHURE_GRAPHIC',
  'OTHER',
] as const;
export type Space = (typeof SPACES)[number];

export const IMAGE_SOURCE_TYPES = ['REAL_PHOTO', '3D_RENDER', 'GRAPHIC_OR_BROCHURE', 'SCREENSHOT', 'UNSURE'] as const;
export const VIDEO_SOURCE_TYPES = ['REAL_FOOTAGE', 'RENDER_ANIMATION', 'SCREEN_RECORDING', 'MIXED', 'UNSURE'] as const;

export const QUALITY_ISSUES = [
  'blurry',
  'shaky',
  'too_dark',
  'overexposed',
  'tilted',
  'low_resolution',
  'cluttered',
  'obstructed',
  'people_unprepared',
  'text_or_watermark',
  'other_brand_logo',
  'camera_pointing_down',
  'accidental',
] as const;

/** Content ideas a file can feed (the idea library in docs/IDEA_LIBRARY.md uses the same ids) */
export const IDEA_TAGS = {
  drone_reveal: 'Drone reveal / rise up the building',
  orbit_360: 'Orbit around the building',
  construction_timelapse: 'Empty plot → finished building timelapse',
  day_to_night: 'Day → night (lights come on)',
  weather_mood: 'Season / weather mood (monsoon, golden hour, fog)',
  virtual_staging: 'Empty room → furnished reveal',
  walkthrough: 'Walkthrough made from stills or clips',
  lifestyle_moment: '"A day in this home" lifestyle moment',
  floor_plan_3d: 'Floor plan → 3D room',
  before_after: 'Before / after comparison',
  presenter_background: 'Background behind a talking presenter',
  presenter_cutaway: 'Cutaway while a presenter talks',
  location_explainer: 'Location / connectivity explainer',
  construction_update: 'Monthly construction progress update',
  testimonial: 'Testimonial / handover story',
  behind_the_scenes: 'Behind the scenes / site visit',
  hook_opening: 'First 2 seconds hook of a reel',
  festival_post: 'Festival greeting post',
  launch_or_urgency_post: 'Launch countdown / last units post',
  hero_post: 'Single hero image post',
  carousel_post: 'Carousel slide',
  cover_thumbnail: 'Reel cover / thumbnail',
} as const;
export type IdeaTag = keyof typeof IDEA_TAGS;
const IDEA_IDS = Object.keys(IDEA_TAGS) as IdeaTag[];

// ── Shapes ──────────────────────────────────────────────────────────────────

export interface ProjectBrief {
  projectName: string | null;
  developer: string | null;
  city: string | null;
  locality: string | null;
  propertyType: string | null;
  configurations: string[];
  sizes: string[];
  floors: string | null;
  towersOrBlocks: string | null;
  totalUnits: string | null;
  price: string | null;
  possession: string | null;
  reraNumber: string | null;
  amenities: string[];
  nearbyPlaces: Array<{ name: string; distance: string | null }>;
  highlights: string[];
  targetBuyer: string | null;
  contact: string | null;
  /** Important facts a marketing reel would need that the text does not give */
  missingFacts: string[];
  summary: string;
}

export interface IdeaUse {
  idea: IdeaTag;
  why: string;
}

export interface QualityInfo {
  score: number;
  issues: string[];
}

export interface ImageKnowledge {
  kind: 'image';
  title: string;
  description: string;
  sourceType: (typeof IMAGE_SOURCE_TYPES)[number];
  space: Space;
  spaceDetail: string;
  visibleElements: string[];
  materialsAndFinishes: string[];
  colors: string[];
  lighting: { timeOfDay: string; notes: string };
  camera: { shotType: string; angle: string };
  people: { present: boolean; count: number; description: string };
  textInImage: string[];
  logosOrWatermarks: string[];
  quality: QualityInfo;
  composition: { mainSubject: string; emptySpaceForText: string[] };
  animation: { imageToVideoScore: number; suggestedMotion: string; risks: string };
  bestUses: IdeaUse[];
  matchesProjectInfo: string[];
  conflictsWithProjectInfo: string[];
  tags: string[];
  searchText: string;
}

export interface VideoShotKnowledge {
  start: number;
  end: number;
  title: string;
  description: string;
  space: Space;
  visibleElements: string[];
  materialsAndFinishes: string[];
  cameraMotion: string;
  people: string;
  textOnScreen: string[];
  quality: QualityInfo;
  hookScore: number;
  bestStart: number;
  bestEnd: number;
  keep: boolean;
  reason: string;
  bestUses: IdeaUse[];
  thumbnail?: string;
}

export interface TranscriptLine {
  start: number;
  end: number;
  text: string;
}

export interface VideoKnowledge {
  kind: 'video';
  title: string;
  summary: string;
  sourceType: (typeof VIDEO_SOURCE_TYPES)[number];
  filmedWith: string;
  durationSeconds: number;
  analyzedSeconds: number;
  speech: { hasSpeech: boolean; language: string; speakers: string; transcript: TranscriptLine[] };
  hasMusic: boolean;
  quality: QualityInfo;
  shots: VideoShotKnowledge[];
  sceneCuts: number[];
  bestUses: IdeaUse[];
  matchesProjectInfo: string[];
  conflictsWithProjectInfo: string[];
  tags: string[];
  searchText: string;
}

// ── Prompts ─────────────────────────────────────────────────────────────────

const ideaList = IDEA_IDS.map((id) => `${id} (${IDEA_TAGS[id]})`).join('; ');

const briefContext = (brief?: ProjectBrief | null, infoText?: string) => {
  const caution =
    'This information is NOT proof of what the file shows or where it was shot. Do not assume the file shows this project, ' +
    'its city or its location unless the file itself shows it (e.g. the project name on a board). ' +
    'Put a fact in "matchesProjectInfo" only when the file visibly or audibly confirms it.';
  if (brief) return `Project information given by the client:\n${JSON.stringify(brief)}\n${caution}`;
  if (infoText?.trim()) return `Project information given by the client:\n${infoText.trim().slice(0, 3000)}\n${caution}`;
  return 'No project information was given.';
};

export function buildBriefPrompt(infoText: string): string {
  return `You are preparing a fact sheet for an Indian real-estate marketing team.
Read the project information below and extract ONLY what is written. Never guess or add facts.
If something is not written, use null (or an empty list).

Project information:
"""
${infoText.trim().slice(0, 6000)}
"""

Return only JSON with exactly these keys:
{"projectName": string|null, "developer": string|null, "city": string|null, "locality": string|null,
 "propertyType": string|null (e.g. "apartments", "villas", "plots", "commercial"),
 "configurations": string[] (e.g. "3 BHK"), "sizes": string[] (with units as written, e.g. "1,850 sq ft super area"),
 "floors": string|null, "towersOrBlocks": string|null, "totalUnits": string|null, "price": string|null,
 "possession": string|null, "reraNumber": string|null, "amenities": string[],
 "nearbyPlaces": [{"name": string, "distance": string|null}], "highlights": string[],
 "targetBuyer": string|null, "contact": string|null,
 "missingFacts": string[] (important facts a property ad usually needs that are NOT in the text, e.g. "RERA number", "price"),
 "summary": string (2 sentences, using only the facts above)}`;
}

export function buildImagePrompt(brief?: ProjectBrief | null, infoText?: string): string {
  return `You are the creative analyst for an Indian real-estate marketing studio.
Study this image in depth and write a "knowledge card" that a planner will later use to pick content ideas
without looking at the image again. Be specific and concrete.

${briefContext(brief, infoText)}

Rules:
- Describe only what is actually visible. Do not guess sizes, prices, floor counts you cannot count, or brand names.
- Use the project information only to spot matches or conflicts (e.g. info says 12 floors, image shows about 8).
- "sourceType": is this a real photograph, a 3D render, a graphic/brochure, or a screenshot?

Return only JSON:
{"title": "3-8 words",
 "description": "3-5 sentences, concrete and visual",
 "sourceType": one of ${IMAGE_SOURCE_TYPES.join(', ')},
 "space": one of ${SPACES.join(', ')},
 "spaceDetail": "e.g. 'front elevation of a residential tower', 'modular kitchen with island'",
 "visibleElements": ["concrete things you can see"],
 "materialsAndFinishes": ["e.g. 'marble flooring', 'glass railing', 'wooden cabinets'"],
 "colors": ["main colours"],
 "lighting": {"timeOfDay": "day | golden_hour | dusk | night | indoor_artificial | unknown", "notes": "..."},
 "camera": {"shotType": "wide | medium | close_up | aerial | detail", "angle": "eye_level | low_angle | high_angle | top_down"},
 "people": {"present": true|false, "count": number, "description": "..."},
 "textInImage": ["exact text visible, e.g. RERA no., phone, project name"],
 "logosOrWatermarks": ["any logo or watermark, including other companies'"],
 "quality": {"score": 1-5, "issues": [any of ${QUALITY_ISSUES.join(', ')}]},
 "composition": {"mainSubject": "...", "emptySpaceForText": ["top" | "bottom" | "left" | "right" | "sky"]},
 "animation": {"imageToVideoScore": 1-5 (how well this would animate into a short realistic video clip),
               "suggestedMotion": "e.g. 'slow drone rise from street level'", "risks": "what an AI video model might get wrong"},
 "bestUses": [{"idea": one of the ids below, "why": "one sentence"}] (2-5 items, best first),
 "matchesProjectInfo": ["facts from the project information this image supports"],
 "conflictsWithProjectInfo": ["anything that disagrees with the project information"],
 "tags": ["8-15 short search tags"],
 "searchText": "one paragraph summarising everything above, for text search"}

Idea ids: ${ideaList}`;
}

export function buildVideoPrompt(params: {
  analyzedSeconds: number;
  sceneCuts: number[];
  hasAudio: boolean;
  brief?: ProjectBrief | null;
  infoText?: string;
}): string {
  const { analyzedSeconds, sceneCuts, hasAudio } = params;
  return `You are the creative analyst for an Indian real-estate marketing studio.
Watch this clip (${analyzedSeconds.toFixed(1)} seconds${hasAudio ? '' : ', no sound'}) and write a detailed "knowledge card"
that a planner and an automatic editor will use later without watching it again.

${briefContext(params.brief, params.infoText)}

Exact hard cuts found by scene detection (seconds): ${sceneCuts.length ? sceneCuts.map((t) => t.toFixed(2)).join(', ') : 'none'}.
Split the clip into shots at these cuts, and also where the subject clearly changes during a continuous move
(e.g. walking from the living room into the kitchen). Shots follow each other and cover 0 to ${analyzedSeconds.toFixed(1)}.

Rules:
- Describe only what is actually visible or audible. Do not guess sizes, prices or brand names.
- Transcript: write exactly what is said, in the language spoken (Hindi/Punjabi in their own script, English as English), with times.
- Use the project information only to spot matches or conflicts.

Return only JSON:
{"title": "3-8 words",
 "summary": "3-5 sentences about the whole clip",
 "sourceType": one of ${VIDEO_SOURCE_TYPES.join(', ')},
 "filmedWith": "drone | gimbal | handheld_phone | tripod | mixed | unknown",
 "speech": {"hasSpeech": true|false, "language": "e.g. hindi, punjabi, english, hinglish, none",
            "speakers": "who speaks and how they appear", "transcript": [{"start": 0, "end": 2.5, "text": "..."}]},
 "hasMusic": true|false,
 "quality": {"score": 1-5, "issues": [any of ${QUALITY_ISSUES.join(', ')}]},
 "shots": [{"start": 0, "end": 4.2, "title": "3-8 words", "description": "2-3 concrete sentences",
            "space": one of ${SPACES.join(', ')},
            "visibleElements": ["..."], "materialsAndFinishes": ["..."],
            "cameraMotion": "static | pan | tilt | push_in | pull_out | walk_through | orbit | drone_rise | handheld",
            "people": "who is visible, or 'none'", "textOnScreen": ["exact text"],
            "quality": {"score": 1-5, "issues": [...]},
            "hookScore": 1-5 (strength as the first 2 seconds of a reel),
            "bestStart": seconds, "bestEnd": seconds (best usable part inside the shot),
            "keep": true|false (false only for unusable footage), "reason": "one sentence",
            "bestUses": [{"idea": idea id, "why": "..."}]}],
 "bestUses": [{"idea": idea id, "why": "one sentence"}] (2-5 items for the whole clip),
 "matchesProjectInfo": ["..."], "conflictsWithProjectInfo": ["..."],
 "tags": ["8-15 short search tags"],
 "searchText": "one paragraph summarising everything above, for text search"}

Idea ids: ${ideaList}`;
}

// ── Cleaning Gemini's answer ────────────────────────────────────────────────

type Raw = Record<string, unknown>;
const obj = (v: unknown): Raw => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Raw) : {});
const str = (v: unknown, max = 600): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const strOrNull = (v: unknown, max = 300): string | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  const s = str(v, max);
  return s && !/^(null|n\/a|unknown|not (given|mentioned|specified))$/i.test(s) ? s : null;
};
const strList = (v: unknown, maxItems = 30, maxLen = 160): string[] =>
  Array.isArray(v)
    ? [...new Set(v.map((x) => (typeof x === 'number' ? String(x) : str(x, maxLen))).filter(Boolean))].slice(0, maxItems)
    : [];
const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  (allowed as readonly string[]).includes(String(v)) ? (String(v) as T) : fallback;
const clampInt = (v: unknown, min: number, max: number, fallback: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
const round2 = (n: number) => Math.round(n * 100) / 100;

function cleanQuality(v: unknown): QualityInfo {
  const q = obj(v);
  return {
    score: clampInt(q.score, 1, 5, 3),
    issues: strList(q.issues).filter((i) => (QUALITY_ISSUES as readonly string[]).includes(i)),
  };
}

export function cleanIdeaUses(v: unknown, max = 5): IdeaUse[] {
  if (!Array.isArray(v)) return [];
  const seen = new Set<string>();
  const out: IdeaUse[] = [];
  for (const item of v) {
    const r = obj(item);
    const idea = String(r.idea || '');
    if (!(IDEA_IDS as string[]).includes(idea) || seen.has(idea)) continue;
    seen.add(idea);
    out.push({ idea: idea as IdeaTag, why: str(r.why, 240) });
    if (out.length >= max) break;
  }
  return out;
}

export function cleanBrief(raw: unknown): ProjectBrief {
  const r = obj(raw);
  return {
    projectName: strOrNull(r.projectName),
    developer: strOrNull(r.developer),
    city: strOrNull(r.city),
    locality: strOrNull(r.locality),
    propertyType: strOrNull(r.propertyType),
    configurations: strList(r.configurations),
    sizes: strList(r.sizes),
    floors: strOrNull(r.floors),
    towersOrBlocks: strOrNull(r.towersOrBlocks),
    totalUnits: strOrNull(r.totalUnits),
    price: strOrNull(r.price),
    possession: strOrNull(r.possession),
    reraNumber: strOrNull(r.reraNumber),
    amenities: strList(r.amenities, 40),
    nearbyPlaces: Array.isArray(r.nearbyPlaces)
      ? r.nearbyPlaces
          .map((p) => obj(p))
          .map((p) => ({ name: str(p.name, 120), distance: strOrNull(p.distance, 60) }))
          .filter((p) => p.name)
          .slice(0, 20)
      : [],
    highlights: strList(r.highlights),
    targetBuyer: strOrNull(r.targetBuyer),
    contact: strOrNull(r.contact),
    missingFacts: strList(r.missingFacts),
    summary: str(r.summary, 800),
  };
}

export function cleanImageKnowledge(raw: unknown): ImageKnowledge {
  const r = obj(raw);
  const lighting = obj(r.lighting);
  const camera = obj(r.camera);
  const people = obj(r.people);
  const composition = obj(r.composition);
  const animation = obj(r.animation);
  const peopleCount = clampInt(people.count, 0, 500, 0);
  return {
    kind: 'image',
    title: str(r.title, 100) || 'Untitled image',
    description: str(r.description, 1500),
    sourceType: oneOf(r.sourceType, IMAGE_SOURCE_TYPES, 'UNSURE'),
    space: oneOf(r.space, SPACES, 'OTHER'),
    spaceDetail: str(r.spaceDetail, 200),
    visibleElements: strList(r.visibleElements, 40),
    materialsAndFinishes: strList(r.materialsAndFinishes),
    colors: strList(r.colors, 12, 40),
    lighting: { timeOfDay: str(lighting.timeOfDay, 40) || 'unknown', notes: str(lighting.notes, 300) },
    camera: { shotType: str(camera.shotType, 40), angle: str(camera.angle, 40) },
    people: { present: people.present === true || peopleCount > 0, count: peopleCount, description: str(people.description, 300) },
    textInImage: strList(r.textInImage),
    logosOrWatermarks: strList(r.logosOrWatermarks),
    quality: cleanQuality(r.quality),
    composition: { mainSubject: str(composition.mainSubject, 200), emptySpaceForText: strList(composition.emptySpaceForText, 5, 20) },
    animation: {
      imageToVideoScore: clampInt(animation.imageToVideoScore, 1, 5, 3),
      suggestedMotion: str(animation.suggestedMotion, 300),
      risks: str(animation.risks, 400),
    },
    bestUses: cleanIdeaUses(r.bestUses),
    matchesProjectInfo: strList(r.matchesProjectInfo, 20, 240),
    conflictsWithProjectInfo: strList(r.conflictsWithProjectInfo, 20, 240),
    tags: strList(r.tags, 20, 40),
    searchText: str(r.searchText, 2000),
  };
}

/** Transcript lines inside the analyzed range, in order, without empty text */
export function cleanTranscript(v: unknown, duration: number): TranscriptLine[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => obj(x))
    .map((x) => ({ start: Number(x.start), end: Number(x.end), text: str(x.text, 500) }))
    .filter((x) => x.text && Number.isFinite(x.start) && x.start < duration)
    .map((x) => {
      const start = round2(Math.max(0, x.start));
      const end = round2(Math.min(duration, Number.isFinite(x.end) && x.end > start ? x.end : start + 2));
      return { start, end, text: x.text };
    })
    .sort((a, b) => a.start - b.start)
    .slice(0, 400);
}

/**
 * Shots in order, contiguous from 0 to the analyzed length, edges snapped to the exact hard cuts
 * (within 0.7 s), shots shorter than 0.4 s merged into the previous one.
 */
export function cleanVideoShots(raw: unknown, duration: number, sceneCuts: number[]): VideoShotKnowledge[] {
  if (!Array.isArray(raw)) return [];
  const snap = (t: number) => {
    let best = t;
    let distance = 0.7;
    for (const c of sceneCuts) {
      if (Math.abs(c - t) <= distance) {
        distance = Math.abs(c - t);
        best = c;
      }
    }
    return best;
  };

  const shots = raw
    .map((x) => obj(x))
    .map((r) => ({
      start: Number(r.start),
      end: Number(r.end),
      title: str(r.title, 100) || 'Shot',
      description: str(r.description, 800),
      space: oneOf(r.space, SPACES, 'OTHER'),
      visibleElements: strList(r.visibleElements, 30),
      materialsAndFinishes: strList(r.materialsAndFinishes, 20),
      cameraMotion: str(r.cameraMotion, 40) || 'unknown',
      people: str(r.people, 200) || 'none',
      textOnScreen: strList(r.textOnScreen, 10),
      quality: cleanQuality(r.quality),
      hookScore: clampInt(r.hookScore, 1, 5, 2),
      bestStart: Number(r.bestStart),
      bestEnd: Number(r.bestEnd),
      keep: r.keep !== false,
      reason: str(r.reason, 240),
      bestUses: cleanIdeaUses(r.bestUses, 3),
    }))
    .filter((s) => Number.isFinite(s.start) && s.start < duration)
    .sort((a, b) => a.start - b.start);

  if (!shots.length) return [];

  shots[0].start = 0;
  for (let i = 1; i < shots.length; i++) shots[i].start = Math.max(shots[i - 1].start, snap(shots[i].start));
  for (let i = 0; i < shots.length; i++) shots[i].end = i + 1 < shots.length ? shots[i + 1].start : duration;

  const merged: typeof shots = [];
  for (const s of shots) {
    if (s.end - s.start < 0.4 && merged.length) {
      merged[merged.length - 1].end = s.end;
      continue;
    }
    merged.push(s);
  }

  return merged.map((s) => {
    let bestStart = Number.isFinite(s.bestStart) ? Math.min(Math.max(s.bestStart, s.start), s.end) : s.start;
    let bestEnd = Number.isFinite(s.bestEnd) ? Math.min(Math.max(s.bestEnd, s.start), s.end) : s.end;
    if (bestEnd - bestStart < 0.5) {
      bestStart = s.start;
      bestEnd = s.end;
    }
    return { ...s, start: round2(s.start), end: round2(s.end), bestStart: round2(bestStart), bestEnd: round2(bestEnd) };
  });
}

export function cleanVideoKnowledge(
  raw: unknown,
  meta: { durationSeconds: number; analyzedSeconds: number; sceneCuts: number[]; hasAudio: boolean }
): VideoKnowledge {
  const r = obj(raw);
  const speech = obj(r.speech);
  const transcript = meta.hasAudio ? cleanTranscript(speech.transcript, meta.analyzedSeconds) : [];
  return {
    kind: 'video',
    title: str(r.title, 100) || 'Untitled clip',
    summary: str(r.summary, 1500),
    sourceType: oneOf(r.sourceType, VIDEO_SOURCE_TYPES, 'UNSURE'),
    filmedWith: str(r.filmedWith, 40) || 'unknown',
    durationSeconds: round2(meta.durationSeconds),
    analyzedSeconds: round2(meta.analyzedSeconds),
    speech: {
      hasSpeech: meta.hasAudio && (speech.hasSpeech === true || transcript.length > 0),
      language: str(speech.language, 40) || 'none',
      speakers: str(speech.speakers, 300),
      transcript,
    },
    hasMusic: meta.hasAudio && r.hasMusic === true,
    quality: cleanQuality(r.quality),
    shots: cleanVideoShots(r.shots, meta.analyzedSeconds, meta.sceneCuts),
    sceneCuts: meta.sceneCuts,
    bestUses: cleanIdeaUses(r.bestUses),
    matchesProjectInfo: strList(r.matchesProjectInfo, 20, 240),
    conflictsWithProjectInfo: strList(r.conflictsWithProjectInfo, 20, 240),
    tags: strList(r.tags, 20, 40),
    searchText: str(r.searchText, 2500),
  };
}
