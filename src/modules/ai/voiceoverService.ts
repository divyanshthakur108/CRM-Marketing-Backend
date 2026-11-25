import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { spawnMediaTool } from '../../utils/ffmpeg.js';
import { getAllAudioBase64 } from 'google-tts-api';
import { logger } from '../../config/logger.js';
import { env } from '../../config/env.js';
import { AppError } from '../../utils/AppError.js';

export interface VoiceoverResult {
  filePath: string;
  durationSeconds: number;
  buffer: Buffer;
}

export class VoiceoverService {
  /**
   * Resolves the ffmpeg executable binary path
   */
  private resolveFfmpegBinary(): string {
    if (process.env.FFMPEG_PATH && fsSync.existsSync(process.env.FFMPEG_PATH)) {
      return process.env.FFMPEG_PATH;
    }
    const localAppData =
      process.env.LOCALAPPDATA ||
      (process.env.USERPROFILE ? path.join(process.env.USERPROFILE, 'AppData', 'Local') : '');

    if (localAppData) {
      const wingetDir = path.join(localAppData, 'Microsoft', 'WinGet', 'Packages');
      if (fsSync.existsSync(wingetDir)) {
        try {
          const packages = fsSync.readdirSync(wingetDir);
          for (const pkg of packages) {
            if (pkg.toLowerCase().includes('ffmpeg')) {
              const pkgPath = path.join(wingetDir, pkg);
              const findExe = (dir: string, depth = 0): string | null => {
                if (depth > 3) return null;
                const entries = fsSync.readdirSync(dir, { withFileTypes: true });
                for (const entry of entries) {
                  const full = path.join(dir, entry.name);
                  if (entry.isFile() && entry.name.toLowerCase() === 'ffmpeg.exe') {
                    return full;
                  }
                  if (entry.isDirectory()) {
                    const res = findExe(full, depth + 1);
                    if (res) return res;
                  }
                }
                return null;
              };
              const found = findExe(pkgPath);
              if (found) return found;
            }
          }
        } catch {
          // ignore
        }
      }
    }
    return 'ffmpeg';
  }

  /**
   * Probes duration of an audio file using ffmpeg
   */
  public async getAudioDuration(filePath: string): Promise<number> {
    const ffmpegBin = this.resolveFfmpegBinary();
    return new Promise((resolve) => {
      const proc = spawnMediaTool(ffmpegBin, ['-i', filePath]);
      let stderr = '';
      proc.stderr?.on('data', (d) => {
        stderr += d.toString();
      });
      proc.on('close', () => {
        // Look for Duration: 00:00:12.34
        const match = stderr.match(/Duration:\s*(\d{2}):(\d{2}):(\d{2}\.\d+)/);
        if (match) {
          const hours = parseFloat(match[1]);
          const mins = parseFloat(match[2]);
          const secs = parseFloat(match[3]);
          resolve(hours * 3600 + mins * 60 + secs);
        } else {
          // Fallback estimate based on typical reading speed ~ 3 words per sec
          resolve(10.0);
        }
      });
      proc.on('error', () => resolve(10.0));
    });
  }

  private isElevenLabsConfigured(): boolean {
    return (
      env.TTS_PROVIDER === 'elevenlabs' &&
      env.ELEVENLABS_ENABLED === 'true' &&
      Boolean(env.ELEVENLABS_API_KEY) &&
      Boolean(env.ELEVENLABS_VOICE_ID)
    );
  }

  /** Splits text on sentence boundaries into pieces no longer than maxLen characters. */
  private splitForTts(text: string, maxLen = 2800): string[] {
    if (text.length <= maxLen) return [text];
    const sentences = text.match(/[^.!?।]+[.!?।]*\s*/g) || [text];
    const chunks: string[] = [];
    let current = '';
    for (const s of sentences) {
      if ((current + s).length > maxLen && current) {
        chunks.push(current.trim());
        current = '';
      }
      current += s;
    }
    if (current.trim()) chunks.push(current.trim());
    return chunks;
  }

  /**
   * Synthesizes the whole narration with ONE ElevenLabs voice. Short scripts go in a single
   * request (one continuous take); long scripts are split on sentence boundaries and every piece
   * uses the same voice and settings.
   */
  private async synthesizeWithElevenLabs(text: string): Promise<Buffer> {
    const chunks = this.splitForTts(text);
    const modelId = env.ELEVENLABS_MODEL_ID;
    const supportsContext = modelId !== 'eleven_v3';
    const buffers: Buffer[] = [];

    for (let i = 0; i < chunks.length; i++) {
      const body: Record<string, unknown> = {
        text: chunks[i],
        model_id: modelId,
        // Natural/steady delivery with the same timbre every time
        voice_settings: { stability: 0.5, similarity_boost: 0.8, style: 0.15, use_speaker_boost: true },
      };
      if (supportsContext && chunks.length > 1) {
        if (i > 0) body.previous_text = chunks[i - 1].slice(-300);
        if (i < chunks.length - 1) body.next_text = chunks[i + 1].slice(0, 300);
      }
      const res = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(env.ELEVENLABS_VOICE_ID)}?output_format=mp3_44100_128`,
        {
          method: 'POST',
          headers: { 'xi-api-key': env.ELEVENLABS_API_KEY, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(60000),
        }
      );
      if (!res.ok) {
        const detail = (await res.text().catch(() => '')).slice(0, 300);
        throw new Error(`ElevenLabs HTTP ${res.status}: ${detail}`);
      }
      buffers.push(Buffer.from(await res.arrayBuffer()));
    }
    return Buffer.concat(buffers);
  }

  /**
   * Generates a spoken voiceover audio MP3 from text
   */
  public async synthesizeSpeech(
    text: string,
    options?: { language?: string; slow?: boolean }
  ): Promise<VoiceoverResult> {
    const lang = options?.language === 'Hindi' ? 'hi' : 'en';
    const cleanText = text
      .replace(/[#*`_~]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    const tempDir = path.resolve(process.cwd(), 'storage', 'scratch');
    await fs.mkdir(tempDir, { recursive: true });
    const outputFilePath = path.join(tempDir, `voiceover_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.mp3`);

    try {
      let combinedBuffer: Buffer;
      if (this.isElevenLabsConfigured()) {
        // One fixed voice (ELEVENLABS_VOICE_ID) for the whole narration. We deliberately do NOT
        // fall back to another provider on failure: a different voice halfway through a reel is
        // worse than a clear error the user can retry.
        logger.info({ textLength: cleanText.length, voiceId: env.ELEVENLABS_VOICE_ID }, '[VOICEOVER] Synthesizing speech via ElevenLabs (fixed voice)');
        combinedBuffer = await this.synthesizeWithElevenLabs(cleanText);
      } else {
        logger.warn('[VOICEOVER] ElevenLabs is not configured; using the generic Google voice');
        const parts = await getAllAudioBase64(cleanText, {
          lang,
          slow: options?.slow ?? false,
          timeout: 10000,
          splitPunct: ',.?!;:',
        });
        combinedBuffer = Buffer.concat(parts.map((p) => Buffer.from(p.base64, 'base64')));
      }

      await fs.writeFile(outputFilePath, combinedBuffer);
      const durationSeconds = await this.getAudioDuration(outputFilePath);

      logger.info({ outputFilePath, durationSeconds }, '[VOICEOVER] Voiceover synthesis complete');
      return {
        filePath: outputFilePath,
        durationSeconds: Math.max(3.0, durationSeconds),
        buffer: combinedBuffer,
      };
    } catch (err) {
      logger.warn({ err }, '[VOICEOVER] Text-to-speech failed');
      await fs.rm(outputFilePath, { force: true }).catch(() => {});
      throw new AppError(
        502,
        'VOICEOVER_FAILED',
        'Voiceover generation failed: the text-to-speech service could not be reached. Please try again.',
        { providerMessage: err instanceof Error ? err.message : String(err) }
      );
    }
  }
}

export const voiceoverService = new VoiceoverService();
