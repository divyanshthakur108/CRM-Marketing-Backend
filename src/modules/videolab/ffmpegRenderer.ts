import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { EditRecipe, END_CARD_THEMES, placeCuesOnTimeline } from './recipe.js';
import { buildEndCardAss, buildMainAss } from './ass.js';
import { defaultStorage } from '../../storage/localStorage.adapter.js';
import { escapeFilterPath, probeMedia, runFfmpeg } from '../../utils/ffmpeg.js';

export interface RenderStep {
  name: string;
  ms: number;
  command?: string;
}

export interface RenderResult {
  durationSeconds: number;
  steps: RenderStep[];
}

const FONTS_DIR = path.resolve(process.cwd(), 'assets', 'fonts');
const W = 1080;
const H = 1920;
const FPS = 30;
const VIDEO_CODEC = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p'];
const AUDIO_CODEC = ['-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-ac', '2'];

/**
 * Renders one edit recipe with ffmpeg into a 1080×1920 MP4 + poster frame.
 * Every step is recorded (name, time, command) for the "How this video was made" view.
 */
export async function renderRecipeWithFfmpeg(
  recipe: EditRecipe,
  opts: { workDir: string; outputVideoPath: string; outputPosterPath: string; onStep?: (step: RenderStep) => void }
): Promise<RenderResult> {
  const steps: RenderStep[] = [];
  const { workDir } = opts;
  await fsp.mkdir(workDir, { recursive: true });

  const run = async (name: string, args: string[]) => {
    const fullArgs = ['-hide_banner', '-loglevel', 'error', '-y', ...args];
    const { ms } = await runFfmpeg(fullArgs);
    const step = { name, ms, command: `ffmpeg ${fullArgs.map(quoteArg).join(' ')}` };
    steps.push(step);
    opts.onStep?.(step);
  };
  const note = (name: string, ms = 0) => {
    const step = { name, ms };
    steps.push(step);
    opts.onStep?.(step);
  };

  // 0. Fetch inputs (from Cloudinary if they aren't on this machine)
  const fetchStarted = Date.now();
  // The same clip can appear in several cuts: fetch each file once
  const localByKey = new Map<string, string>();
  for (const cut of recipe.cuts) {
    if (!localByKey.has(cut.key)) localByKey.set(cut.key, await requireLocal(cut.key));
  }
  const clipPaths = recipe.cuts.map((cut) => localByKey.get(cut.key)!);
  const logoPath = recipe.watermark.logoKey ? await requireLocal(recipe.watermark.logoKey) : undefined;
  const musicPath = recipe.music ? await requireLocal(recipe.music.key) : undefined;
  note(`Fetch ${localByKey.size} clip(s)${logoPath ? ' + logo' : ''}${musicPath ? ' + music' : ''}`, Date.now() - fetchStarted);
  if (recipe.editing === 'smart') {
    note(
      `Smart cut plan: ${recipe.cuts.length} cuts → ` +
        recipe.cuts.map((c, i) => `${i + 1}) ${c.label || c.filename} [${fmt(c.start)}–${fmt(c.end ?? 0)}]`).join('  ')
    );
  }

  // 1. Cut + normalize every piece: 1080×1920 @30fps, blurred fill for non-vertical clips, loudness-normalized stereo audio
  const segments: string[] = [];
  const segmentDurations: number[] = [];
  for (let i = 0; i < clipPaths.length; i++) {
    const cut = recipe.cuts[i];
    const probe = await probeMedia(clipPaths[i]);
    if (!probe.hasVideo) throw new Error(`Clip ${cut.filename || i + 1} has no video stream`);
    const start = Math.max(0, cut.start || 0);
    const end = Math.min(cut.end ?? start + recipe.output.maxSecondsPerClip, probe.durationSeconds || Infinity);
    if (end - start < 0.3) throw new Error(`Cut ${i + 1} (${cut.filename || 'clip'}) is too short or outside the clip`);
    const seg = path.join(workDir, `seg_${i}.mp4`);
    const audioChain = probe.hasAudio
      ? '[0:a]aresample=48000,aformat=channel_layouts=stereo,loudnorm=I=-16:TP=-1.5:LRA=11[a]'
      : '[1:a]aformat=sample_rates=48000:channel_layouts=stereo[a]';
    const what = recipe.editing === 'smart' ? `${cut.filename || 'clip'} ${fmt(start)}–${fmt(end)}${cut.label ? `, ${cut.label}` : ''}` : cut.filename || 'clip';
    await run(`Cut ${i + 1} (${what}) → 1080×1920, 30fps`, [
      '-ss', start.toFixed(3),
      '-i', clipPaths[i],
      ...(probe.hasAudio ? [] : ['-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo']),
      '-t', (end - start).toFixed(3),
      '-filter_complex',
      [
        `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},boxblur=luma_radius=40:luma_power=2,setsar=1[bg]`,
        `[0:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,setsar=1[fg]`,
        `[bg][fg]overlay=(W-w)/2:(H-h)/2,fps=${FPS},format=yuv420p[v]`,
        audioChain,
      ].join(';'),
      '-map', '[v]', '-map', '[a]', '-shortest',
      ...VIDEO_CODEC, ...AUDIO_CODEC,
      seg,
    ]);
    segments.push(seg);
    segmentDurations.push((await probeMedia(seg)).durationSeconds);
  }

  // 2. Merge clips with short crossfades
  const merged = path.join(workDir, 'merged.mp4');
  const mergedDuration = await crossfadeConcat(
    segments,
    segmentDurations,
    recipe.transitionSeconds,
    merged,
    run,
    `Merge ${segments.length} cut(s) with ${recipe.transitionSeconds}s crossfades`
  );

  // 3. Captions (ASS via libass + HarfBuzz) + watermark (logo overlay, or org name as text)
  const branded = path.join(workDir, 'branded.mp4');
  const speechCues =
    recipe.captions?.source === 'speech'
      ? placeCuesOnTimeline(recipe.cuts, segmentDurations, effectiveTransition(segmentDurations, recipe.transitionSeconds))
      : undefined;
  const mainAss = buildMainAss({
    durationSeconds: mergedDuration,
    captions: recipe.captions,
    cues: speechCues,
    watermarkText: logoPath ? undefined : recipe.watermark.text,
  });
  if (mainAss || logoPath) {
    const assPath = path.join(workDir, 'captions.ass');
    if (mainAss) await fsp.writeFile(assPath, mainAss, 'utf8');
    const parts: string[] = [];
    let current = '0:v';
    if (logoPath) {
      parts.push(`[1:v]scale=200:-2,format=rgba,colorchannelmixer=aa=0.85[wm]`);
      parts.push(`[${current}][wm]overlay=W-w-48:72[ov]`);
      current = 'ov';
    }
    if (mainAss) {
      parts.push(`[${current}]subtitles=filename=${escapeFilterPath(assPath)}:fontsdir=${escapeFilterPath(FONTS_DIR)}[sub]`);
      current = 'sub';
    }
    const what = [
      recipe.captions ? `${recipe.captions.lines.length} caption line(s) (${recipe.captions.language}, ${recipe.captions.style.toLowerCase()})` : null,
      logoPath ? 'logo watermark' : recipe.watermark.text ? 'org-name watermark' : null,
    ].filter(Boolean);
    await run(`Burn in ${what.join(' + ')}`, [
      '-i', merged,
      ...(logoPath ? ['-i', logoPath] : []),
      '-filter_complex', parts.join(';'),
      '-map', `[${current}]`, '-map', '0:a',
      ...VIDEO_CODEC, '-c:a', 'copy',
      branded,
    ]);
  } else {
    await fsp.copyFile(merged, branded);
    note('No captions or watermark to add');
  }

  // 4. End card: brand background, logo, project/org name, phone + RERA only if provided, gentle zoom + fade
  const theme = END_CARD_THEMES[recipe.endCard.template];
  const endCard = path.join(workDir, 'endcard.mp4');
  const endAssPath = path.join(workDir, 'endcard.ass');
  await fsp.writeFile(
    endAssPath,
    buildEndCardAss({
      seconds: recipe.endCard.seconds,
      projectName: recipe.endCard.projectName,
      orgName: recipe.endCard.orgName,
      phone: recipe.endCard.phone,
      rera: recipe.endCard.rera,
      accentHex: theme.accent,
      textHex: theme.text,
      hasLogo: Boolean(logoPath),
    }),
    'utf8'
  );
  const d = recipe.endCard.seconds;
  const accentLineY = logoPath ? 1110 : 890;
  const endParts = [
    logoPath
      ? `[1:v]scale='min(420,iw)':-2,format=rgba[lg];[0:v][lg]overlay=(W-w)/2:${logoPath ? 560 : 0}[base]`
      : `[0:v]null[base]`,
    `[base]drawbox=x=420:y=${accentLineY}:w=240:h=6:color=${theme.accent.replace('#', '0x')}@1:t=fill,` +
      `zoompan=z='min(1+0.0009*on,1.06)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${W}x${H}:fps=${FPS},` +
      `subtitles=filename=${escapeFilterPath(endAssPath)}:fontsdir=${escapeFilterPath(FONTS_DIR)},` +
      `fade=t=in:st=0:d=0.3,format=yuv420p[v]`,
  ];
  await run(`Build ${d}s end card (${recipe.endCard.template === 'HERITAGE_LUXURY' ? 'Heritage' : 'High-Growth'} template)`, [
    '-f', 'lavfi', '-i', `color=c=${theme.background.replace('#', '0x')}:s=${W}x${H}:r=${FPS}:d=${d}`,
    ...(logoPath ? ['-loop', '1', '-t', String(d), '-i', logoPath] : []),
    '-f', 'lavfi', '-t', String(d), '-i', 'anullsrc=r=48000:cl=stereo',
    '-filter_complex', endParts.join(';'),
    '-map', '[v]', '-map', `${logoPath ? 2 : 1}:a`, '-t', String(d),
    ...VIDEO_CODEC, ...AUDIO_CODEC,
    endCard,
  ]);

  // 5. Append the end card
  const withEndCard = path.join(workDir, 'with_endcard.mp4');
  const brandedDuration = (await probeMedia(branded)).durationSeconds;
  const endDuration = (await probeMedia(endCard)).durationSeconds;
  const totalDuration = await crossfadeConcat(
    [branded, endCard],
    [brandedDuration, endDuration],
    0.3,
    withEndCard,
    run,
    'Append end card'
  );

  // 6. Music under the speech (ducked with a sidechain compressor), faded in/out
  if (musicPath && recipe.music) {
    const fadeOutStart = Math.max(0, totalDuration - 1.5).toFixed(2);
    await run(`Add music at ${Math.round(recipe.music.volume * 100)}% volume, ducked under speech`, [
      '-i', withEndCard,
      '-stream_loop', '-1', '-i', musicPath,
      '-filter_complex',
      [
        `[1:a]aresample=48000,aformat=channel_layouts=stereo,volume=${recipe.music.volume},afade=t=in:d=0.8,afade=t=out:st=${fadeOutStart}:d=1.5[m]`,
        `[0:a]asplit=2[voice][sc]`,
        `[m][sc]sidechaincompress=threshold=0.03:ratio=8:attack=20:release=400[duck]`,
        `[voice][duck]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[a]`,
      ].join(';'),
      '-map', '0:v', '-map', '[a]', '-t', totalDuration.toFixed(2),
      '-c:v', 'copy', ...AUDIO_CODEC,
      opts.outputVideoPath,
    ]);
  } else {
    await fsp.mkdir(path.dirname(opts.outputVideoPath), { recursive: true });
    await fsp.copyFile(withEndCard, opts.outputVideoPath);
    note('No music selected');
  }

  // 7. Poster frame
  await run('Extract poster frame', [
    '-ss', String(Math.min(1, totalDuration / 2)),
    '-i', opts.outputVideoPath,
    '-frames:v', '1', '-q:v', '3',
    opts.outputPosterPath,
  ]);

  return { durationSeconds: (await probeMedia(opts.outputVideoPath)).durationSeconds, steps };
}

/** Crossfade length actually used: kept shorter than half of the shortest clip */
function effectiveTransition(durations: number[], transition: number): number {
  if (durations.length < 2) return 0;
  return Math.max(0.1, Math.min(transition, Math.min(...durations) / 2 - 0.05));
}

/** Concatenates videos (all with audio) using xfade + acrossfade. Returns the output duration. */
async function crossfadeConcat(
  inputs: string[],
  durations: number[],
  transition: number,
  output: string,
  run: (name: string, args: string[]) => Promise<void>,
  stepName: string
): Promise<number> {
  if (inputs.length === 1) {
    await fsp.copyFile(inputs[0], output);
    return durations[0];
  }
  const t = effectiveTransition(durations, transition);
  const parts: string[] = [];
  inputs.forEach((_, i) => parts.push(`[${i}:v]settb=AVTB,fps=${FPS},format=yuv420p[v${i}]`));
  let vPrev = 'v0';
  let aPrev = '0:a';
  let offset = 0;
  for (let i = 1; i < inputs.length; i++) {
    offset += durations[i - 1] - t;
    const vOut = `vx${i}`;
    const aOut = `ax${i}`;
    parts.push(`[${vPrev}][v${i}]xfade=transition=fade:duration=${t.toFixed(2)}:offset=${offset.toFixed(3)}[${vOut}]`);
    parts.push(`[${aPrev}][${i}:a]acrossfade=d=${t.toFixed(2)}[${aOut}]`);
    vPrev = vOut;
    aPrev = aOut;
  }
  await run(stepName, [
    ...inputs.flatMap((p) => ['-i', p]),
    '-filter_complex', parts.join(';'),
    '-map', `[${vPrev}]`, '-map', `[${aPrev}]`,
    ...VIDEO_CODEC, ...AUDIO_CODEC,
    output,
  ]);
  return durations.reduce((a, b) => a + b, 0) - t * (inputs.length - 1);
}

async function requireLocal(key: string): Promise<string> {
  const local = await defaultStorage.ensureLocal(key);
  if (!fs.existsSync(local)) throw new Error(`Input file not found in storage: ${key}`);
  return local;
}

function fmt(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(1).padStart(4, '0')}`;
}

function quoteArg(arg: string): string {
  return /[\s;'"[\]]/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg;
}
