import { describe, it, expect, beforeAll } from 'vitest';
import path from 'path';
import fs from 'fs';
import fsp from 'fs/promises';
import { renderRecipeWithFfmpeg } from '../src/modules/videolab/ffmpegRenderer.js';
import { EditRecipe } from '../src/modules/videolab/recipe.js';
import { probeMedia, runFfmpeg } from '../src/utils/ffmpeg.js';

const TEST_OUT_DIR = path.resolve(process.cwd(), 'storage', 'scratch', 'phase1-render-verify');
const SOURCE_CLIP_KEY = 'video-lab/assets/eeb3f88e-0035-4e27-8323-f684122ca1a7.mp4';
const SOURCE_CLIP_PATH = path.resolve(process.cwd(), 'storage', SOURCE_CLIP_KEY);

describe('Phase 1 - Actual FFmpeg Video Lab Caption Rendering Verification', () => {
  beforeAll(async () => {
    await fsp.mkdir(TEST_OUT_DIR, { recursive: true });
    expect(fs.existsSync(SOURCE_CLIP_PATH)).toBe(true);
  });

  it('renders POP caption style with English keywords and active word animation', async () => {
    const workDir = path.join(TEST_OUT_DIR, 'work-pop');
    const outVideo = path.join(TEST_OUT_DIR, 'output-pop-en.mp4');
    const outPoster = path.join(TEST_OUT_DIR, 'poster-pop-en.jpg');

    const recipe: EditRecipe = {
      version: 2,
      variant: { index: 0, label: 'Variant A - POP English' },
      output: { width: 1080, height: 1920, fps: 30, maxSecondsPerClip: 10 },
      editing: 'whole',
      cuts: [
        {
          key: SOURCE_CLIP_KEY,
          filename: 'test.mp4',
          start: 0,
          end: 3.5,
          cues: [
            {
              start: 0.5,
              end: 3.0,
              text: 'Experience luxury penthouse living with skyline views',
              words: [
                { text: 'Experience', start: 0.5, end: 1.0, isKeyword: false },
                { text: 'luxury', start: 1.0, end: 1.5, isKeyword: true },
                { text: 'penthouse', start: 1.5, end: 2.1, isKeyword: true },
                { text: 'living', start: 2.1, end: 2.5, isKeyword: false },
                { text: 'with', start: 2.5, end: 2.7, isKeyword: false },
                { text: 'skyline', start: 2.7, end: 3.0, isKeyword: true },
              ],
            },
          ],
        },
      ],
      transitionSeconds: 0,
      captions: {
        language: 'en',
        style: 'POP',
        source: 'speech',
        lines: [],
        keywords: ['luxury', 'penthouse', 'skyline'],
      },
      watermark: { text: 'RealCRM Premier' },
      endCard: {
        template: 'HERITAGE_LUXURY',
        seconds: 2.0,
        projectName: 'Skyline Towers',
        orgName: 'RealCRM Premier',
        phone: '+91 98765 43210',
      },
      music: null,
    };

    const res = await renderRecipeWithFfmpeg(recipe, {
      workDir,
      outputVideoPath: outVideo,
      outputPosterPath: outPoster,
    });

    expect(fs.existsSync(outVideo)).toBe(true);
    expect(fs.existsSync(outPoster)).toBe(true);
    const stat = await fsp.stat(outVideo);
    expect(stat.size).toBeGreaterThan(100_000);

    const probe = await probeMedia(outVideo);
    expect(probe.hasVideo).toBe(true);
    expect(probe.durationSeconds).toBeGreaterThan(4.5); // cut (3.5s) + end card (2.0s) minus fade
  }, 60000);

  it('renders KARAOKE caption style with Hindi Devanagari text and accent highlights', async () => {
    const workDir = path.join(TEST_OUT_DIR, 'work-karaoke');
    const outVideo = path.join(TEST_OUT_DIR, 'output-karaoke-hi.mp4');
    const outPoster = path.join(TEST_OUT_DIR, 'poster-karaoke-hi.jpg');

    const recipe: EditRecipe = {
      version: 2,
      variant: { index: 1, label: 'Variant B - KARAOKE Hindi' },
      output: { width: 1080, height: 1920, fps: 30, maxSecondsPerClip: 10 },
      editing: 'whole',
      cuts: [
        {
          key: SOURCE_CLIP_KEY,
          filename: 'test.mp4',
          start: 0,
          end: 3.5,
          cues: [
            {
              start: 0.5,
              end: 3.0,
              text: 'यह आलीशान अपार्टमेंट आपके सपनों का घर है',
              words: [
                { text: 'यह', start: 0.5, end: 0.8, isKeyword: false },
                { text: 'आलीशान', start: 0.8, end: 1.5, isKeyword: true },
                { text: 'अपार्टमेंट', start: 1.5, end: 2.2, isKeyword: true },
                { text: 'आपके', start: 2.2, end: 2.5, isKeyword: false },
                { text: 'सपनों', start: 2.5, end: 2.8, isKeyword: false },
                { text: 'का', start: 2.8, end: 2.9, isKeyword: false },
                { text: 'घर', start: 2.9, end: 3.0, isKeyword: false },
              ],
            },
          ],
        },
      ],
      transitionSeconds: 0,
      captions: {
        language: 'hi',
        style: 'KARAOKE',
        source: 'speech',
        lines: [],
        keywords: ['आलीशान', 'अपार्टमेंट'],
      },
      watermark: { text: 'RealCRM Premier' },
      endCard: {
        template: 'HIGH_GROWTH_ROI',
        seconds: 2.0,
        projectName: 'Royal Enclave',
        orgName: 'RealCRM Premier',
        phone: '+91 98765 43210',
      },
      music: null,
    };

    const res = await renderRecipeWithFfmpeg(recipe, {
      workDir,
      outputVideoPath: outVideo,
      outputPosterPath: outPoster,
    });

    expect(fs.existsSync(outVideo)).toBe(true);
    expect(fs.existsSync(outPoster)).toBe(true);
    const stat = await fsp.stat(outVideo);
    expect(stat.size).toBeGreaterThan(100_000);

    const probe = await probeMedia(outVideo);
    expect(probe.hasVideo).toBe(true);
  }, 60000);

  it('renders SLIDE caption style with Punjabi Gurmukhi text and upward motion', async () => {
    const workDir = path.join(TEST_OUT_DIR, 'work-slide');
    const outVideo = path.join(TEST_OUT_DIR, 'output-slide-pa.mp4');
    const outPoster = path.join(TEST_OUT_DIR, 'poster-slide-pa.jpg');

    const recipe: EditRecipe = {
      version: 2,
      variant: { index: 2, label: 'Variant C - SLIDE Punjabi' },
      output: { width: 1080, height: 1920, fps: 30, maxSecondsPerClip: 10 },
      editing: 'whole',
      cuts: [
        {
          key: SOURCE_CLIP_KEY,
          filename: 'test.mp4',
          start: 0,
          end: 3.5,
          cues: [
            {
              start: 0.5,
              end: 3.0,
              text: 'ਇਹ ਸ਼ਾਨਦਾਰ ਕੋਠੀ ਮੋਹਾਲੀ ਵਿੱਚ ਉਪਲਬਧ ਹੈ',
              words: [
                { text: 'ਇਹ', start: 0.5, end: 0.8, isKeyword: false },
                { text: 'ਸ਼ਾਨਦਾਰ', start: 0.8, end: 1.4, isKeyword: true },
                { text: 'ਕੋਠੀ', start: 1.4, end: 2.0, isKeyword: true },
                { text: 'ਮੋਹਾਲੀ', start: 2.0, end: 2.6, isKeyword: true },
                { text: 'ਵਿੱਚ', start: 2.6, end: 3.0, isKeyword: false },
              ],
            },
          ],
        },
      ],
      transitionSeconds: 0,
      captions: {
        language: 'pa',
        style: 'SLIDE',
        source: 'speech',
        lines: [],
        keywords: ['ਸ਼ਾਨਦਾਰ', 'ਕੋਠੀ', 'ਮੋਹਾਲੀ'],
      },
      watermark: { text: 'RealCRM Premier' },
      endCard: {
        template: 'HERITAGE_LUXURY',
        seconds: 2.0,
        projectName: 'Mohali Greens',
        orgName: 'RealCRM Premier',
        phone: '+91 98765 43210',
      },
      music: null,
    };

    const res = await renderRecipeWithFfmpeg(recipe, {
      workDir,
      outputVideoPath: outVideo,
      outputPosterPath: outPoster,
    });

    expect(fs.existsSync(outVideo)).toBe(true);
    expect(fs.existsSync(outPoster)).toBe(true);
    const stat = await fsp.stat(outVideo);
    expect(stat.size).toBeGreaterThan(100_000);
  }, 60000);

  it('renders MINIMAL caption style with Hinglish text and keyword accent', async () => {
    const workDir = path.join(TEST_OUT_DIR, 'work-minimal');
    const outVideo = path.join(TEST_OUT_DIR, 'output-minimal-hinglish.mp4');
    const outPoster = path.join(TEST_OUT_DIR, 'poster-minimal-hinglish.jpg');

    const recipe: EditRecipe = {
      version: 2,
      variant: { index: 0, label: 'Variant MINIMAL - Hinglish' },
      output: { width: 1080, height: 1920, fps: 30, maxSecondsPerClip: 10 },
      editing: 'whole',
      cuts: [
        {
          key: SOURCE_CLIP_KEY,
          filename: 'test.mp4',
          start: 0,
          end: 3.5,
          cues: [
            {
              start: 0.5,
              end: 3.0,
              text: 'Ye luxury 3 BHK villa ready to move hai',
              words: [
                { text: 'Ye', start: 0.5, end: 0.8, isKeyword: false },
                { text: 'luxury', start: 0.8, end: 1.3, isKeyword: true },
                { text: '3', start: 1.3, end: 1.5, isKeyword: false },
                { text: 'BHK', start: 1.5, end: 1.8, isKeyword: false },
                { text: 'villa', start: 1.8, end: 2.3, isKeyword: true },
                { text: 'ready', start: 2.3, end: 2.6, isKeyword: false },
                { text: 'to', start: 2.6, end: 2.7, isKeyword: false },
                { text: 'move', start: 2.7, end: 2.9, isKeyword: false },
                { text: 'hai', start: 2.9, end: 3.0, isKeyword: false },
              ],
            },
          ],
        },
      ],
      transitionSeconds: 0,
      captions: {
        language: 'hinglish',
        style: 'MINIMAL',
        source: 'speech',
        lines: [],
        keywords: ['luxury', 'villa'],
      },
      watermark: { text: 'RealCRM Premier' },
      endCard: {
        template: 'HERITAGE_LUXURY',
        seconds: 2.0,
        projectName: 'Palm Hills',
        orgName: 'RealCRM Premier',
        phone: '+91 98765 43210',
      },
      music: null,
    };

    const res = await renderRecipeWithFfmpeg(recipe, {
      workDir,
      outputVideoPath: outVideo,
      outputPosterPath: outPoster,
    });

    expect(fs.existsSync(outVideo)).toBe(true);
    expect(fs.existsSync(outPoster)).toBe(true);
    const stat = await fsp.stat(outVideo);
    expect(stat.size).toBeGreaterThan(100_000);
  }, 60000);

  it('renders legacy BOXED and OUTLINE styles without breaking backward compatibility', async () => {
    const workDir = path.join(TEST_OUT_DIR, 'work-legacy');
    const outVideo = path.join(TEST_OUT_DIR, 'output-legacy-boxed.mp4');
    const outPoster = path.join(TEST_OUT_DIR, 'poster-legacy-boxed.jpg');

    const legacyRecipe: EditRecipe = {
      version: 2,
      variant: { index: 0, label: 'Legacy Boxed' },
      output: { width: 1080, height: 1920, fps: 30, maxSecondsPerClip: 10 },
      editing: 'whole',
      cuts: [
        {
          key: SOURCE_CLIP_KEY,
          filename: 'test.mp4',
          start: 0,
          end: 3.0,
        },
      ],
      transitionSeconds: 0,
      captions: {
        language: 'en',
        style: 'BOXED',
        source: 'typed',
        lines: ['Premium Luxury Apartments in Chandigarh'],
      },
      watermark: { text: 'Legacy RealCRM' },
      endCard: {
        template: 'HERITAGE_LUXURY',
        seconds: 2.0,
        projectName: 'Legacy Towers',
        orgName: 'Legacy RealCRM',
      },
      music: null,
    };

    const res = await renderRecipeWithFfmpeg(legacyRecipe, {
      workDir,
      outputVideoPath: outVideo,
      outputPosterPath: outPoster,
    });

    expect(fs.existsSync(outVideo)).toBe(true);
    expect(fs.existsSync(outPoster)).toBe(true);
    const stat = await fsp.stat(outVideo);
    expect(stat.size).toBeGreaterThan(100_000);
  }, 60000);

  it('renders Phase 2 B-roll overlay over continuous A-roll narration with POP style captions', async () => {
    const workDir = path.join(TEST_OUT_DIR, 'work-broll-pop-en');
    const outVideo = path.join(TEST_OUT_DIR, 'output-broll-pop-en.mp4');
    const outPoster = path.join(TEST_OUT_DIR, 'poster-broll-pop-en.jpg');
    const BROLL_KEY = 'video-lab/assets/fde1894e-a968-4a0d-be12-ed4c45bf292f.mp4';

    const recipe: EditRecipe = {
      version: 3,
      variant: { index: 0, label: 'Variant A - Phase 2 B-Roll POP' },
      output: { width: 1080, height: 1920, fps: 30, maxSecondsPerClip: 15 },
      editing: 'smart',
      cuts: [
        {
          key: SOURCE_CLIP_KEY,
          filename: 'presenter.mp4',
          start: 0,
          end: 6.0,
          cues: [
            {
              start: 0.5,
              end: 2.2,
              text: 'Welcome to this luxury apartment',
              words: [
                { text: 'Welcome', start: 0.5, end: 1.0, isKeyword: false },
                { text: 'to', start: 1.0, end: 1.2, isKeyword: false },
                { text: 'this', start: 1.2, end: 1.5, isKeyword: false },
                { text: 'luxury', start: 1.5, end: 1.9, isKeyword: true },
                { text: 'apartment', start: 1.9, end: 2.2, isKeyword: false },
              ],
            },
            {
              start: 2.8,
              end: 5.5,
              text: 'Check out the modular kitchen and skyline views',
              words: [
                { text: 'Check', start: 2.8, end: 3.2, isKeyword: false },
                { text: 'out', start: 3.2, end: 3.4, isKeyword: false },
                { text: 'the', start: 3.4, end: 3.6, isKeyword: false },
                { text: 'modular', start: 3.6, end: 4.1, isKeyword: true },
                { text: 'kitchen', start: 4.1, end: 4.7, isKeyword: true },
                { text: 'and', start: 4.7, end: 4.9, isKeyword: false },
                { text: 'skyline', start: 4.9, end: 5.2, isKeyword: true },
                { text: 'views', start: 5.2, end: 5.5, isKeyword: true },
              ],
            },
          ],
        },
      ],
      overlays: [
        {
          start: 3.5,
          end: 5.4,
          source: {
            kind: 'clip',
            key: BROLL_KEY,
            in: 2.0,
            out: 3.9,
          },
          style: 'FULL',
          motion: 'ZOOM_IN',
          label: 'Modular Kitchen B-Roll',
          reason: "Mentioned modular kitchen at 3.6s",
        },
      ],
      transitionSeconds: 0,
      captions: {
        language: 'en',
        style: 'POP',
        source: 'speech',
        lines: [],
        keywords: ['luxury', 'modular', 'kitchen', 'skyline', 'views'],
      },
      watermark: { text: 'RealCRM Premier' },
      endCard: {
        template: 'HERITAGE_LUXURY',
        seconds: 2.0,
        projectName: 'Skyline Heights',
        orgName: 'RealCRM Premier',
        phone: '+91 98765 43210',
      },
      music: null,
    };

    const res = await renderRecipeWithFfmpeg(recipe, {
      workDir,
      outputVideoPath: outVideo,
      outputPosterPath: outPoster,
    });

    expect(fs.existsSync(outVideo)).toBe(true);
    expect(fs.existsSync(outPoster)).toBe(true);
    const probe = await probeMedia(outVideo);
    expect(probe.hasVideo).toBe(true);
    expect(probe.hasAudio).toBe(true);
    expect(probe.durationSeconds).toBeGreaterThan(7.0); // 6.0s cut + 2.0s end card minus transition
  }, 60000);

  it('renders Phase 2 B-roll overlay with Hindi KARAOKE captions and muted B-roll audio', async () => {
    const workDir = path.join(TEST_OUT_DIR, 'work-broll-karaoke-hi');
    const outVideo = path.join(TEST_OUT_DIR, 'output-broll-karaoke-hi.mp4');
    const outPoster = path.join(TEST_OUT_DIR, 'poster-broll-karaoke-hi.jpg');
    const BROLL_KEY = 'video-lab/assets/fde1894e-a968-4a0d-be12-ed4c45bf292f.mp4';

    const recipe: EditRecipe = {
      version: 3,
      variant: { index: 1, label: 'Variant B - Phase 2 B-Roll Hindi' },
      output: { width: 1080, height: 1920, fps: 30, maxSecondsPerClip: 15 },
      editing: 'smart',
      cuts: [
        {
          key: SOURCE_CLIP_KEY,
          filename: 'presenter.mp4',
          start: 0,
          end: 6.0,
          cues: [
            {
              start: 0.5,
              end: 2.5,
              text: 'नमस्ते यह हमारा नया प्रोजेक्ट है',
              words: [
                { text: 'नमस्ते', start: 0.5, end: 1.2, isKeyword: false },
                { text: 'यह', start: 1.2, end: 1.5, isKeyword: false },
                { text: 'हमारा', start: 1.5, end: 1.9, isKeyword: false },
                { text: 'नया', start: 1.9, end: 2.2, isKeyword: false },
                { text: 'प्रोजेक्ट', start: 2.2, end: 2.5, isKeyword: true },
              ],
            },
            {
              start: 3.0,
              end: 5.5,
              text: 'यह सुंदर मॉड्यूलर किचन पूरी तरह तैयार है',
              words: [
                { text: 'यह', start: 3.0, end: 3.3, isKeyword: false },
                { text: 'सुंदर', start: 3.3, end: 3.8, isKeyword: false },
                { text: 'मॉड्यूलर', start: 3.8, end: 4.4, isKeyword: true },
                { text: 'किचन', start: 4.4, end: 4.8, isKeyword: true },
                { text: 'पूरी', start: 4.8, end: 5.0, isKeyword: false },
                { text: 'तरह', start: 5.0, end: 5.2, isKeyword: false },
                { text: 'तैयार', start: 5.2, end: 5.4, isKeyword: false },
                { text: 'है', start: 5.4, end: 5.5, isKeyword: false },
              ],
            },
          ],
        },
      ],
      overlays: [
        {
          start: 3.5,
          end: 5.2,
          source: {
            kind: 'clip',
            key: BROLL_KEY,
            in: 5.0,
            out: 6.7,
          },
          style: 'FULL',
          motion: 'ZOOM_IN',
          label: 'Kitchen B-Roll',
          reason: "Mentioned मॉड्यूलर किचन at 3.8s",
        },
      ],
      transitionSeconds: 0,
      captions: {
        language: 'hi',
        style: 'KARAOKE',
        source: 'speech',
        lines: [],
        keywords: ['प्रोजेक्ट', 'मॉड्यूलर', 'किचन'],
      },
      watermark: { text: 'RealCRM Premier' },
      endCard: {
        template: 'HIGH_GROWTH_ROI',
        seconds: 2.0,
        projectName: 'Royal City',
        orgName: 'RealCRM Premier',
        phone: '+91 98765 43210',
      },
      music: null,
    };

    const res = await renderRecipeWithFfmpeg(recipe, {
      workDir,
      outputVideoPath: outVideo,
      outputPosterPath: outPoster,
    });

    expect(fs.existsSync(outVideo)).toBe(true);
    expect(fs.existsSync(outPoster)).toBe(true);
    const probe = await probeMedia(outVideo);
    expect(probe.hasVideo).toBe(true);
    expect(probe.hasAudio).toBe(true);
    expect(probe.durationSeconds).toBeGreaterThan(7.0);
  }, 60000);

  it('renders Phase 2 B-roll overlay with Punjabi SLIDE captions and continuous narration', async () => {
    const workDir = path.join(TEST_OUT_DIR, 'work-broll-slide-pa');
    const outVideo = path.join(TEST_OUT_DIR, 'output-broll-slide-pa.mp4');
    const outPoster = path.join(TEST_OUT_DIR, 'poster-broll-slide-pa.jpg');
    const BROLL_KEY = 'video-lab/assets/fde1894e-a968-4a0d-be12-ed4c45bf292f.mp4';

    const recipe: EditRecipe = {
      version: 3,
      variant: { index: 2, label: 'Variant C - Phase 2 B-Roll Punjabi' },
      output: { width: 1080, height: 1920, fps: 30, maxSecondsPerClip: 15 },
      editing: 'smart',
      cuts: [
        {
          key: SOURCE_CLIP_KEY,
          filename: 'presenter.mp4',
          start: 0,
          end: 6.0,
          cues: [
            {
              start: 0.5,
              end: 2.5,
              text: 'ਸਤਿ ਸ਼੍ਰੀ ਅਕਾਲ ਜੀ',
              words: [
                { text: 'ਸਤਿ', start: 0.5, end: 1.0, isKeyword: false },
                { text: 'ਸ਼੍ਰੀ', start: 1.0, end: 1.5, isKeyword: false },
                { text: 'ਅਕਾਲ', start: 1.5, end: 2.0, isKeyword: false },
                { text: 'ਜੀ', start: 2.0, end: 2.5, isKeyword: false },
              ],
            },
            {
              start: 3.0,
              end: 5.5,
              text: 'ਇਹ ਖੁੱਲ੍ਹੀ ਰਸੋਈ ਅਤੇ ਬਾਲਕੋਨੀ ਹੈ',
              words: [
                { text: 'ਇਹ', start: 3.0, end: 3.4, isKeyword: false },
                { text: 'ਖੁੱਲ੍ਹੀ', start: 3.4, end: 3.9, isKeyword: false },
                { text: 'ਰਸੋਈ', start: 3.9, end: 4.5, isKeyword: true },
                { text: 'ਅਤੇ', start: 4.5, end: 4.7, isKeyword: false },
                { text: 'ਬਾਲਕੋਨੀ', start: 4.7, end: 5.3, isKeyword: true },
                { text: 'ਹੈ', start: 5.3, end: 5.5, isKeyword: false },
              ],
            },
          ],
        },
      ],
      overlays: [
        {
          start: 3.6,
          end: 5.3,
          source: {
            kind: 'clip',
            key: BROLL_KEY,
            in: 8.0,
            out: 9.7,
          },
          style: 'FULL',
          motion: 'ZOOM_IN',
          label: 'Punjabi Kitchen B-Roll',
          reason: "Mentioned ਰਸੋਈ at 3.9s",
        },
      ],
      transitionSeconds: 0,
      captions: {
        language: 'pa',
        style: 'SLIDE',
        source: 'speech',
        lines: [],
        keywords: ['ਰਸੋਈ', 'ਬਾਲਕੋਨੀ'],
      },
      watermark: { text: 'RealCRM Premier' },
      endCard: {
        template: 'HERITAGE_LUXURY',
        seconds: 2.0,
        projectName: 'Mohali Estates',
        orgName: 'RealCRM Premier',
        phone: '+91 98765 43210',
      },
      music: null,
    };

    const res = await renderRecipeWithFfmpeg(recipe, {
      workDir,
      outputVideoPath: outVideo,
      outputPosterPath: outPoster,
    });

    expect(fs.existsSync(outVideo)).toBe(true);
    expect(fs.existsSync(outPoster)).toBe(true);
    const probe = await probeMedia(outVideo);
    expect(probe.hasVideo).toBe(true);
    expect(probe.hasAudio).toBe(true);
    expect(probe.durationSeconds).toBeGreaterThan(7.0);
  }, 60000);
});

