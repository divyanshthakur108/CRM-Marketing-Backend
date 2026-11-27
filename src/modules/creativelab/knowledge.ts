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

// ── Nearby places + map card ────────────────────────────────────────────────

export const DIRECTIONS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;
export type Direction = (typeof DIRECTIONS)[number];
const DIRECTION_WORDS: Record<Direction, string> = {
  N: 'north (straight up)', NE: 'north-east (up-right)', E: 'east (right)', SE: 'south-east (down-right)',
  S: 'south (straight down)', SW: 'south-west (down-left)', W: 'west (left)', NW: 'north-west (up-left)',
};

export type MapStyle = 'flat' | '3d';

export interface NearbyPlace {
  name: string;
  /** Which way the place is from the building (north is up on the card) */
  direction?: Direction;
  time?: { value: number; unit: 'min' | 'hr' };
  distance?: { value: number; unit: 'km' | 'm' };
}

export const MAX_PLACES = 8;

const num = (v: unknown): number | undefined => {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) && n > 0 && n < 100000 ? Math.round(n * 100) / 100 : undefined;
};

/** Validates the rows typed on the page. Throws a readable message for the first bad row. */
export function cleanPlaces(raw: unknown): NearbyPlace[] {
  if (!Array.isArray(raw)) throw new Error('Places must be a list');
  if (raw.length > MAX_PLACES) throw new Error(`Up to ${MAX_PLACES} places`);
  return raw.map((r, i) => {
    const row = (r || {}) as Record<string, any>;
    const name = String(row.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
    if (!name) throw new Error(`Row ${i + 1}: place name is required`);
    const tv = num(row.time?.value);
    const dv = num(row.distance?.value);
    if (tv === undefined && dv === undefined) throw new Error(`Row ${i + 1} (${name}): add a time or a distance`);
    const place: NearbyPlace = { name };
    if (tv !== undefined) place.time = { value: tv, unit: row.time?.unit === 'hr' ? 'hr' : 'min' };
    if (dv !== undefined) place.distance = { value: dv, unit: row.distance?.unit === 'm' ? 'm' : 'km' };
    if ((DIRECTIONS as readonly string[]).includes(row.direction)) place.direction = row.direction as Direction;
    return place;
  });
}

/** "15 min · 12 km" (exactly what was typed, nothing rounded or converted) */
export function formatPlaceChip(p: NearbyPlace): string {
  const parts: string[] = [];
  if (p.time) parts.push(`${p.time.value} ${p.time.unit === 'hr' ? (p.time.value === 1 ? 'hr' : 'hrs') : 'min'}`);
  if (p.distance) parts.push(`${p.distance.value} ${p.distance.unit}`);
  return parts.join(' · ');
}

const MAP_STYLES_3D = [
  '3D isometric miniature city seen from above at a 45° angle: soft clay-render look, low white buildings, green parks, roads raised slightly, the project as a taller glowing tower with a big 3D gold pin above it, labels floating on white rounded 3D tags with soft shadows. Warm golden-hour light.',
  '3D tilted map like a premium navigation app: perspective view, extruded light-grey blocks, glowing gold route lines from the project to each place, a 3D pin with a light beam over the project, frosted-glass floating label cards. Dusk sky gradient at the top.',
  '3D tabletop architectural model on a wooden base: matte white massing blocks, tiny trees, the project highlighted in gold with a pin, thin gold threads to each place ending in small standing signboards with the labels. Soft studio lighting.',
  '3D low-poly map island floating on a soft beige background: roads in white, greenery in muted green, the project tower in gold with a glowing pin, labels on 3D pill-shaped tags with gentle shadows. Clean, modern and premium.',
];

const MAP_STYLES = [
  'Warm beige and muted gold map, thin dark-grey roads, gold project pin, white rounded label chips with dark text. Calm, premium real-estate brochure look.',
  'Deep navy map with soft glowing roads, gold project pin with a light glow, cream label chips. Elegant night look.',
  'Clean off-white minimal map with light-grey roads and a soft green park area, brand-pink project pin, white chips with a thin border. Modern and airy.',
  'Soft sand-coloured map with faint terrain texture, champagne-gold pin and route lines, charcoal labels on frosted-glass chips. Luxury look.',
];

const SCENES_3D = [
  '3D isometric miniature city seen from above at a 45 degree angle, soft clay render, low white buildings, green parks, slightly raised roads, one taller glowing golden tower exactly in the centre, warm golden hour light, plain beige background',
  '3D tilted city model at dusk, extruded light grey blocks, glowing gold road lines, one taller tower with a soft light beam exactly in the centre, deep blue to peach sky gradient background',
  '3D architectural tabletop model on a light wooden base, matte white massing blocks, tiny trees, one taller gold building exactly in the centre, soft studio lighting, plain cream background',
  '3D low poly city island floating on a soft sand coloured background, white roads, muted green parks, one taller gold tower exactly in the centre, gentle shadows, clean modern look',
];
const SCENES_FLAT = [
  'top-down minimal city map illustration, warm beige land, thin dark grey roads, soft green parks, a small river, flat vector style, plenty of empty space',
  'top-down night city map illustration, deep navy background, softly glowing roads, faint blocks, flat vector style, elegant',
  'top-down clean off-white city map illustration, light grey roads, soft green park areas, flat minimal vector style',
  'top-down sand coloured city map illustration with faint terrain texture, champagne gold roads, flat premium vector style',
];

/** Background-only prompt for the free generator (all text, pins and logo are drawn by us on top). */
export function buildMapScenePrompt(style: MapStyle = 'flat', variant = 0): string {
  const list = style === '3d' ? SCENES_3D : SCENES_FLAT;
  return `${list[Math.abs(Math.trunc(variant)) % list.length]}, premium real estate marketing style, high detail, no text, no letters, no numbers, no labels, no signs, no logos, no watermark`;
}

/**
 * Prompt for an AI-made map card. The places, times and distances must appear exactly as typed;
 * the image is not to scale and must not add anything else. `variant` changes the look (Regenerate).
 */
export function buildMapCardPrompt(params: {
  projectName: string;
  locality?: string | null;
  places: NearbyPlace[];
  hasLogo: boolean;
  variant?: number;
  style?: MapStyle;
}): string {
  const styles = params.style === '3d' ? MAP_STYLES_3D : MAP_STYLES;
  const v = Math.abs(Math.trunc(params.variant ?? 0)) % styles.length;
  const withDir = params.places.some((p) => p.direction);
  const lines = params.places
    .map((p, i) => `${i + 1}. "${p.name}" with the chip "${formatPlaceChip(p)}"${p.direction ? `, placed to the ${DIRECTION_WORDS[p.direction]} of the project` : ''}`)
    .join('\n');
  return `Create a portrait 9:16 ${params.style === '3d' ? '3D ' : ''}location map card for a real-estate social media reel.

Centre: a map pin for the project "${params.projectName}"${params.locality ? ` with the small caption "${params.locality}"` : ''}.
Around the pin, connected by thin lines or short road paths, show ONLY these nearby places, each as a label with its chip:
${lines}

Rules:
- Spell every place name and every number EXACTLY as written above. Do not translate, round or convert them.
- Do not add any other place, road name, number, distance or text.
- It is a schematic, not a real map: add a small "Not to scale" note in a bottom corner.
${withDir ? '- North is up. Put each place in the direction given above, relative to the project pin, and add a small north arrow. Places without a direction can go anywhere that keeps the layout tidy.' : '- Arrange the places neatly around the pin (directions are not known, so do not add a compass).'}
- Keep all text large and readable on a phone; leave the top 12% and bottom 18% calm (captions go there).
${params.hasLogo ? '- Place the attached logo small at the bottom centre, unchanged (same shape, colours and letters).' : '- No logo, no brand names other than the project name.'}
Style: ${styles[v]}`;
}

// ── Clean-up: fix plan per file ─────────────────────────────────────────────

export type Orientation = 'ok' | 'upside_down' | 'turn_left' | 'turn_right';

export interface FixPlan {
  /** Whole picture is rotated: upside down, or needs a quarter turn (left = counter-clockwise) */
  orientation: Orientation;
  /** Degrees to rotate CLOCKWISE so verticals / horizon become straight (negative = counter-clockwise) */
  tiltDegrees: number;
  /** Vertical lines lean together because the camera points down (lines meet below) or up (lines meet above) */
  keystone: 'none' | 'converge_down' | 'converge_up';
  keystoneAmount: 'slight' | 'strong';
  exposure: 'ok' | 'dark' | 'bright';
  colourCast: 'none' | 'warm' | 'cool' | 'green' | 'magenta';
  noise: 'low' | 'medium' | 'high';
  blurry: boolean;
  /** Temporary clutter an AI edit could remove later (never fixed automatically) */
  clutter: Array<{ what: string; where: string }>;
  notes: string;
}

export function buildFixPlanPrompt(kind: 'image' | 'video', knownIssues: string[] = []): string {
  return `You check real-estate ${kind === 'image' ? 'photos' : 'video frames (3 frames from the same clip)'} before they are cleaned up for marketing.
Measure what a photo editor would fix. Do NOT suggest changing the property itself.
First decide the orientation. Then judge tilt and vertical lines AS IF the picture were already turned the right way up.
${knownIssues.length ? `An earlier check flagged: ${knownIssues.join(', ')}.` : ''}

Return JSON only:
{
 "orientation": "ok" | "upside_down" | "turn_left" | "turn_right". upside_down = sky or ceiling at the bottom, floor or ground at the top. turn_left / turn_right = the picture must be turned 90° counter-clockwise / clockwise to be upright,
 "tiltDegrees": small leftover tilt AFTER fixing orientation: number between -10 and 10. How many degrees the image must be rotated CLOCKWISE so that vertical edges of walls, doors and buildings become truly vertical (negative = rotate counter-clockwise). 0 if already straight. Be precise; small values like 1.5 are fine,
 "keystone": "none" | "converge_down" | "converge_up". converge_down = vertical lines get closer together towards the bottom (camera pointing down); converge_up = they get closer towards the top (camera pointing up),
 "keystoneAmount": "slight" | "strong",
 "exposure": "ok" | "dark" | "bright",
 "colourCast": "none" | "warm" | "cool" | "green" | "magenta",
 "noise": "low" | "medium" | "high" (grain or WhatsApp compression blocks),
 "blurry": true | false,
 "clutter": [{"what": "e.g. plastic bags", "where": "e.g. bottom left"}] only temporary things (bags, tools, wires, buckets, debris); [] if none,
 "notes": "one short sentence"
}`;
}

const pick = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  (allowed as readonly string[]).includes(String(v)) ? (v as T) : fallback;

export function cleanFixPlan(raw: unknown): FixPlan {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const tilt = Number(r.tiltDegrees);
  return {
    orientation: pick(r.orientation, ['ok', 'upside_down', 'turn_left', 'turn_right'] as const, 'ok'),
    tiltDegrees: Number.isFinite(tilt) ? Math.max(-10, Math.min(10, Math.round(tilt * 10) / 10)) : 0,
    keystone: pick(r.keystone, ['none', 'converge_down', 'converge_up'] as const, 'none'),
    keystoneAmount: pick(r.keystoneAmount, ['slight', 'strong'] as const, 'slight'),
    exposure: pick(r.exposure, ['ok', 'dark', 'bright'] as const, 'ok'),
    colourCast: pick(r.colourCast, ['none', 'warm', 'cool', 'green', 'magenta'] as const, 'none'),
    noise: pick(r.noise, ['low', 'medium', 'high'] as const, 'low'),
    blurry: r.blurry === true,
    clutter: Array.isArray(r.clutter)
      ? r.clutter
          .map((c) => ({ what: String((c as any)?.what ?? '').slice(0, 60), where: String((c as any)?.where ?? '').slice(0, 60) }))
          .filter((c) => c.what)
          .slice(0, 6)
      : [],
    notes: String(r.notes ?? '').slice(0, 200),
  };
}
