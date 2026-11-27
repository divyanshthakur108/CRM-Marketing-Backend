import fs from 'fs';
import fsp from 'fs/promises';
import { execFile } from 'child_process';
import path from 'path';
import crypto from 'crypto';
import { escapeFilterPath, runFfmpeg, spawnFfmpeg } from '../../utils/ffmpeg.js';
import type { FixPlan } from './knowledge.js';

/**
 * Clean-up of real photos and videos: deflicker, stabilise, straighten, fix converging verticals,
 * light / colour, then Real-ESRGAN (AI upscaler: restores detail, removes WhatsApp compression; it
 * doesn't add or remove objects), trim. Nothing here changes the layout of the property.
 */

export interface CleanOptions {
  kind: 'image' | 'video';
  width: number;
  height: number;
  plan: FixPlan;
  /** Video only: stabilise (camera shake was flagged) */
  stabilize?: boolean;
  /** Video only: path of the vidstabdetect result (pass 1) */
  transformsPath?: string;
  /** Real-ESRGAN does the upscaling (and most of the denoise / sharpening) between `pre` and `post` */
  aiUpscale?: boolean;
}

/** Output size: long side 1920 (never downscale), even numbers */
export function targetSize(width: number, height: number): { w: number; h: number } {
  const long = Math.max(width, height);
  const k = Math.max(1, 1920 / long);
  const even = (n: number) => Math.max(2, Math.round((n * k) / 2) * 2);
  return { w: even(width), h: even(height) };
}

/** Real-ESRGAN (ncnn, runs on the Mac GPU). REALESRGAN_PATH or <repo>/../tools/realesrgan/realesrgan-ncnn-vulkan */
export function realEsrganPath(): string | null {
  const p = process.env.REALESRGAN_PATH || path.resolve(process.cwd(), '..', 'tools', 'realesrgan', 'realesrgan-ncnn-vulkan');
  return fs.existsSync(p) ? p : null;
}

/** Human-readable list of what the filter chain does (shown on the page) */
export function describeFixes(o: CleanOptions): string[] {
  const p = o.plan;
  const out: string[] = [];
  if (o.kind === 'video') out.push('Flicker removed (auto-exposure pumping)');
  if (o.kind === 'video' && o.stabilize) out.push('Stabilised, smooth gimbal-like camera path');
  if (p.orientation === 'upside_down') out.push('Turned the right way up (was upside down)');
  if (p.orientation === 'turn_left' || p.orientation === 'turn_right') out.push(`Turned 90° ${p.orientation === 'turn_left' ? 'left' : 'right'}`);
  if (Math.abs(p.tiltDegrees) >= 0.7) out.push(`Straightened (${p.tiltDegrees > 0 ? '+' : ''}${p.tiltDegrees}°)`);
  if (p.keystone !== 'none') out.push(`Vertical lines corrected (camera pointing ${p.keystone === 'converge_down' ? 'down' : 'up'})`);
  if (p.exposure === 'dark') out.push('Brightened');
  if (p.exposure === 'bright') out.push('Highlights toned down');
  if (p.colourCast !== 'none') out.push(`Colour cast corrected (${p.colourCast})`);
  out.push('Contrast and colour boost');
  const quarter = p.orientation === 'turn_left' || p.orientation === 'turn_right';
  const W0 = quarter ? o.height : o.width;
  const H0 = quarter ? o.width : o.height;
  const t = targetSize(W0, H0);
  if (o.aiUpscale) {
    out.push(`AI upscale + detail restore with Real-ESRGAN (${o.kind === 'video' ? 'video model' : 'photo model'}): ${W0}×${H0} → ${t.w}×${t.h}, compression blocks and grain removed`);
  } else {
    if (p.noise !== 'low' || o.kind === 'video') out.push('Grain / compression reduced');
    out.push(t.w > W0 ? `Upscaled ${W0}×${H0} → ${t.w}×${t.h} and sharpened` : 'Sharpened');
  }
  return out;
}

/**
 * The ffmpeg chains (pure, unit tested). `pre` = everything at the source size (deflicker, stabilise,
 * orientation, straighten, perspective, light/colour); `post` = upscale + sharpen. With aiUpscale,
 * Real-ESRGAN runs between them, so `post` only resizes to the final size and sharpens lightly.
 */
export function buildCleanFilters(o: CleanOptions): { pre: string[]; post: string[] } {
  const p = o.plan;
  const f: string[] = [];

  if (o.kind === 'video' && o.stabilize && o.transformsPath) {
    f.push(`vidstabtransform=input=${escapeFilterPath(o.transformsPath)}:smoothing=35:optzoom=1:zoomspeed=0.15:interpol=bicubic`);
  }
  if (o.kind === 'video') f.push('deflicker=mode=pm:size=10');

  if (p.orientation === 'upside_down') f.push('hflip', 'vflip');
  if (p.orientation === 'turn_left') f.push('transpose=2');
  if (p.orientation === 'turn_right') f.push('transpose=1');
  // After a quarter turn the frame is the other way round
  const quarter = p.orientation === 'turn_left' || p.orientation === 'turn_right';
  const W0 = quarter ? o.height : o.width;
  const H0 = quarter ? o.width : o.height;

  // Straighten: rotate, then zoom just enough to hide the empty corners
  if (Math.abs(p.tiltDegrees) >= 0.7) {
    const a = (Math.abs(p.tiltDegrees) * Math.PI) / 180;
    const ratio = Math.max(W0, H0) / Math.min(W0, H0);
    const zoom = Math.cos(a) + Math.sin(a) * ratio;
    f.push(`rotate=${(p.tiltDegrees * Math.PI) / 180}:ow=iw:oh=ih:bilinear=1`);
    f.push(`scale=iw*${zoom.toFixed(4)}:ih*${zoom.toFixed(4)}:flags=bicubic`, `crop=${W0}:${H0}`);
  }

  // Converging verticals: sample the narrow end from further inside, so it is stretched outwards (no empty edges)
  if (p.keystone !== 'none') {
    const d = p.keystoneAmount === 'strong' ? 0.06 : 0.03;
    if (p.keystone === 'converge_down') {
      f.push(`perspective=x0=0:y0=0:x1=W:y1=0:x2=${d}*W:y2=H:x3=W-${d}*W:y3=H:interpolation=cubic`);
    } else {
      f.push(`perspective=x0=${d}*W:y0=0:x1=W-${d}*W:y1=0:x2=0:y2=H:x3=W:y3=H:interpolation=cubic`);
    }
  }

  // Denoise: Real-ESRGAN removes compression blocks itself, so only heavy grain is pre-cleaned
  if (!o.aiUpscale) {
    if (p.noise === 'high') f.push('hqdn3d=5:4:8:6');
    else if (p.noise === 'medium' || o.kind === 'video') f.push('hqdn3d=3:2.5:6:4.5');
  } else if (p.noise === 'high') {
    f.push('hqdn3d=2:1.5:4:3');
  }

  const eq = ['contrast=1.06', 'saturation=1.1'];
  if (p.exposure === 'dark') eq.push('brightness=0.04', 'gamma=1.12');
  if (p.exposure === 'bright') eq.push('brightness=-0.03', 'gamma=0.92');
  f.push(`eq=${eq.join(':')}`);

  const cast: Record<FixPlan['colourCast'], string> = {
    none: '',
    warm: 'colorbalance=rs=-0.05:rm=-0.04:bs=0.04:bm=0.03',
    cool: 'colorbalance=rs=0.04:rm=0.03:bs=-0.05:bm=-0.04',
    green: 'colorbalance=gs=-0.05:gm=-0.04',
    magenta: 'colorbalance=gs=0.04:gm=0.03',
  };
  if (cast[p.colourCast]) f.push(cast[p.colourCast]);

  const post: string[] = [];
  const t = targetSize(W0, H0);
  if (o.aiUpscale) {
    post.push(`scale=${t.w}:${t.h}:flags=lanczos`, p.blurry ? 'unsharp=5:5:0.5:5:5:0' : 'unsharp=3:3:0.3:3:3:0');
  } else {
    if (t.w !== W0 || t.h !== H0) post.push(`scale=${t.w}:${t.h}:flags=lanczos`);
    post.push(p.blurry ? 'unsharp=5:5:1.0:5:5:0' : 'unsharp=5:5:0.8:5:5:0');
  }
  if (o.kind === 'video') post.push('format=yuv420p');
  return { pre: f, post };
}

/** Single chain without the AI step (used when Real-ESRGAN isn't installed) */
export function buildCleanFilter(o: CleanOptions): string {
  const { pre, post } = buildCleanFilters({ ...o, aiUpscale: false });
  return [...pre, ...post].join(',');
}

function runEsrgan(bin: string, input: string, output: string, model: string, scale: number, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      bin,
      ['-i', input, '-o', output, '-n', model, '-s', String(scale), '-m', path.join(path.dirname(bin), 'models'), '-f', 'png'],
      { timeout: timeoutMs, maxBuffer: 1024 * 1024 * 16 },
      (err, _stdout, stderr) => (err ? reject(new Error(`Real-ESRGAN failed: ${String(stderr).slice(-300) || err.message}`)) : resolve())
    );
  });
}

/**
 * Runs the clean-up. Video: trim → 2-pass stabilisation → (Real-ESRGAN on every frame) → encode with the
 * original sound. Photo: fixes → Real-ESRGAN ×4 → resize. Falls back to plain ffmpeg without Real-ESRGAN.
 */
export async function runCleanup(params: {
  input: string;
  outDir: string;
  kind: 'image' | 'video';
  width: number;
  height: number;
  plan: FixPlan;
  stabilize: boolean;
  trim?: { start: number; end: number } | null;
  hasAudio?: boolean;
}): Promise<{ output: string; fixes: string[] }> {
  await fsp.mkdir(params.outDir, { recursive: true });
  const id = crypto.randomUUID();
  const esrgan = realEsrganPath();
  const opts: CleanOptions = { kind: params.kind, width: params.width, height: params.height, plan: params.plan, aiUpscale: Boolean(esrgan) };

  if (params.kind === 'image') {
    const output = path.join(params.outDir, `${id}.jpg`);
    if (!esrgan) {
      await runFfmpeg(['-y', '-i', params.input, '-vf', buildCleanFilter(opts), '-q:v', '2', '-frames:v', '1', output]);
      return { output, fixes: describeFixes(opts) };
    }
    const { pre, post } = buildCleanFilters(opts);
    const stage1 = path.join(params.outDir, `${id}-1.png`);
    const stage2 = path.join(params.outDir, `${id}-2.png`);
    await runFfmpeg(['-y', '-i', params.input, '-vf', pre.join(','), '-frames:v', '1', stage1]);
    await runEsrgan(esrgan, stage1, stage2, 'realesrgan-x4plus', 4, 5 * 60 * 1000);
    await runFfmpeg(['-y', '-i', stage2, '-vf', post.join(','), '-q:v', '2', '-frames:v', '1', output]);
    return { output, fixes: describeFixes(opts) };
  }

  const trimArgs = params.trim ? ['-ss', params.trim.start.toFixed(2), '-to', params.trim.end.toFixed(2)] : [];
  if (params.stabilize) {
    const trf = path.join(params.outDir, `${id}.trf`);
    await runFfmpeg(['-y', ...trimArgs, '-i', params.input, '-vf', `vidstabdetect=shakiness=8:accuracy=15:stepsize=6:result=${escapeFilterPath(trf)}`, '-f', 'null', '-']);
    opts.stabilize = true;
    opts.transformsPath = trf;
  }
  const output = path.join(params.outDir, `${id}.mp4`);
  const audio = params.hasAudio ? ['-c:a', 'aac', '-b:a', '160k'] : ['-an'];
  const encode = ['-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-movflags', '+faststart'];

  if (!esrgan) {
    await runFfmpeg(['-y', ...trimArgs, '-i', params.input, '-vf', buildCleanFilter(opts), ...encode, ...audio, output]);
  } else {
    const { pre, post } = buildCleanFilters(opts);
    const framesIn = path.join(params.outDir, `${id}-in`);
    const framesOut = path.join(params.outDir, `${id}-out`);
    await fsp.mkdir(framesIn, { recursive: true });
    await fsp.mkdir(framesOut, { recursive: true });
    // 1. fixes at source size → numbered PNG frames (constant 30 fps)
    await runFfmpeg(['-y', ...trimArgs, '-i', params.input, '-vf', [...pre, 'fps=30'].join(','), path.join(framesIn, 'f%05d.png')]);
    // 2. Real-ESRGAN video model ×2 on every frame (~0.5 s per frame on an M3)
    const frames = (await fsp.readdir(framesIn)).length;
    await runEsrgan(esrgan, framesIn, framesOut, 'realesr-animevideov3', 2, Math.max(10 * 60 * 1000, frames * 3000));
    // 3. frames → video at the final size, with the original sound (same trim)
    const audioIn = params.hasAudio ? [...trimArgs, '-i', params.input] : [];
    await runFfmpeg(
      [
        '-y', '-framerate', '30', '-i', path.join(framesOut, 'f%05d.png'), ...audioIn,
        '-map', '0:v', ...(params.hasAudio ? ['-map', '1:a?', '-shortest'] : []),
        '-vf', post.join(','), ...encode, ...audio, output,
      ],
      30 * 60 * 1000
    );
    await fsp.rm(framesIn, { recursive: true, force: true });
    await fsp.rm(framesOut, { recursive: true, force: true });
  }
  const fixes = describeFixes(opts);
  if (params.trim) fixes.unshift(`Trimmed to ${params.trim.start.toFixed(1)}–${params.trim.end.toFixed(1)} s (accidental parts cut)`);
  return { output, fixes };
}

/**
 * Measures how much the picture is tilted from the near-vertical edges (walls, door frames, poles).
 * No AI: Sobel gradients on a small grey copy, then the strongest angle within ±12° of vertical.
 * Returns the CLOCKWISE rotation that straightens it (same meaning as FixPlan.tiltDegrees) and a
 * confidence 0..1. Low confidence = not enough straight vertical lines (e.g. a garden shot).
 */
export async function measureTilt(image: Buffer): Promise<{ degrees: number; confidence: number }> {
  const { default: sharp } = await import('sharp');
  const { data, info } = await sharp(image).rotate().greyscale().resize(640, 640, { fit: 'inside' }).raw().toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;
  const binsPerDeg = 4;
  const maxDeg = 12;
  const hist = new Float64Array(maxDeg * 2 * binsPerDeg + 1);
  const mags: number[] = [];
  const samples: Array<[number, number]> = [];
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx =
        data[i - w + 1] + 2 * data[i + 1] + data[i + w + 1] - data[i - w - 1] - 2 * data[i - 1] - data[i + w - 1];
      const gy =
        data[i + w - 1] + 2 * data[i + w] + data[i + w + 1] - data[i - w - 1] - 2 * data[i - w] - data[i - w + 1];
      const mag = Math.hypot(gx, gy);
      if (mag < 60) continue;
      // gradient angle folded to (-90, 90]; ~0 means the edge itself is near-vertical
      let a = (Math.atan2(gy, gx) * 180) / Math.PI;
      if (a > 90) a -= 180;
      if (a <= -90) a += 180;
      if (Math.abs(a) > maxDeg) continue;
      samples.push([a, mag]);
      mags.push(mag);
    }
  }
  if (samples.length < 300) return { degrees: 0, confidence: 0 };
  mags.sort((p, q) => p - q);
  const cut = mags[Math.floor(mags.length * 0.6)]; // strongest 40% of edges
  let total = 0;
  for (const [a, m] of samples) {
    if (m < cut) continue;
    hist[Math.round((a + maxDeg) * binsPerDeg)] += m;
    total += m;
  }
  // smooth, find the peak, refine with a parabola
  const sm = hist.map((_, i) => (hist[i - 1] ?? 0) * 0.25 + hist[i] * 0.5 + (hist[i + 1] ?? 0) * 0.25);
  let best = 0;
  for (let i = 1; i < sm.length; i++) if (sm[i] > sm[best]) best = i;
  const l = sm[best - 1] ?? sm[best];
  const r = sm[best + 1] ?? sm[best];
  const denom = l - 2 * sm[best] + r;
  const offset = denom !== 0 ? (0.5 * (l - r)) / denom : 0;
  const lean = (best + offset) / binsPerDeg - maxDeg; // + = edges lean clockwise
  // share of edge weight near the peak (±1°)
  let near = 0;
  for (let i = Math.max(0, best - binsPerDeg); i <= Math.min(sm.length - 1, best + binsPerDeg); i++) near += hist[i];
  const confidence = total ? Math.min(1, near / total) : 0;
  const degrees = Math.round(-lean * 10) / 10;
  return { degrees: Math.abs(degrees) < 0.5 ? 0 : degrees, confidence: Math.round(confidence * 100) / 100 };
}

export interface SetupCheck {
  key: string;
  label: string;
  ok: boolean;
  usedFor: string;
  fix: string;
}

let ffmpegFilters: Promise<string> | null = null;

/**
 * What this machine has for Creative Lab, shown on the page so a new developer knows what to install.
 * Everything here is optional except ffmpeg; missing pieces fall back to simpler output.
 */
export async function checkSetup(env: { GEMINI_API_KEY: string; CLOUDFLARE_ACCOUNT_ID: string; CLOUDFLARE_API_TOKEN: string }): Promise<SetupCheck[]> {
  ffmpegFilters ??= new Promise<string>((resolve) => {
    const proc = spawnFfmpeg(['-hide_banner', '-filters']);
    let out = '';
    proc.stdout?.on('data', (d) => (out += d));
    proc.on('error', () => resolve(''));
    proc.on('close', () => resolve(out));
  });
  const filters = await ffmpegFilters;
  if (!filters) ffmpegFilters = null; // retry next time
  return [
    {
      key: 'ffmpeg',
      label: 'ffmpeg with vidstab + libass',
      ok: /vidstabdetect/.test(filters) && /\bass\b/.test(filters) && /deflicker/.test(filters),
      usedFor: 'All video work: stabilise, deflicker, captions',
      fix: 'macOS: brew install ffmpeg-full, then set FFMPEG_PATH=/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg in the backend .env (see docs/CREATIVE_LAB_POC.md "New developer setup")',
    },
    {
      key: 'realesrgan',
      label: 'Real-ESRGAN AI upscaler',
      ok: Boolean(realEsrganPath()),
      usedFor: 'Clean-up: sharp HD from WhatsApp-quality files (without it: bigger but not sharper)',
      fix: 'In CRM-Marketing-Backend run: npm run setup:realesrgan (downloads the official release, ~50 MB, into ../tools/realesrgan)',
    },
    {
      key: 'gemini',
      label: 'Gemini API key',
      ok: Boolean(env.GEMINI_API_KEY),
      usedFor: 'Knowledge cards, clean-up check (free: ~20 requests/day/model). Map card "Gemini (paid)" needs billing',
      fix: 'Set GEMINI_API_KEY in the backend .env (aistudio.google.com/apikey)',
    },
    {
      key: 'cloudflare',
      label: 'Cloudflare Workers AI',
      ok: Boolean(env.CLOUDFLARE_ACCOUNT_ID && env.CLOUDFLARE_API_TOKEN),
      usedFor: 'Free map card backgrounds (FLUX)',
      fix: 'Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN (token with Workers AI permission) in the backend .env',
    },
  ];
}
