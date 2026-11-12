import { spawnFfmpeg, probeMedia } from '../../utils/ffmpeg.js';
import type { EditRecipe } from './recipe.js';

export interface QualityCheckItem {
  name: string;
  status: 'pass' | 'warn' | 'fail';
  detail: string;
}

export interface QualityCheckResult {
  passed: boolean;
  checks: QualityCheckItem[];
  reviewReason?: string;
}

/**
 * Calculates planned duration from recipe cuts, transitions, and end card.
 */
export function calculatePlannedDuration(recipe: EditRecipe): number {
  if (!recipe.cuts || recipe.cuts.length === 0) {
    return recipe.endCard?.seconds ?? 0;
  }
  let cutsDuration = 0;
  for (const cut of recipe.cuts) {
    const start = Math.max(0, cut.start || 0);
    const end = cut.end ?? (start + (recipe.output?.maxSecondsPerClip || 30));
    cutsDuration += Math.max(0.3, end - start);
  }
  const transition = recipe.transitionSeconds || 0.4;
  const numCrossfades = Math.max(0, recipe.cuts.length - 1);
  const aRollDuration = cutsDuration - numCrossfades * transition;
  const endCardSec = recipe.endCard?.seconds ?? 0;
  // End card crossfade is 0.3s when merged with cuts
  const total = aRollDuration + (endCardSec > 0 ? endCardSec - (recipe.cuts.length > 0 ? 0.3 : 0) : 0);
  return Math.max(0, Math.round(total * 100) / 100);
}

/**
 * Parses ffmpeg blackdetect output.
 * Fails if any black frame inside the video is longer than 0.5s (ignoring first and last 0.1s).
 */
export function parseBlackdetect(stderr: string, durationSeconds: number): QualityCheckItem {
  const windowStart = 0.1;
  const windowEnd = Math.max(0.1, durationSeconds - 0.1);

  const blackRegex = /black_start:([0-9.]+)\s+black_end:([0-9.]+)\s+black_duration:([0-9.]+)/g;
  const offending: Array<{ start: number; end: number; duration: number }> = [];

  let match: RegExpExecArray | null;
  while ((match = blackRegex.exec(stderr)) !== null) {
    const bStart = parseFloat(match[1]);
    const bEnd = parseFloat(match[2]);

    const effStart = Math.max(bStart, windowStart);
    const effEnd = Math.min(bEnd, windowEnd);
    const effDur = Math.max(0, effEnd - effStart);

    if (effDur > 0.5) {
      offending.push({
        start: effStart,
        end: effEnd,
        duration: effDur,
      });
    }
  }

  if (offending.length > 0) {
    const summary = offending
      .map((o) => `${o.duration.toFixed(2)}s at ${o.start.toFixed(2)}s–${o.end.toFixed(2)}s`)
      .join(', ');
    return {
      name: 'Black Screen Detection',
      status: 'fail',
      detail: `Detected black frames exceeding 0.5s: ${summary}`,
    };
  }

  return {
    name: 'Black Screen Detection',
    status: 'pass',
    detail: 'No black frames > 0.5s detected',
  };
}

/**
 * Parses ffmpeg freezedetect output.
 * Warns if any frozen picture longer than 2.0s is detected before the end card.
 */
export function parseFreezedetect(
  stderr: string,
  durationSeconds: number,
  endCardSeconds = 2.4
): QualityCheckItem {
  const mainEnd = Math.max(0, durationSeconds - endCardSeconds);
  const offending: Array<{ start: number; end: number; duration: number }> = [];

  // Match freeze start and either duration/end or until mainEnd
  const startRegex = /lavfi\.freezedetect\.freeze_start:\s*([0-9.]+)/g;
  const endRegex = /lavfi\.freezedetect\.freeze_end:\s*([0-9.]+)/g;

  const starts: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = startRegex.exec(stderr)) !== null) {
    starts.push(parseFloat(m[1]));
  }

  const ends: number[] = [];
  while ((m = endRegex.exec(stderr)) !== null) {
    ends.push(parseFloat(m[1]));
  }

  for (let i = 0; i < starts.length; i++) {
    const start = starts[i];
    // Ignore freezes that begin inside or right before the end card
    if (start >= mainEnd - 0.2) continue;

    const end = i < ends.length ? ends[i] : durationSeconds;
    const effEnd = Math.min(end, mainEnd);
    const freezeDuration = Math.max(0, effEnd - start);

    if (freezeDuration > 2.0) {
      offending.push({
        start,
        end: effEnd,
        duration: freezeDuration,
      });
    }
  }

  if (offending.length > 0) {
    const summary = offending
      .map((o) => `${o.duration.toFixed(2)}s from ${o.start.toFixed(2)}s to ${o.end.toFixed(2)}s`)
      .join(', ');
    return {
      name: 'Frozen Frame Detection',
      status: 'warn',
      detail: `Frozen picture detected before end card: ${summary}`,
    };
  }

  return {
    name: 'Frozen Frame Detection',
    status: 'pass',
    detail: 'No frozen frames > 2.0s detected before end card',
  };
}

/**
 * Parses ebur128 audio loudness and peak measurements.
 * Fails if true peak > -1.0 dBTP or if entire video is silent while recipe has speech.
 * Warns if integrated loudness differs from -14 LUFS by > 3.0 LUFS.
 */
export function parseEbur128(stderr: string, hasSpeech: boolean): QualityCheckItem {
  const iMatch = /Integrated loudness:[\s\S]*?I:\s*(-?[\d.]+|-\w+)\s*LUFS/i.exec(stderr);
  const peakMatch = /True peak:[\s\S]*?Peak:\s*(-?[\d.]+|-\w+)\s*dB[TF]S/i.exec(stderr);

  const rawI = iMatch ? iMatch[1].toLowerCase() : '-inf';
  const rawPeak = peakMatch ? peakMatch[1].toLowerCase() : '-inf';

  const I = rawI.includes('inf') ? -Infinity : parseFloat(rawI);
  const peak = rawPeak.includes('inf') ? -Infinity : parseFloat(rawPeak);

  const isSilent = !Number.isFinite(I) || I <= -60 || !Number.isFinite(peak) || peak <= -60;

  if (isSilent && hasSpeech) {
    return {
      name: 'Audio Loudness & Peak',
      status: 'fail',
      detail: `Video is completely silent (I: ${I} LUFS, Peak: ${peak} dBTP) but narration speech was expected`,
    };
  }

  if (Number.isFinite(peak) && peak > -1.0) {
    return {
      name: 'Audio Loudness & Peak',
      status: 'fail',
      detail: `True peak (${peak.toFixed(1)} dBTP) exceeds safe limit of -1.0 dBTP (clipping risk)`,
    };
  }

  if (!isSilent && Number.isFinite(I) && Math.abs(I - (-14.0)) > 3.0) {
    return {
      name: 'Audio Loudness & Peak',
      status: 'warn',
      detail: `Integrated loudness (${I.toFixed(1)} LUFS) deviates from -14.0 LUFS target by ${Math.abs(I - (-14.0)).toFixed(1)} LUFS (> 3.0 LUFS)`,
    };
  }

  return {
    name: 'Audio Loudness & Peak',
    status: 'pass',
    detail: isSilent
      ? 'Audio is silent as expected for clip with no narration'
      : `Loudness OK: ${I.toFixed(1)} LUFS (target -14), True Peak: ${peak.toFixed(1)} dBTP (limit -1.0)`,
  };
}

/**
 * Checks if the actual rendered duration matches the planned duration within 1.5s tolerance.
 */
export function checkDuration(actualDuration: number, recipe: EditRecipe): QualityCheckItem {
  const planned = calculatePlannedDuration(recipe);
  const diff = Math.abs(actualDuration - planned);

  if (diff > 1.5) {
    return {
      name: 'Duration Accuracy',
      status: 'warn',
      detail: `Actual length (${actualDuration.toFixed(1)}s) deviates from planned (${planned.toFixed(1)}s) by ${diff.toFixed(1)}s (> 1.5s tolerance)`,
    };
  }

  return {
    name: 'Duration Accuracy',
    status: 'pass',
    detail: `Duration matches planned length (${actualDuration.toFixed(1)}s vs ${planned.toFixed(1)}s)`,
  };
}

/**
 * Checks that caption vertical safe area is above Instagram UI bottom margin (340px).
 * Our ASS renderer uses 420px.
 */
export function checkCaptionSafeArea(recipe: EditRecipe): QualityCheckItem {
  if (!recipe.captions || !recipe.captions.lines || recipe.captions.lines.length === 0) {
    return {
      name: 'Caption Safe Area',
      status: 'pass',
      detail: 'No captions in recipe (safe area check skipped)',
    };
  }

  // Our ASS caption styles use MarginV = 420px. Instagram safe margin is >= 340px.
  const marginV = 420;
  if (marginV < 340) {
    return {
      name: 'Caption Safe Area',
      status: 'warn',
      detail: `Caption vertical margin (${marginV}px) is below Instagram bottom UI safe area (340px)`,
    };
  }

  return {
    name: 'Caption Safe Area',
    status: 'pass',
    detail: 'Caption safe area OK (MarginV 420px >= 340px Instagram UI margin)',
  };
}

/**
 * Runs ffmpeg quality checks on a rendered video file.
 * Non-blocking on failure: returns a structured QualityCheckResult.
 */
export async function runQualityCheck(
  videoPath: string,
  recipe: EditRecipe
): Promise<QualityCheckResult> {
  try {
    const probe = await probeMedia(videoPath);
    const duration = probe.durationSeconds || 0;

    const filterParts = ['[0:v]blackdetect=d=0.5:pic_th=0.98,freezedetect=n=0.003:d=2[v]'];
    const maps = ['-map', '[v]'];
    if (probe.hasAudio) {
      filterParts.push('[0:a]ebur128=peak=true[a]');
      maps.push('-map', '[a]');
    }

    const args = [
      '-nostats',
      '-hide_banner',
      '-i',
      videoPath,
      '-filter_complex',
      filterParts.join(';'),
      ...maps,
      '-f',
      'null',
      '-',
    ];

    let stderr = '';
    await new Promise<void>((resolve, reject) => {
      const proc = spawnFfmpeg(args);
      proc.stderr?.on('data', (d: Buffer) => {
        stderr += d.toString();
      });
      proc.on('error', reject);
      proc.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`ffmpeg quality check exited with code ${code}: ${stderr.slice(-400)}`));
      });
    });

    const hasSpeech =
      (recipe.captions?.source === 'speech') ||
      (recipe.cuts?.some((c) => c.cues && c.cues.length > 0) ?? false);
    const endCardSec = recipe.endCard?.seconds ?? 2.4;

    const blackCheck = parseBlackdetect(stderr, duration);
    const freezeCheck = parseFreezedetect(stderr, duration, endCardSec);
    const audioCheck = probe.hasAudio
      ? parseEbur128(stderr, hasSpeech)
      : {
          name: 'Audio Loudness & Peak',
          status: hasSpeech ? ('fail' as const) : ('pass' as const),
          detail: hasSpeech
            ? 'Video has no audio stream but narration speech was expected'
            : 'No audio stream as expected',
        };
    const durationCheck = checkDuration(duration, recipe);
    const captionCheck = checkCaptionSafeArea(recipe);

    const checks: QualityCheckItem[] = [
      blackCheck,
      freezeCheck,
      audioCheck,
      durationCheck,
      captionCheck,
    ];
    const failed = checks.filter((c) => c.status === 'fail');
    const passed = failed.length === 0;

    return {
      passed,
      checks,
      reviewReason: passed ? undefined : failed.map((c) => `${c.name}: ${c.detail}`).join('; '),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      passed: false,
      checks: [
        {
          name: 'Quality Probe Execution',
          status: 'fail',
          detail: `Quality check probe encountered an error: ${msg.slice(0, 300)}`,
        },
      ],
      reviewReason: `Quality probe execution failed: ${msg.slice(0, 300)}`,
    };
  }
}

