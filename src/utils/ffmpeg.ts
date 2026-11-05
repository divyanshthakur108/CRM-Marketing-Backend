import { ChildProcess, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

/**
 * ffmpeg location. Set FFMPEG_PATH to a build with libass + HarfBuzz (e.g. Homebrew "ffmpeg-full")
 * so Hindi/Punjabi captions render correctly. Falls back to "ffmpeg" on PATH.
 * Ignored when MEDIA_TOOLS=docker.
 */
export function resolveFfmpegBinary(): string {
  const configured = process.env.FFMPEG_PATH;
  if (configured && fs.existsSync(configured)) return configured;
  return 'ffmpeg';
}

/** ffprobe that ships next to the configured ffmpeg. */
export function resolveFfprobeBinary(): string {
  const ffmpeg = resolveFfmpegBinary();
  if (ffmpeg === 'ffmpeg') return 'ffprobe';
  const candidate = path.join(path.dirname(ffmpeg), `ffprobe${path.extname(ffmpeg)}`);
  return fs.existsSync(candidate) ? candidate : 'ffprobe';
}

// ── Docker mode ─────────────────────────────────────────────────────────────
// MEDIA_TOOLS=docker runs ffmpeg/ffprobe inside the "media-tools" container (docker-compose.yml),
// so every engineer (macOS, Windows, Linux) gets the same ffmpeg build without installing it.
// The backend folder is mounted at /work in the container, so file paths are rewritten to match.

const CONTAINER_ROOT = '/work';

export function usesDockerMediaTools(): boolean {
  return process.env.MEDIA_TOOLS === 'docker';
}

function dockerContainerName(): string {
  return process.env.MEDIA_TOOLS_CONTAINER || 'realcrm-media-tools';
}

/**
 * Rewrites host paths under the backend folder to the container's /work folder.
 * Handles plain paths (C:\...\storage\x.mp4 or /Users/.../storage/x.mp4) and paths already
 * escaped for a filtergraph (C\:/.../x.ass). Files outside the backend folder can't be seen by the container.
 */
export function toContainerPath(arg: string, root = path.resolve(process.cwd())): string {
  const slashRoot = root.replace(/\\/g, '/');
  if (arg.startsWith(root) || arg.startsWith(slashRoot)) {
    return CONTAINER_ROOT + arg.slice(root.length).replace(/\\/g, '/');
  }
  return arg.split(escapeFilterPath(root)).join(CONTAINER_ROOT).split(slashRoot).join(CONTAINER_ROOT);
}

function spawnTool(tool: 'ffmpeg' | 'ffprobe', localBinary: string, args: string[]): ChildProcess {
  if (!usesDockerMediaTools()) return spawn(localBinary, args);
  return spawn('docker', ['exec', dockerContainerName(), tool, ...args.map((a) => toContainerPath(a))]);
}

/** Starts ffmpeg locally, or inside the media-tools container when MEDIA_TOOLS=docker. */
export function spawnFfmpeg(args: string[]): ChildProcess {
  return spawnTool('ffmpeg', resolveFfmpegBinary(), args);
}

/** Starts ffprobe locally, or inside the media-tools container when MEDIA_TOOLS=docker. */
export function spawnFfprobe(args: string[]): ChildProcess {
  return spawnTool('ffprobe', resolveFfprobeBinary(), args);
}

/**
 * Drop-in for spawn(binary, args) where binary is a resolved ffmpeg or ffprobe path.
 * Runs that binary locally, or the same tool inside the media-tools container when MEDIA_TOOLS=docker.
 */
export function spawnMediaTool(localBinary: string, args: string[]): ChildProcess {
  const tool = /ffprobe/i.test(path.basename(localBinary)) ? 'ffprobe' : 'ffmpeg';
  return spawnTool(tool, localBinary, args);
}

export interface ProcessResult {
  ms: number;
  stderrTail: string;
}

/** Runs ffmpeg and resolves when it exits with code 0. Rejects with the last part of stderr. */
export function runFfmpeg(args: string[], timeoutMs = 10 * 60 * 1000): Promise<ProcessResult> {
  const started = Date.now();
  const docker = usesDockerMediaTools();
  return new Promise((resolve, reject) => {
    const proc = spawnFfmpeg(args);
    let stderr = '';
    proc.stderr?.on('data', (d: Buffer) => {
      stderr = (stderr + d.toString()).slice(-4000);
    });
    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error(`ffmpeg timed out after ${Math.round(timeoutMs / 1000)}s`));
    }, timeoutMs);
    proc.on('error', (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      if (err.code !== 'ENOENT') return reject(err);
      reject(
        new Error(
          docker
            ? 'Docker is not installed or not on PATH (MEDIA_TOOLS=docker)'
            : 'ffmpeg is not installed on the server (set FFMPEG_PATH, or use MEDIA_TOOLS=docker)'
        )
      );
    });
    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) return resolve({ ms: Date.now() - started, stderrTail: stderr.slice(-800) });
      const hint =
        docker && /No such container|is not running|Cannot connect to the Docker daemon/i.test(stderr)
          ? ' (start it with: docker compose up -d media-tools)'
          : '';
      reject(new Error(`ffmpeg exited with code ${code}${hint}: ${stderr.slice(-800)}`));
    });
  });
}

export interface MediaProbe {
  durationSeconds: number;
  hasVideo: boolean;
  hasAudio: boolean;
  width?: number;
  height?: number;
}

export async function probeMedia(filePath: string): Promise<MediaProbe> {
  const args = ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,width,height', '-of', 'json', filePath];
  const output = await new Promise<string>((resolve, reject) => {
    const proc = spawnFfprobe(args);
    let out = '';
    let err = '';
    proc.stdout?.on('data', (d: Buffer) => (out += d.toString()));
    proc.stderr?.on('data', (d: Buffer) => (err += d.toString()));
    proc.on('error', reject);
    proc.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(`ffprobe failed: ${err.slice(-300)}`))));
  });
  const json = JSON.parse(output) as {
    format?: { duration?: string };
    streams?: Array<{ codec_type?: string; width?: number; height?: number }>;
  };
  const video = json.streams?.find((s) => s.codec_type === 'video');
  return {
    durationSeconds: Number(json.format?.duration) || 0,
    hasVideo: Boolean(video),
    hasAudio: Boolean(json.streams?.some((s) => s.codec_type === 'audio')),
    width: video?.width,
    height: video?.height,
  };
}

/** Escapes a file path for use inside an ffmpeg filtergraph option (e.g. subtitles=filename=...). */
export function escapeFilterPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/([:'[\],;])/g, '\\$1');
}
