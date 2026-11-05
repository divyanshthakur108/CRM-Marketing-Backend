import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { getAIProvider } from '../ai/providers/index.js';
import { defaultStorage } from '../../storage/localStorage.adapter.js';
import { escapeFilterPath, probeMedia, runFfmpeg } from '../../utils/ffmpeg.js';
import { AppError } from '../../utils/AppError.js';
import { env } from '../../config/env.js';
import { ClipShot, SHOT_CATEGORIES, ShotCategory, TimeRange } from './recipe.js';

/** Clips are understood up to this length (longer clips: only the start is used) */
export const MAX_ANALYZE_SECONDS = 180;

export const SHOT_ISSUES = [
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
] as const;

export interface AnalysisStep {
  name: string;
  ms: number;
}

export interface ClipAnalysis {
  clipKey: string;
  durationSeconds: number;
  analyzedSeconds: number;
  summary: string;
  shots: Array<ClipShot & { thumbnail?: string }>;
  /** Hard cuts found by ffmpeg scene detection (exact) */
  sceneCuts: number[];
  /** Quiet moments in the audio */
  silences: TimeRange[];
  model: string;
  ms: number;
  steps: AnalysisStep[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * "Understand" a clip: what each shot shows, how good it is, and where it can be cut.
 * 1. ffmpeg makes a small preview copy and finds exact hard cuts (scene changes) and quiet moments.
 * 2. Gemini watches the preview and describes every shot (room type, quality, problems, speech, best part).
 * 3. Shot edges are snapped to the exact hard cuts; a thumbnail is taken from the middle of every shot.
 */
export async function analyzeClip(clipKey: string): Promise<ClipAnalysis> {
  const started = Date.now();
  const steps: AnalysisStep[] = [];
  const timed = async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
    const t = Date.now();
    const result = await fn();
    steps.push({ name, ms: Date.now() - t });
    return result;
  };

  const clipPath = await defaultStorage.ensureLocal(clipKey);
  const probe = await probeMedia(clipPath);
  if (!probe.hasVideo) throw AppError.badRequest('This file has no video track');
  const analyzedSeconds = round2(Math.min(probe.durationSeconds || MAX_ANALYZE_SECONDS, MAX_ANALYZE_SECONDS));

  const scratch = path.resolve(process.cwd(), 'storage', 'scratch', `analyze-${crypto.randomUUID()}`);
  await fsp.mkdir(scratch, { recursive: true });
  const ff = (args: string[]) => runFfmpeg(['-hide_banner', '-loglevel', 'error', '-y', ...args]);

  try {
    // 1. Small preview copy: long side 640px, 10 fps, mono audio (fast to scan, small enough to send to Gemini)
    const proxy = path.join(scratch, 'preview.mp4');
    await timed('Make a small preview copy (640px, 10 fps)', () =>
      ff([
        '-i', clipPath,
        '-t', String(analyzedSeconds),
        '-vf', "scale='if(gte(iw,ih),640,-2)':'if(gte(iw,ih),-2,640)',fps=10,format=yuv420p",
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '30',
        ...(probe.hasAudio ? ['-c:a', 'aac', '-b:a', '48k', '-ac', '1'] : ['-an']),
        proxy,
      ])
    );

    // 2. Exact hard cuts (scene changes) + loudness of the sound (in one pass)
    const scenesFile = path.join(scratch, 'scenes.txt');
    const levelsFile = path.join(scratch, 'levels.txt');
    await timed('Find hard cuts and measure loudness (ffmpeg scene detection + astats)', () =>
      ff([
        '-i', proxy,
        '-map', '0:v', '-vf', `select='gt(scene,0.30)',metadata=print:file=${escapeFilterPath(scenesFile)}`, '-f', 'null', '-',
        ...(probe.hasAudio
          ? [
              '-map', '0:a',
              '-af', `asetnsamples=n=2048,astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level:file=${escapeFilterPath(levelsFile)}`,
              '-f', 'null', '-',
            ]
          : []),
      ])
    );
    const sceneCuts = parseSceneCuts(await readIfExists(scenesFile)).filter((t) => t > 0.2 && t < analyzedSeconds - 0.2);

    // 3. Quiet moments (pauses between sentences). The threshold adapts to each clip, because many clips
    //    have background noise or music and are never fully silent.
    let silences: TimeRange[] = [];
    if (probe.hasAudio) {
      const threshold = pauseThreshold(await readIfExists(levelsFile));
      const silenceFile = path.join(scratch, 'silence.txt');
      await timed(`Find pauses (quieter than ${threshold} dB for 0.2 s or more)`, () =>
        ff([
          '-i', proxy, '-vn',
          '-af', `silencedetect=noise=${threshold}dB:d=0.2,ametadata=print:file=${escapeFilterPath(silenceFile)}`,
          '-f', 'null', '-',
        ])
      );
      silences = parseSilences(await readIfExists(silenceFile), analyzedSeconds);
    }

    // 4. Gemini watches the preview
    const video = await fsp.readFile(proxy);
    const raw = await timed(`Gemini watches the clip (${env.GEMINI_TEXT_MODEL})`, () =>
      getAIProvider().generateJson<{ summary?: string; shots?: unknown[] }>(buildPrompt(analyzedSeconds, sceneCuts, probe.hasAudio), {
        images: [{ data: video, mimeType: 'video/mp4' }],
        feature: 'Clip understanding',
      })
    );
    const shots = normalizeShots(Array.isArray(raw?.shots) ? raw.shots : [], analyzedSeconds, sceneCuts, probe.hasAudio);
    if (!shots.length) throw new AppError(502, 'AI_FAILED', 'Clip understanding failed: Gemini returned no shots for this clip.');

    // 5. Thumbnail from the middle of every shot (small JPEG, sent inline)
    const withThumbs = await timed(`Take ${shots.length} shot thumbnails`, async () => {
      const out: Array<ClipShot & { thumbnail?: string }> = [];
      for (let i = 0; i < shots.length; i++) {
        const s = shots[i];
        const file = path.join(scratch, `thumb_${i}.jpg`);
        try {
          await ff(['-ss', ((s.start + s.end) / 2).toFixed(2), '-i', proxy, '-frames:v', '1', '-vf', 'scale=160:-2', '-q:v', '6', file]);
          out.push({ ...s, thumbnail: `data:image/jpeg;base64,${(await fsp.readFile(file)).toString('base64')}` });
        } catch {
          out.push(s);
        }
      }
      return out;
    });

    return {
      clipKey,
      durationSeconds: round2(probe.durationSeconds),
      analyzedSeconds,
      summary: String(raw?.summary || '').trim(),
      shots: withThumbs,
      sceneCuts,
      silences,
      model: env.GEMINI_TEXT_MODEL,
      ms: Date.now() - started,
      steps,
    };
  } finally {
    await fsp.rm(scratch, { recursive: true, force: true }).catch(() => undefined);
  }
}

function buildPrompt(seconds: number, sceneCuts: number[], hasAudio: boolean): string {
  return `You are a senior video editor for Indian real-estate marketing reels (Instagram / Facebook, 9:16).
Watch this raw clip sent by a property developer (${seconds.toFixed(1)} seconds long${hasAudio ? '' : ', no sound'}).
Split it into shots and judge each one, so an automatic editor can decide where to cut and which parts to use.

Exact hard cuts found by scene detection (seconds): ${sceneCuts.length ? sceneCuts.map((t) => t.toFixed(2)).join(', ') : 'none'}.
Use these as shot boundaries. A continuous camera move with no hard cut may still be split where the subject changes
(e.g. walking from the living room into the kitchen).

For every shot return:
- "start", "end": seconds (0.1 precision). Shots follow each other and together cover 0 to ${seconds.toFixed(1)}.
- "label": 3–8 words describing what is visible, e.g. "Living room with large windows".
- "category": one of ${SHOT_CATEGORIES.join(', ')}.
  AERIAL = drone; EXTERIOR = building/facade from the ground; BALCONY_VIEW = balcony or view from a window;
  AMENITY = pool, gym, clubhouse, park, lift lobby; LOCATION = roads, nearby landmarks; PRESENTER = a person talking to camera.
- "quality": 1–5 (5 = steady, sharp, well lit, well framed).
- "issues": any of ${SHOT_ISSUES.join(', ')} (empty list if none).
- "hasSpeech": true only if someone is speaking during this shot.
- "hookScore": 1–5, how strong this shot would be as the first 2 seconds of a reel.
- "bestStart", "bestEnd": the best usable part of the shot (skip shaky starts, focus hunting, accidental endings), inside start..end.
- "keep": false only for unusable footage (accidental, black, frozen, very shaky or blurry, camera pointing at the floor,
  or someone else's logo / watermark / on-screen overlay such as a "Subscribe" button); otherwise true.
- "reason": one short sentence explaining keep or cut.

Also return "summary": one sentence about the whole clip.
Describe only what is actually visible or audible. Do not guess prices, sizes or brand names.

Return only JSON: {"summary": "...", "shots": [{"start": 0, "end": 4.2, "label": "...", "category": "EXTERIOR", "quality": 4, "issues": [], "hasSpeech": false, "hookScore": 4, "bestStart": 0.5, "bestEnd": 4.0, "keep": true, "reason": "..."}]}`;
}

async function readIfExists(file: string): Promise<string> {
  return fs.existsSync(file) ? fsp.readFile(file, 'utf8') : '';
}

/** ffmpeg metadata=print output: "frame:12 pts:... pts_time:4.2" lines */
export function parseSceneCuts(text: string): number[] {
  const times = [...text.matchAll(/pts_time:([\d.]+)/g)].map((m) => round2(Number(m[1])));
  // Ignore flashes: cuts closer than 0.5 s to the previous one
  return times.filter((t, i) => i === 0 || t - times[i - 1] >= 0.5);
}

/** ametadata=print output with lavfi.silence_start / lavfi.silence_end values */
export function parseSilences(text: string, duration: number): TimeRange[] {
  const out: TimeRange[] = [];
  let open: number | null = null;
  for (const m of text.matchAll(/lavfi\.silence_(start|end)=([\d.]+)/g)) {
    const t = Number(m[2]);
    if (m[1] === 'start') open = t;
    else if (open !== null) {
      out.push({ start: round2(open), end: round2(t) });
      open = null;
    }
  }
  if (open !== null && open < duration) out.push({ start: round2(open), end: round2(duration) });
  return out;
}

/**
 * Pause threshold from the clip's own loudness: 3 dB under the median level of short windows,
 * kept between -45 and -16 dB. Pure silence (-inf) windows are ignored.
 */
export function pauseThreshold(levelsText: string): number {
  const levels = [...levelsText.matchAll(/RMS_level=(-?[\d.]+)/g)]
    .map((m) => Number(m[1]))
    .filter((v) => Number.isFinite(v) && v > -90)
    .sort((a, b) => a - b);
  if (!levels.length) return -35;
  const median = levels[Math.floor(levels.length / 2)];
  return Math.round(Math.min(-16, Math.max(-45, median - 3)));
}

const clampInt = (v: unknown, min: number, max: number, fallback: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

/**
 * Cleans Gemini's shot list: valid values only, edges snapped to exact hard cuts (within 0.7 s),
 * no gaps or overlaps, tiny shots merged into the previous one.
 */
export function normalizeShots(raw: unknown[], duration: number, sceneCuts: number[], hasAudio: boolean): ClipShot[] {
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
    .map((r) => (typeof r === 'object' && r ? (r as Record<string, unknown>) : {}))
    .map((r) => ({
      start: Number(r.start),
      end: Number(r.end),
      label: String(r.label || '').trim().slice(0, 80) || 'Shot',
      category: (SHOT_CATEGORIES as readonly string[]).includes(String(r.category))
        ? (String(r.category) as ShotCategory)
        : 'OTHER',
      quality: clampInt(r.quality, 1, 5, 3),
      hookScore: clampInt(r.hookScore, 1, 5, 2),
      issues: Array.isArray(r.issues)
        ? r.issues.map(String).filter((i) => (SHOT_ISSUES as readonly string[]).includes(i))
        : [],
      hasSpeech: hasAudio && r.hasSpeech === true,
      bestStart: Number(r.bestStart),
      bestEnd: Number(r.bestEnd),
      keep: r.keep !== false,
      reason: String(r.reason || '').trim().slice(0, 200),
    }))
    .filter((s) => Number.isFinite(s.start) && Number.isFinite(s.end) && s.start < duration)
    .sort((a, b) => a.start - b.start);

  if (!shots.length) return [];

  // Contiguous edges, snapped to hard cuts
  shots[0].start = 0;
  for (let i = 1; i < shots.length; i++) shots[i].start = Math.max(shots[i - 1].start, snap(shots[i].start));
  for (let i = 0; i < shots.length; i++) shots[i].end = i + 1 < shots.length ? shots[i + 1].start : duration;

  // Merge shots shorter than 0.4 s into the previous shot
  const merged: ClipShot[] = [];
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
    return {
      ...s,
      start: round2(s.start),
      end: round2(s.end),
      bestStart: round2(bestStart),
      bestEnd: round2(bestEnd),
    };
  });
}
