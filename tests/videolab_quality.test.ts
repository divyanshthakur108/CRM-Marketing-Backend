import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fsp from 'fs/promises';
import path from 'path';
import {
  parseBlackdetect,
  parseFreezedetect,
  parseEbur128,
  checkDuration,
  checkCaptionSafeArea,
  calculatePlannedDuration,
  runQualityCheck,
} from '../src/modules/videolab/qualityCheck.js';
import type { EditRecipe } from '../src/modules/videolab/recipe.js';
import { runFfmpeg } from '../src/utils/ffmpeg.js';

describe('Video Lab Quality Check (R5)', () => {
  const baseRecipe: EditRecipe = {
    version: 3,
    variant: { index: 0, label: 'Variant A' },
    output: { width: 1080, height: 1920, fps: 30, maxSecondsPerClip: 30 },
    editing: 'smart',
    cuts: [
      { key: 'clip-1', start: 0, end: 5.0, cues: [{ start: 0.5, end: 4.5, text: 'Hello world' }] },
      { key: 'clip-2', start: 0, end: 5.0 },
    ],
    transitionSeconds: 0.4,
    captions: {
      language: 'en',
      style: 'POP',
      source: 'speech',
      lines: ['Hello world'],
    },
    watermark: { text: 'RealCRM' },
    endCard: {
      template: 'HERITAGE_LUXURY',
      seconds: 2.4,
      projectName: 'Green Heights',
      orgName: 'Luxury Living',
    },
  };

  describe('1. blackdetect parsing', () => {
    it('passes when no black screens are logged', () => {
      const stderr = `frame=  100 fps=0.0 q=-0.0 size=N/A time=00:00:04.00`;
      const res = parseBlackdetect(stderr, 4.0);
      expect(res.status).toBe('pass');
    });

    it('passes when black frame is <= 0.5s', () => {
      const stderr = `[blackdetect @ 0x123] black_start:1.0 black_end:1.4 black_duration:0.4`;
      const res = parseBlackdetect(stderr, 4.0);
      expect(res.status).toBe('pass');
    });

    it('ignores black frames in the first 0.1s and last 0.1s', () => {
      // 0.0 to 0.55 -> overlap with [0.1, 9.9] is [0.1, 0.55] = 0.45s <= 0.5s -> passes!
      const stderr = `[blackdetect @ 0x123] black_start:0.0 black_end:0.55 black_duration:0.55`;
      const res = parseBlackdetect(stderr, 10.0);
      expect(res.status).toBe('pass');
    });

    it('fails when black frame in the middle is > 0.5s', () => {
      const stderr = `[blackdetect @ 0x123] black_start:1.2 black_end:2.1 black_duration:0.9`;
      const res = parseBlackdetect(stderr, 5.0);
      expect(res.status).toBe('fail');
      expect(res.detail).toContain('0.90s at 1.20s–2.10s');
    });
  });

  describe('2. freezedetect parsing', () => {
    it('passes when no freeze is detected', () => {
      const stderr = `frame=  100 fps=0.0 q=-0.0 size=N/A time=00:00:05.00`;
      const res = parseFreezedetect(stderr, 5.0, 2.4);
      expect(res.status).toBe('pass');
    });

    it('passes when freeze is <= 2.0s', () => {
      const stderr = `lavfi.freezedetect.freeze_start: 1.0\nlavfi.freezedetect.freeze_end: 2.2`;
      const res = parseFreezedetect(stderr, 10.0, 2.4);
      expect(res.status).toBe('pass');
    });

    it('ignores freezes during the end card slide', () => {
      // Total duration 10s, end card 2.4s (starts at 7.6s). Freeze at 7.5s onwards should be ignored.
      const stderr = `lavfi.freezedetect.freeze_start: 7.5\nlavfi.freezedetect.freeze_end: 10.0`;
      const res = parseFreezedetect(stderr, 10.0, 2.4);
      expect(res.status).toBe('pass');
    });

    it('warns when freeze in main video exceeds 2.0s', () => {
      const stderr = `lavfi.freezedetect.freeze_start: 1.0\nlavfi.freezedetect.freeze_end: 3.5`;
      const res = parseFreezedetect(stderr, 10.0, 2.4);
      expect(res.status).toBe('warn');
      expect(res.detail).toContain('2.50s from 1.00s');
    });
  });

  describe('3. ebur128 audio levels parsing', () => {
    it('passes when loudness is close to -14 LUFS and true peak is safe', () => {
      const stderr = `
  Integrated loudness:
    I:         -14.2 LUFS
    Threshold: -24.3 LUFS

  True peak:
    Peak:        -1.5 dBFS
`;
      const res = parseEbur128(stderr, true);
      expect(res.status).toBe('pass');
      expect(res.detail).toContain('-14.2 LUFS');
    });

    it('fails when audio is silent but speech was expected in the recipe', () => {
      const stderr = `
  Integrated loudness:
    I:         -70.0 LUFS

  True peak:
    Peak:       -inf dBFS
`;
      const res = parseEbur128(stderr, true);
      expect(res.status).toBe('fail');
      expect(res.detail).toContain('completely silent');
    });

    it('passes when audio is silent but NO speech was expected', () => {
      const stderr = `
  Integrated loudness:
    I:         -70.0 LUFS

  True peak:
    Peak:       -inf dBFS
`;
      const res = parseEbur128(stderr, false);
      expect(res.status).toBe('pass');
    });

    it('fails when true peak exceeds -1.0 dBTP limit', () => {
      const stderr = `
  Integrated loudness:
    I:         -14.0 LUFS

  True peak:
    Peak:        -0.4 dBFS
`;
      const res = parseEbur128(stderr, true);
      expect(res.status).toBe('fail');
      expect(res.detail).toContain('exceeds safe limit');
    });

    it('warns when integrated loudness deviates by > 3.0 LUFS from target -14 LUFS', () => {
      const stderr = `
  Integrated loudness:
    I:         -19.5 LUFS

  True peak:
    Peak:        -3.0 dBFS
`;
      const res = parseEbur128(stderr, true);
      expect(res.status).toBe('warn');
      expect(res.detail).toContain('deviates from -14.0 LUFS target');
    });
  });

  describe('4. duration check & planned calculation', () => {
    it('calculates planned duration including cut crossfades and end card', () => {
      // 2 cuts of 5s each = 10s, minus 1 transition of 0.4s = 9.6s. End card = 2.4s - 0.3s crossfade = 2.1s -> total 11.7s
      const planned = calculatePlannedDuration(baseRecipe);
      expect(planned).toBe(11.7);
    });

    it('passes when actual duration is within 1.5s tolerance', () => {
      const res = checkDuration(11.8, baseRecipe);
      expect(res.status).toBe('pass');
    });

    it('warns when actual duration deviates by more than 1.5s', () => {
      const res = checkDuration(14.0, baseRecipe);
      expect(res.status).toBe('warn');
      expect(res.detail).toContain('deviates from planned');
    });
  });

  describe('5. caption safe area check', () => {
    it('passes when captions use safe vertical margin (420 >= 340)', () => {
      const res = checkCaptionSafeArea(baseRecipe);
      expect(res.status).toBe('pass');
      expect(res.detail).toContain('Caption safe area OK');
    });

    it('passes when no captions exist in recipe', () => {
      const noCaptionRecipe = { ...baseRecipe, captions: null };
      const res = checkCaptionSafeArea(noCaptionRecipe);
      expect(res.status).toBe('pass');
    });
  });

  describe('6. Real ffmpeg integration tests', () => {
    const testDir = path.resolve(process.cwd(), 'storage', 'scratch', 'test-qc');
    const blackVideoPath = path.join(testDir, 'black_fail.mp4');
    const cleanVideoPath = path.join(testDir, 'clean_pass.mp4');

    beforeAll(async () => {
      await fsp.mkdir(testDir, { recursive: true });

      // Generate a clip with 1.2s black section in the middle (0.5s red + 1.2s black + 0.8s blue = 2.5s)
      await runFfmpeg([
        '-hide_banner',
        '-loglevel', 'error',
        '-y',
        '-f', 'lavfi', '-i', 'color=c=red:s=320x240:d=0.5',
        '-f', 'lavfi', '-i', 'color=c=black:s=320x240:d=1.2',
        '-f', 'lavfi', '-i', 'color=c=blue:s=320x240:d=0.8',
        '-filter_complex', '[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]',
        '-map', '[v]',
        '-pix_fmt', 'yuv420p',
        blackVideoPath,
      ]);

      // Generate a clean 3s clip with motion and a 1kHz tone normalized to -14 LUFS
      await runFfmpeg([
        '-hide_banner',
        '-loglevel', 'error',
        '-y',
        '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=25:duration=3',
        '-f', 'lavfi', '-i', 'sine=frequency=1000:duration=3',
        '-filter_complex', '[1:a]loudnorm=I=-14:TP=-1.5:LRA=11[a]',
        '-map', '0:v',
        '-map', '[a]',
        '-pix_fmt', 'yuv420p',
        cleanVideoPath,
      ]);
    });

    afterAll(async () => {
      await fsp.rm(testDir, { recursive: true, force: true }).catch(() => undefined);
    });

    it('fails black screen check on video with 1.2s black section', async () => {
      const mockRecipe: EditRecipe = {
        ...baseRecipe,
        cuts: [{ key: 'k1', start: 0, end: 2.5 }],
        endCard: { ...baseRecipe.endCard, seconds: 0 },
        captions: null,
      };

      const result = await runQualityCheck(blackVideoPath, mockRecipe);
      expect(result.passed).toBe(false);
      expect(result.reviewReason).toContain('Black Screen Detection');
      const blackCheck = result.checks.find((c) => c.name === 'Black Screen Detection');
      expect(blackCheck?.status).toBe('fail');
    });

    it('passes all critical checks on normal clean video with audio', async () => {
      const mockRecipe: EditRecipe = {
        ...baseRecipe,
        cuts: [{ key: 'k1', start: 0, end: 3.0 }],
        endCard: { ...baseRecipe.endCard, seconds: 0 },
        captions: null,
      };

      const result = await runQualityCheck(cleanVideoPath, mockRecipe);
      expect(result.passed).toBe(true);
      const blackCheck = result.checks.find((c) => c.name === 'Black Screen Detection');
      expect(blackCheck?.status).toBe('pass');
      const audioCheck = result.checks.find((c) => c.name === 'Audio Loudness & Peak');
      expect(audioCheck?.status).toBe('pass');
    });
  });
});

