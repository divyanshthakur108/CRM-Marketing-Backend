import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { getAllAudioBase64 } from 'google-tts-api';
import { logger } from '../../config/logger.js';

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
      const proc = spawn(ffmpegBin, ['-i', filePath]);
      let stderr = '';
      proc.stderr.on('data', (d) => {
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
      logger.info({ textLength: cleanText.length, lang }, '[VOICEOVER] Synthesizing speech via TTS API');
      const parts = await getAllAudioBase64(cleanText, {
        lang,
        slow: options?.slow ?? false,
        timeout: 10000,
        splitPunct: ',.?!;:',
      });

      const buffers: Buffer[] = parts.map((p) => Buffer.from(p.base64, 'base64'));
      const combinedBuffer = Buffer.concat(buffers);

      await fs.writeFile(outputFilePath, combinedBuffer);
      const durationSeconds = await this.getAudioDuration(outputFilePath);

      logger.info({ outputFilePath, durationSeconds }, '[VOICEOVER] Voiceover synthesis complete');
      return {
        filePath: outputFilePath,
        durationSeconds: Math.max(3.0, durationSeconds),
        buffer: combinedBuffer,
      };
    } catch (err) {
      logger.warn({ err }, '[VOICEOVER] Failed to synthesize live TTS audio, creating fallback audio');
      // Create a 5-second silence/fallback audio buffer
      const durationSeconds = 8.0;
      await this.createFallbackAudio(outputFilePath, durationSeconds);
      const buffer = await fs.readFile(outputFilePath).catch(() => Buffer.alloc(0));

      return {
        filePath: outputFilePath,
        durationSeconds,
        buffer,
      };
    }
  }

  /**
   * Generates silent audio with ffmpeg if network is unavailable
   */
  private async createFallbackAudio(outputPath: string, durationSec: number): Promise<void> {
    const ffmpegBin = this.resolveFfmpegBinary();
    return new Promise((resolve) => {
      const proc = spawn(ffmpegBin, [
        '-f',
        'lavfi',
        '-i',
        'anullsrc=r=44100:cl=stereo',
        '-t',
        durationSec.toString(),
        '-q:a',
        '9',
        '-acodec',
        'libmp3lame',
        '-y',
        outputPath,
      ]);
      proc.on('close', () => resolve());
      proc.on('error', () => resolve());
    });
  }
}

export const voiceoverService = new VoiceoverService();
