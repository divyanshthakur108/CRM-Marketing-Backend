import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { EditRecipe, END_CARD_THEMES, placeCuesOnTimeline, RecipeCut } from './recipe.js';
import { buildEndCardAss, buildMainAss } from './ass.js';
import { buildZoomExpression, SAME_CLIP_TRANSITION_SECONDS } from './creatorStyle.js';
import { defaultStorage } from '../../storage/localStorage.adapter.js';
import { escapeFilterPath, probeMedia, runFfmpeg } from '../../utils/ffmpeg.js';
import { logger } from '../../config/logger.js';

export interface RenderStep {
  name: string;
  ms: number;
  command?: string;
}

export interface RenderResult {
  durationSeconds: number;
  steps: RenderStep[];
}

export const AUDIO_NOISE_REDUCTION = 'afftdn=nr=12:nf=-30';
export const AUDIO_HIGHPASS = 'highpass=f=80';
export const AUDIO_LOUDNORM_TARGET = 'loudnorm=I=-14:TP=-1.5:LRA=11';

export const VIDSTAB_SMOOTHING = 10;
export const STYLE_GRADE_HERITAGE = 'eq=saturation=1.03:contrast=1.02,colorbalance=rs=0.02:gs=0.01:bs=-0.02';
export const STYLE_GRADE_HIGH_GROWTH = 'eq=saturation=1.04:contrast=1.04,colorbalance=rs=-0.01:gs=0.01:bs=0.02';

let _hasVidstabCached: boolean | null = null;
export async function checkFfmpegHasVidstab(): Promise<boolean> {
  if (_hasVidstabCached !== null) return _hasVidstabCached;
  try {
    const { execFile } = await import('child_process');
    const { promisify } = await import('util');
    const execFileAsync = promisify(execFile);
    await execFileAsync('ffmpeg', ['-f', 'lavfi', '-i', 'nullsrc=s=64x64:d=0.04', '-vf', 'vidstabdetect', '-f', 'null', '-']);
    _hasVidstabCached = true;
  } catch {
    _hasVidstabCached = false;
  }
  return _hasVidstabCached;
}

export async function measureClipBrightness(filePath: string): Promise<number | null> {
  try {
    const { execFile } = await import('child_process');
    const { promisify } = await import('util');
    const execFileAsync = promisify(execFile);
    const { stderr } = await execFileAsync('ffmpeg', [
      '-i', filePath,
      '-t', '2',
      '-vf', 'signalstats',
      '-f', 'null',
      '-',
    ]);
    const matches = Array.from(stderr.matchAll(/YAVG=([0-9.]+)/g));
    if (!matches.length) return null;
    const vals = matches.map((m) => parseFloat(m[1])).filter((v) => !isNaN(v));
    if (!vals.length) return null;
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  } catch {
    return null;
  }
}

export function computeColorMatchOffset(clipY: number, medianY: number): number {
  const delta = (medianY - clipY) / 255;
  return Math.max(-0.08, Math.min(0.08, delta));
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
  // The same clip can appear in several cuts or overlays: fetch each file once
  const localByKey = new Map<string, string>();
  for (const cut of recipe.cuts) {
    if (!localByKey.has(cut.key)) localByKey.set(cut.key, await requireLocal(cut.key));
  }
  for (const ov of recipe.overlays || []) {
    if (!localByKey.has(ov.source.key)) localByKey.set(ov.source.key, await requireLocal(ov.source.key));
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

  const hasVidstab = await checkFfmpegHasVidstab();
  if (recipe.stabilizeShaky && !hasVidstab) {
    note('Stabilization skipped: ffmpeg built without libvidstab');
  }

  // Measure clip brightness for color matching if multiple cuts and matchColours is not false
  const brightnessMap = new Map<string, number>();
  let medianBrightness = 128;
  if (recipe.matchColours !== false && clipPaths.length > 1) {
    const uniquePaths = Array.from(new Set(clipPaths));
    const vals: number[] = [];
    for (const p of uniquePaths) {
      const b = await measureClipBrightness(p);
      if (b !== null) {
        brightnessMap.set(p, b);
        vals.push(b);
      }
    }
    if (vals.length > 1) {
      vals.sort((a, b) => a - b);
      medianBrightness = vals[Math.floor(vals.length / 2)];
      note(`Measured brightness across ${vals.length} clip(s) (median Y=${medianBrightness.toFixed(1)})`);
    }
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
    const speechAudioFilters = [
      'aresample=48000',
      'aformat=channel_layouts=stereo',
      AUDIO_HIGHPASS,
      AUDIO_NOISE_REDUCTION,
      AUDIO_LOUDNORM_TARGET,
    ].join(',');
    const audioChain = probe.hasAudio
      ? `[0:a]${speechAudioFilters}[a]`
      : '[1:a]aformat=sample_rates=48000:channel_layouts=stereo[a]';
    const what = recipe.editing === 'smart' ? `${cut.filename || 'clip'} ${fmt(start)}–${fmt(end)}${cut.label ? `, ${cut.label}` : ''}` : cut.filename || 'clip';
    const audioLog = probe.hasAudio ? ` [audio: ${AUDIO_HIGHPASS}, ${AUDIO_NOISE_REDUCTION}, ${AUDIO_LOUDNORM_TARGET}]` : ' [audio: silence]';

    // Stabilization (vidstab pass 1 detect, pass 2 transform)
    let vidstabFilter = '';
    const isShaky = (cut.issues || []).includes('shaky');
    const shouldStabilize = (recipe.stabilizeShaky !== false && isShaky) || recipe.stabilizeShaky === true;
    if (shouldStabilize && hasVidstab) {
      const trfPath = path.join(workDir, `transforms_${i}.trf`);
      try {
        await run(`Stabilize cut ${i + 1} motion analysis (vidstabdetect)`, [
          '-ss', start.toFixed(3),
          '-i', clipPaths[i],
          '-t', (end - start).toFixed(3),
          '-vf', `vidstabdetect=result='${escapeFilterPath(trfPath)}':shakiness=8:accuracy=15`,
          '-f', 'null',
          '-',
        ]);
        if (fs.existsSync(trfPath)) {
          vidstabFilter = `,vidstabtransform=input='${escapeFilterPath(trfPath)}':smoothing=${VIDSTAB_SMOOTHING}:zoom=0:optzoom=1`;
        }
      } catch (err) {
        logger.warn({ err }, `Vidstab pass 1 failed for cut ${i + 1}, skipping stabilization`);
      }
    }

    // Color match filter
    let colorFilter = '';
    if (recipe.matchColours !== false && brightnessMap.has(clipPaths[i])) {
      const clipY = brightnessMap.get(clipPaths[i])!;
      const offset = computeColorMatchOffset(clipY, medianBrightness);
      if (Math.abs(offset) >= 0.005) {
        colorFilter = `,eq=brightness=${offset.toFixed(3)}`;
      }
    }

    // Style grade filter (subtle warm for HERITAGE_LUXURY, crisp cool for HIGH_GROWTH_ROI)
    let styleGradeFilter = '';
    if (recipe.endCard.template === 'HERITAGE_LUXURY') {
      styleGradeFilter = `,${STYLE_GRADE_HERITAGE}`;
    } else if (recipe.endCard.template === 'HIGH_GROWTH_ROI') {
      styleGradeFilter = `,${STYLE_GRADE_HIGH_GROWTH}`;
    }

    await run(`Cut ${i + 1} (${what}) → 1080×1920, 30fps${audioLog}`, [
      '-ss', start.toFixed(3),
      '-i', clipPaths[i],
      ...(probe.hasAudio ? [] : ['-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo']),
      '-t', (end - start).toFixed(3),
      '-filter_complex',
      [
        `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},boxblur=luma_radius=40:luma_power=2,setsar=1[bg]`,
        `[0:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,setsar=1[fg]`,
        `[bg][fg]overlay=(W-w)/2:(H-h)/2,fps=${FPS}${vidstabFilter}${colorFilter}${styleGradeFilter},format=yuv420p[v]`,
        audioChain,
      ].join(';'),
      '-map', '[v]', '-map', '[a]', '-shortest',
      ...VIDEO_CODEC, ...AUDIO_CODEC,
      seg,
    ]);
    segments.push(seg);
    segmentDurations.push((await probeMedia(seg)).durationSeconds);
  }

  // 2. Merge clips with short crossfades (plain cuts between consecutive cuts of the same clip)
  const merged = path.join(workDir, 'merged.mp4');
  const sameClipCount = recipe.cuts.filter((c, i) => i > 0 && c.key === recipe.cuts[i - 1].key).length;
  const crossfadeCount = Math.max(0, recipe.cuts.length - 1 - sameClipCount);
  const mergeLabel = `Merge ${segments.length} cut(s) (${crossfadeCount} crossfade(s) @ ${recipe.transitionSeconds}s, ${sameClipCount} plain cut(s))`;
  const mergedDuration = await crossfadeConcat(
    segments,
    segmentDurations,
    recipe.transitionSeconds,
    merged,
    run,
    mergeLabel,
    recipe.cuts
  );

  // 2.2 Punch-in zooms on presenter A-roll (hides jump cuts, adds energy)
  let videoBase = merged;
  if (recipe.zooms && recipe.zooms.length > 0) {
    try {
      const zoomExpr = buildZoomExpression(recipe.zooms);
      const withZooms = path.join(workDir, 'with_zooms.mp4');
      await run(
        `Punch-in zoom on presenter (${recipe.zooms.length} stretch(es))`,
        [
          '-i', merged,
          '-filter_complex',
          `[0:v]zoompan=z='${zoomExpr}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${W}x${H}:fps=${FPS},format=yuv420p[v]`,
          '-map', '[v]', '-map', '0:a',
          ...VIDEO_CODEC, '-c:a', 'copy',
          withZooms,
        ]
      );
      videoBase = withZooms;
    } catch (err) {
      logger.warn({ err }, 'Failed to apply punch-in zooms, keeping unzoomed base');
      videoBase = merged;
    }
  }

  // 2.5. B-roll overlays on top of merged A-roll (narration backbone audio is preserved 100%)
  if (recipe.overlays && recipe.overlays.length > 0) {
    try {
      const overlayPieces: { path: string; start: number; end: number }[] = [];
      for (let i = 0; i < recipe.overlays.length; i++) {
        const ov = recipe.overlays[i];
        const ovPath = localByKey.get(ov.source.key);
        if (!ovPath) continue;

        const isPhoto = ov.source.kind === 'photo' || /\.(png|jpg|jpeg|webp)$/i.test(ov.source.key);
        if (!isPhoto) {
          const ovProbe = await probeMedia(ovPath);
          if (!ovProbe.hasVideo) continue;
        }

        const dur = Math.max(0.5, ov.end - ov.start);
        const inSec = Math.max(0, ov.source.in ?? 0);
        const ovSeg = path.join(workDir, `broll_${i}.mp4`);

        const isCard = ov.style === 'CARD';
        const fontPath = escapeFilterPath(path.join(FONTS_DIR, 'NotoSans-Bold.ttf'));
        const filterParts: string[] = [];

        if (isPhoto) {
          if (isCard) {
            filterParts.push(`[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},boxblur=luma_radius=40:luma_power=2,setsar=1[bg]`);
            filterParts.push(`[0:v]scale=960:-2:force_original_aspect_ratio=decrease,setsar=1[card]`);
            filterParts.push(`[bg][card]overlay=(W-w)/2:(H-h)/2[base]`);
          } else {
            // FULL (Ken Burns zoompan)
            filterParts.push(`[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},zoompan=z='min(zoom+0.0015,1.2)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${W}x${H}:fps=${FPS},setsar=1[base]`);
          }
        } else {
          // Video clip
          if (isCard) {
            filterParts.push(`[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},boxblur=luma_radius=40:luma_power=2,setsar=1[bg]`);
            filterParts.push(`[0:v]scale=960:-2:force_original_aspect_ratio=decrease,setsar=1[card]`);
            filterParts.push(`[bg][card]overlay=(W-w)/2:(H-h)/2[base]`);
          } else {
            // Standard normalized blurred background fill
            filterParts.push(`[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},boxblur=luma_radius=40:luma_power=2,setsar=1[bg]`);
            filterParts.push(`[0:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,setsar=1[fg]`);
            filterParts.push(`[bg][fg]overlay=(W-w)/2:(H-h)/2[base]`);
          }
        }

        let currNode = 'base';
        if (ov.isIllustrative) {
          filterParts.push(`[${currNode}]drawtext=fontfile='${fontPath}':text='Artist\\'\\''s impression':fontcolor=white:fontsize=26:box=1:boxcolor=0xC53030@0.85:boxborderw=8:x=60:y=100[dt1]`);
          currNode = 'dt1';
        }

        if (ov.label) {
          const safeLabel = ov.label.replace(/['\\:%]/g, ' ').trim().slice(0, 40);
          if (safeLabel) {
            const yPos = ov.isIllustrative ? 160 : 100;
            filterParts.push(`[${currNode}]drawtext=fontfile='${fontPath}':text='${safeLabel}':fontcolor=white:fontsize=34:box=1:boxcolor=black@0.65:boxborderw=12:x=60:y=${yPos}[dt2]`);
            currNode = 'dt2';
          }
        }

        filterParts.push(`[${currNode}]fps=${FPS},format=yuv420p,fade=t=in:st=0:d=0.2,fade=t=out:st=${Math.max(0, dur - 0.2).toFixed(3)}:d=0.2[v]`);

        const inputArgs = isPhoto
          ? ['-loop', '1', '-t', dur.toFixed(3), '-i', ovPath]
          : ['-ss', inSec.toFixed(3), '-i', ovPath, '-t', dur.toFixed(3)];

        await run(`Prepare B-roll ${i + 1} (${ov.label || 'overlay'})`, [
          ...inputArgs,
          '-filter_complex',
          filterParts.join(';'),
          '-map', '[v]', '-an',
          ...VIDEO_CODEC,
          ovSeg,
        ]);
        overlayPieces.push({ path: ovSeg, start: ov.start, end: ov.end });
      }

      if (overlayPieces.length > 0) {
        const brollMerged = path.join(workDir, 'broll_merged.mp4');
        const filterParts: string[] = [];
        let curr = '0:v';
        overlayPieces.forEach((piece, idx) => {
          const next = `bv${idx + 1}`;
          filterParts.push(`[${curr}][${idx + 1}:v]overlay=0:0:enable='between(t,${piece.start.toFixed(3)},${piece.end.toFixed(3)})':eof_action=pass[${next}]`);
          curr = next;
        });

        await run(`Overlay ${overlayPieces.length} B-roll cutaway(s) over speech`, [
          '-i', merged,
          ...overlayPieces.flatMap((p) => ['-i', p.path]),
          '-filter_complex', filterParts.join(';'),
          '-map', `[${curr}]`, '-map', '0:a',
          ...VIDEO_CODEC, '-c:a', 'copy',
          brollMerged,
        ]);
        videoBase = brollMerged;
      }
    } catch (err) {
      logger.warn({ err }, 'Failed to apply B-roll overlays, falling back to base video');
      videoBase = merged;
    }
  }

  // 3. Captions (ASS via libass + HarfBuzz) + watermark (logo overlay, or org name as text)
  const theme = END_CARD_THEMES[recipe.endCard.template];
  const branded = path.join(workDir, 'branded.mp4');
  const speechCues =
    recipe.captions?.source === 'speech'
      ? placeCuesOnTimeline(recipe.cuts, segmentDurations, effectiveTransition(segmentDurations, recipe.transitionSeconds), recipe.captions?.keywords)
      : undefined;
  const mainAss = buildMainAss({
    durationSeconds: mergedDuration,
    captions: recipe.captions,
    cues: speechCues,
    watermarkText: logoPath ? undefined : recipe.watermark.text,
    accentHex: theme?.accent,
    hook: recipe.hook,
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
      parts.push(`[${current}]subtitles=filename='${escapeFilterPath(assPath)}':fontsdir='${escapeFilterPath(FONTS_DIR)}'[sub]`);
      current = 'sub';
    }
    const what = [
      recipe.captions ? `${recipe.captions.lines.length} caption line(s) (${recipe.captions.language}, ${recipe.captions.style.toLowerCase()})` : null,
      logoPath ? 'logo watermark' : recipe.watermark.text ? 'org-name watermark' : null,
    ].filter(Boolean);
    await run(`Burn in ${what.join(' + ')}`, [
      '-i', videoBase,
      ...(logoPath ? ['-i', logoPath] : []),
      '-filter_complex', parts.join(';'),
      '-map', `[${current}]`, '-map', '0:a',
      ...VIDEO_CODEC, '-c:a', 'copy',
      branded,
    ]);
  } else {
    await fsp.copyFile(videoBase, branded);
    note('No captions or watermark to add');
  }

  // 4. End card: brand background, logo, project/org name, phone + RERA only if provided, gentle zoom + fade
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
      `subtitles=filename='${escapeFilterPath(endAssPath)}':fontsdir='${escapeFilterPath(FONTS_DIR)}',` +
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
  const preLoudnorm = path.join(workDir, 'pre_loudnorm.mp4');
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
      preLoudnorm,
    ]);
  } else {
    await fsp.copyFile(withEndCard, preLoudnorm);
    note('No music selected');
  }

  // 6.5 Final loudness normalization pass on complete mix (guarantees integrated loudness lands within 1 LU of -14 LUFS)
  await fsp.mkdir(path.dirname(opts.outputVideoPath), { recursive: true });
  await run(`Final mix loudness normalization (${AUDIO_LOUDNORM_TARGET})`, [
    '-i', preLoudnorm,
    '-c:v', 'copy',
    '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-ac', '2',
    '-af', AUDIO_LOUDNORM_TARGET,
    opts.outputVideoPath,
  ]);

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
  stepName: string,
  cuts?: RecipeCut[]
): Promise<number> {
  if (inputs.length === 1) {
    await fsp.copyFile(inputs[0], output);
    return durations[0];
  }
  const defaultT = effectiveTransition(durations, transition);
  const parts: string[] = [];
  inputs.forEach((_, i) => parts.push(`[${i}:v]settb=AVTB,fps=${FPS},format=yuv420p[v${i}]`));
  let vPrev = 'v0';
  let aPrev = '0:a';
  let offset = 0;
  let totalTransitions = 0;
  for (let i = 1; i < inputs.length; i++) {
    const isSameClip = cuts && cuts.length > i && cuts[i].key === cuts[i - 1].key;
    const t = isSameClip ? SAME_CLIP_TRANSITION_SECONDS : defaultT;
    totalTransitions += t;
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
  return durations.reduce((a, b) => a + b, 0) - totalTransitions;
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
