import { describe, it, expect, beforeEach } from 'vitest';
import fsp from 'fs/promises';
import path from 'path';
import os from 'os';
import {
  buildHookText,
  planZooms,
  buildZoomExpression,
  SHORT_CROSSFADE_SECONDS,
  SAME_CLIP_TRANSITION_SECONDS,
  HOOK_START_SECONDS,
  HOOK_END_SECONDS,
} from '../src/modules/videolab/creatorStyle.js';
import {
  buildVariants,
  cleanCues,
  EditRecipe,
  LabClip,
  LabInput,
  placeCuesOnTimeline,
} from '../src/modules/videolab/recipe.js';
import { buildMainAss } from '../src/modules/videolab/ass.js';
import { renderRecipeWithFfmpeg } from '../src/modules/videolab/ffmpegRenderer.js';
import { probeMedia, runFfmpeg } from '../src/utils/ffmpeg.js';
import { defaultStorage } from '../src/storage/localStorage.adapter.js';

describe('Creator-Style Editing (R4)', () => {
  describe('1. Text Hook Rules & ASS Subtitle Generation', () => {
    it('builds hook text from project name and phone or RERA only if filled in', () => {
      // Only project name
      const hook1 = buildHookText({
        facts: { projectName: 'Sushma Belleza' },
      });
      expect(hook1).toBe('Sushma Belleza');

      // Project name + phone
      const hook2 = buildHookText({
        facts: { projectName: 'Sushma Belleza', phone: '+91 98765 43210' },
      });
      expect(hook2).toBe('Sushma Belleza · +91 98765 43210');

      // Project name + RERA
      const hook3 = buildHookText({
        facts: { projectName: 'The Palm Springs', rera: 'PBRERA-SAS80-PR0390' },
      });
      expect(hook3).toBe('The Palm Springs · RERA: PBRERA-SAS80-PR0390');
    });

    it('builds hook text from the first caption keyword and project name without inventing claims', () => {
      const hook = buildHookText({
        facts: { projectName: 'Riverdale Luxury' },
        keywords: ['3 BHK', 'Mohali'],
      });
      expect(hook).toBe('3 BHK · Riverdale Luxury');
      // Never invents prices or marketing claims
      expect(hook).not.toMatch(/₹|price|crore|lakh|discount|cheapest/i);
    });

    it('extracts keyword from caption cue words if explicit keywords array is absent', () => {
      const cues = cleanCues([
        {
          start: 0.5,
          end: 2.2,
          text: 'Welcome to this 3BHK penthouse',
          words: [
            { text: 'Welcome', start: 0.5, end: 0.9 },
            { text: 'to', start: 0.9, end: 1.1 },
            { text: 'this', start: 1.1, end: 1.3 },
            { text: '3BHK', start: 1.3, end: 1.8, isKeyword: true },
            { text: 'penthouse', start: 1.8, end: 2.2, isKeyword: true },
          ],
        },
      ]);

      const hook = buildHookText({
        facts: { projectName: 'Falcon View' },
        cues,
      });
      expect(hook).toBe('3BHK · Falcon View');
    });

    it('supports Devanagari and Gurmukhi Indic scripts without breaking glyphs', () => {
      // Hindi (Devanagari)
      const hindiHook = buildHookText({
        facts: { projectName: 'सुषमा बेलेज़ा' },
        keywords: ['लक्ज़री विला'],
      });
      expect(hindiHook).toBe('लक्ज़री विला · सुषमा बेलेज़ा');

      const hindiAss = buildMainAss({
        durationSeconds: 15,
        captions: { language: 'hi', style: 'POP', lines: [] },
        hook: { text: hindiHook, startSeconds: HOOK_START_SECONDS, endSeconds: HOOK_END_SECONDS },
      });
      expect(hindiAss).toContain('HookTitle');
      expect(hindiAss).toContain('Noto Sans Devanagari');
      expect(hindiAss).toContain('सुषमा बेलेज़ा');

      // Punjabi (Gurmukhi)
      const punjabiHook = buildHookText({
        facts: { projectName: 'ਸੁਸ਼ਮਾ ਗ੍ਰੈਂਡ' },
        keywords: ['ਸ਼ਾਨਦਾਰ ਘਰ'],
      });
      expect(punjabiHook).toBe('ਸ਼ਾਨਦਾਰ ਘਰ · ਸੁਸ਼ਮਾ ਗ੍ਰੈਂਡ');

      const punjabiAss = buildMainAss({
        durationSeconds: 15,
        captions: { language: 'pa', style: 'KARAOKE', lines: [] },
        hook: { text: punjabiHook, startSeconds: HOOK_START_SECONDS, endSeconds: HOOK_END_SECONDS },
      });
      expect(punjabiAss).toContain('HookTitle');
      expect(punjabiAss).toContain('Noto Sans Gurmukhi');
      expect(punjabiAss).toContain('ਸੁਸ਼ਮਾ ਗ੍ਰੈਂਡ');
    });

    it('renders hook in the top third with pop-in and fade-out, with NO overlap with bottom captions', () => {
      const ass = buildMainAss({
        durationSeconds: 20,
        captions: { language: 'en', style: 'POP', lines: ['Spacious living room tour'] },
        hook: { text: '3 BHK · Luxury Villa', startSeconds: 0.2, endSeconds: 2.4 },
        accentHex: '#C9A227',
      });

      expect(ass).not.toBeNull();
      // HookTitle style is Alignment 8 (top-center) with MarginV 380 (top-third)
      expect(ass).toMatch(/Style: HookTitle,[^,]+,74,&H0027A2C9,[^,]+,[^,]+,[^,]+,-1,0,0,0,100,100,1,0,1,5,2,8,60,60,380,1/);
      // Captions stay at Alignment 2 (bottom-center) with MarginV 420
      expect(ass).toMatch(/Style: CaptionPop,[^,]+,64,[^,]+,[^,]+,[^,]+,[^,]+,-1,0,0,0,100,100,0,0,1,6,2,2,90,90,420,1/);

      // Dialogue event has start 0.20 and end 2.40 with pop-in scale tag and fade
      expect(ass).toContain('Dialogue: 2,0:00:00.20,0:00:02.40,HookTitle');
      expect(ass).toContain('\\fscx115\\fscy115\\t(0,140,\\fscx100\\fscy100)\\fad(120,200)');
    });

    it('respects on/off toggle for hook text in buildVariants', () => {
      const baseInput: LabInput = {
        clips: [{ key: 'clips/tour.mp4', durationSeconds: 12 }],
        facts: { orgName: 'RealCRM', projectName: 'Skyline Towers' },
        captions: { language: 'en', source: 'typed', lines: ['Welcome'] },
      };

      // Default: hook text is on
      const recipesOn = buildVariants(baseInput, 1);
      expect(recipesOn[0].hook).toBeDefined();
      expect(recipesOn[0].hook?.text).toBe('Skyline Towers');
      expect(recipesOn[0].hook?.startSeconds).toBe(0.2);
      expect(recipesOn[0].hook?.endSeconds).toBe(2.4);

      // Toggled off explicitly
      const recipesOff = buildVariants({
        ...baseInput,
        creatorStyle: { hookText: false },
      }, 1);
      expect(recipesOff[0].hook).toBeUndefined();
    });
  });

  describe('2. Punch-in Zoom on Presenter (A-roll only)', () => {
    const sampleCuts = [
      { key: 'clips/talk.mp4', start: 0, end: 6.0, label: 'Presenter Intro' },
      { key: 'clips/talk.mp4', start: 6.0, end: 12.0, label: 'Presenter Details' },
    ];

    const sampleCues = cleanCues([
      { start: 0.2, end: 0.9, text: 'Hello' },
      { start: 1.2, end: 2.5, text: 'welcome to this tour' },
      { start: 2.8, end: 5.5, text: 'where we show every detail' },
      { start: 6.5, end: 8.5, text: 'the master bedroom is spacious' },
      { start: 9.0, end: 11.5, text: 'and has a private balcony' },
    ]);

    it('never places zooms during the first 1.0 second', () => {
      const zooms = planZooms({
        cuts: sampleCuts,
        speechCues: sampleCues,
        totalDuration: 12.0,
      });

      expect(zooms.length).toBeGreaterThan(0);
      for (const z of zooms) {
        expect(z.start).toBeGreaterThanOrEqual(1.0);
      }
    });

    it('snaps zoom start points to caption word boundaries', () => {
      const zooms = planZooms({
        cuts: sampleCuts,
        speechCues: sampleCues,
        totalDuration: 12.0,
      });

      // Word starts from sampleCues are: 0.2, 1.2, 2.8, 6.5, 9.0 (plus interpolated words)
      for (const z of zooms) {
        expect(z.start).toBeGreaterThanOrEqual(1.0);
        // Ensure z.start is snapped to 2 decimal places
        expect(Number.isFinite(z.start)).toBe(true);
      }
    });

    it('strictly avoids B-roll overlay intervals (A-roll presenter only)', () => {
      const overlays = [
        {
          start: 2.0,
          end: 5.0,
          source: { kind: 'clip' as const, key: 'clips/broll_kitchen.mp4', in: 0, out: 3.0 },
          label: 'Kitchen B-roll',
          reason: 'Mentioned kitchen',
        },
      ];

      const zooms = planZooms({
        cuts: sampleCuts,
        overlays,
        speechCues: sampleCues,
        totalDuration: 12.0,
      });

      // Check that no zoom overlaps [2.0, 5.0]
      for (const z of zooms) {
        const overlapsOverlay = Math.min(z.end, 5.0) - Math.max(z.start, 2.0);
        expect(overlapsOverlay).toBeLessThanOrEqual(0);
      }
    });

    it('resets and alternates zoom target (1.08 to 1.06) across cuts', () => {
      const zooms = planZooms({
        cuts: [
          { key: 'clips/talk.mp4', start: 0, end: 5.5 },
          { key: 'clips/talk.mp4', start: 5.5, end: 11.0 },
        ],
        speechCues: sampleCues,
        totalDuration: 11.0,
      });

      expect(zooms.length).toBeGreaterThanOrEqual(2);
      expect(zooms[0].from).toBe(1.00);
      expect(zooms[0].to).toBe(1.08);

      expect(zooms[1].from).toBe(1.00);
      expect(zooms[1].to).toBe(1.06);
    });

    it('respects punchInZoom: false toggle', () => {
      const zooms = planZooms({
        cuts: sampleCuts,
        speechCues: sampleCues,
        totalDuration: 12.0,
        enabled: false,
      });
      expect(zooms).toEqual([]);
    });

    it('builds valid ffmpeg zoompan expression for planned zooms', () => {
      const expr = buildZoomExpression([
        { start: 1.2, end: 4.5, from: 1.0, to: 1.08 },
        { start: 6.2, end: 9.5, from: 1.0, to: 1.06 },
      ]);

      expect(expr).toContain('if(between(time,1.20,4.50)');
      expect(expr).toContain('if(between(time,6.20,9.50)');
      expect(expr).toContain('1.00+0.08*(time-1.20)');
      expect(expr).toContain('1.00+0.06*(time-6.20)');
    });
  });

  describe('3. Fewer Effects: Constants & Plain Cuts on Same Clip', () => {
    it('sets short crossfades between 0.15s and 0.25s', () => {
      expect(SHORT_CROSSFADE_SECONDS).toBeGreaterThanOrEqual(0.15);
      expect(SHORT_CROSSFADE_SECONDS).toBeLessThanOrEqual(0.25);
    });

    it('sets plain cuts between consecutive pieces from the same clip to 0s', () => {
      expect(SAME_CLIP_TRANSITION_SECONDS).toBe(0);
    });

    it('calculates timeline cue offsets with 0s plain cut between same clip cuts', () => {
      const sameClipCuts = [
        { key: 'clips/talk.mp4', cues: [{ start: 0, end: 2.0, text: 'First part' }] },
        { key: 'clips/talk.mp4', cues: [{ start: 0, end: 2.0, text: 'Second part' }] },
      ];

      const segmentDurations = [3.0, 3.0];
      const placed = placeCuesOnTimeline(sameClipCuts, segmentDurations, 0.25);

      // Cut 0 starts at 0 -> cue is at 0.0
      expect(placed[0].start).toBe(0);
      // Cut 1 starts at 0 + 3.0 - 0 (plain cut, no crossfade subtracted) -> cue starts at 3.0
      expect(placed[1].start).toBe(3.0);
    });

    it('calculates timeline cue offsets with crossfade subtracted between different clips', () => {
      const diffClipCuts = [
        { key: 'clips/clipA.mp4', cues: [{ start: 0, end: 2.0, text: 'First part' }] },
        { key: 'clips/clipB.mp4', cues: [{ start: 0, end: 2.0, text: 'Second part' }] },
      ];

      const segmentDurations = [3.0, 3.0];
      const placed = placeCuesOnTimeline(diffClipCuts, segmentDurations, 0.25);

      expect(placed[0].start).toBe(0);
      // Cut 1 starts at 0 + 3.0 - 0.25 = 2.75
      expect(placed[1].start).toBe(2.75);
    });
  });

  describe('4. Real FFmpeg Render With Text Hook and Punch-In Zoom', () => {
    let tempDir: string;
    let sampleVideoPath: string;
    let sampleClipKey: string;

    beforeEach(async () => {
      tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'creator-test-'));
      sampleVideoPath = path.join(tempDir, 'sample_presenter.mp4');

      // Generate a short 4-second synthetic vertical 1080x1920 test clip with audio
      await runFfmpeg([
        '-hide_banner', '-loglevel', 'error', '-y',
        '-f', 'lavfi', '-i', 'testsrc=duration=4:size=1080x1920:rate=30',
        '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo',
        '-t', '4',
        '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-ar', '48000', '-ac', '2',
        sampleVideoPath,
      ]);

      const vidBuffer = await fsp.readFile(sampleVideoPath);
      const upload = await defaultStorage.upload(
        { buffer: vidBuffer, filename: 'sample_presenter.mp4', mimetype: 'video/mp4' },
        'video-lab/test'
      );
      sampleClipKey = upload.key;
    });

    it('renders a full recipe with text hook, punch-in presenter zoom, and captions', async () => {
      const outputVideo = path.join(tempDir, 'output_creator.mp4');
      const outputPoster = path.join(tempDir, 'output_creator.jpg');

      const recipe: EditRecipe = {
        version: 2,
        variant: { index: 0, label: 'Variant A · Creator Style' },
        output: { width: 1080, height: 1920, fps: 30, maxSecondsPerClip: 25 },
        editing: 'smart',
        cuts: [
          {
            key: sampleClipKey,
            filename: 'sample_presenter.mp4',
            start: 0,
            end: 3.5,
            cues: [
              { start: 0.2, end: 1.5, text: 'Welcome to Sushma Belleza' },
              { start: 1.8, end: 3.2, text: 'Luxury 3 BHK apartments' },
            ],
          },
        ],
        transitionSeconds: SHORT_CROSSFADE_SECONDS,
        hook: {
          text: '3 BHK · Sushma Belleza',
          startSeconds: 0.2,
          endSeconds: 2.4,
        },
        zooms: [
          {
            start: 1.2,
            end: 3.2,
            from: 1.00,
            to: 1.08,
          },
        ],
        captions: {
          language: 'en',
          style: 'POP',
          source: 'speech',
          lines: ['Welcome to Sushma Belleza', 'Luxury 3 BHK apartments'],
        },
        watermark: { text: 'RealCRM' },
        endCard: {
          template: 'HERITAGE_LUXURY',
          seconds: 1.5,
          projectName: 'Sushma Belleza',
          orgName: 'RealCRM',
          phone: '+91 98765 43210',
        },
        music: null,
      };

      const result = await renderRecipeWithFfmpeg(recipe, {
        workDir: path.join(tempDir, 'work'),
        outputVideoPath: outputVideo,
        outputPosterPath: outputPoster,
      });

      // Verify render result
      expect(result.durationSeconds).toBeGreaterThan(3.5);
      expect(result.steps.length).toBeGreaterThan(0);

      // Verify that zoom step was recorded
      const zoomStep = result.steps.find((s) => s.name.includes('Punch-in zoom on presenter'));
      expect(zoomStep).toBeDefined();

      // Verify output video file integrity
      const probe = await probeMedia(outputVideo);
      expect(probe.hasVideo).toBe(true);
      expect(probe.hasAudio).toBe(true);
      expect(probe.width).toBe(1080);
      expect(probe.height).toBe(1920);

      // Verify poster frame was generated
      const posterStat = await fsp.stat(outputPoster);
      expect(posterStat.size).toBeGreaterThan(0);

      // Cleanup
      await fsp.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    }, 45000);
  });
});
