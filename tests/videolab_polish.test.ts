import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getClipUploadWarnings, summarizeClipIssues, isPlausibleReraNumber } from '../src/modules/videolab/uploadFeedback.js';
import { computeColorMatchOffset, checkFfmpegHasVidstab, VIDSTAB_SMOOTHING } from '../src/modules/videolab/ffmpegRenderer.js';
import { DEFAULT_EXCLUDE_RECENT_DAYS, searchShots } from '../src/modules/videolab/memorySearch.js';
import { buildBrollPlan } from '../src/modules/videolab/brollPlan.js';
import { ContentShot } from '../src/modules/videolab/memoryModel.js';

describe('Video Lab Polish: Upload Feedback, Footage Enhancement & Fallbacks', () => {
  describe('Upload feedback warnings (R1)', () => {
    it('warns when short side resolution is under 720px', () => {
      const warnings = getClipUploadWarnings({ width: 478, height: 850, hasAudio: true, durationSeconds: 20 });
      expect(warnings).toContain('Low quality. Looks like a WhatsApp-compressed file. Use the original from the phone.');
    });

    it('warns when clip is horizontal (landscape)', () => {
      const warnings = getClipUploadWarnings({ width: 1920, height: 1080, hasAudio: true, durationSeconds: 20 });
      expect(warnings).toContain('Horizontal. Vertical gives better results.');
    });

    it('warns when audio track is missing', () => {
      const warnings = getClipUploadWarnings({ width: 1080, height: 1920, hasAudio: false, durationSeconds: 20 });
      expect(warnings).toContain("No sound. Captions from speech won't work.");
    });

    it('warns when duration exceeds 3 minutes', () => {
      const warnings = getClipUploadWarnings({ width: 1080, height: 1920, hasAudio: true, durationSeconds: 210 });
      expect(warnings).toContain('Only the first 3 minutes are used.');
    });

    it('returns empty warnings for a crisp, vertical clip with sound under 3 min', () => {
      const warnings = getClipUploadWarnings({ width: 1080, height: 1920, hasAudio: true, durationSeconds: 45 });
      expect(warnings).toEqual([]);
    });

    it('summarizes shot issues per clip', () => {
      const summary = summarizeClipIssues([
        { issues: ['shaky', 'too_dark'] },
        { issues: ['shaky'] },
        { issues: ['blurry'] },
      ]);
      expect(summary).toBe('Issues: shaky (2), too dark, blurry');
    });

    it('soft validates plausible RERA registration numbers', () => {
      expect(isPlausibleReraNumber('')).toBe(true); // optional
      expect(isPlausibleReraNumber('PRM/KA/RERA/1251/310/PR/171015/000414')).toBe(true);
      expect(isPlausibleReraNumber('P51800012345')).toBe(true);
      expect(isPlausibleReraNumber('12345')).toBe(false); // too short or no letters
      expect(isPlausibleReraNumber('abc')).toBe(false); // too short or no numbers
    });
  });

  describe('Colour match offset calculation (R3)', () => {
    it('computes positive brightness offset when clip is darker than median', () => {
      const offset = computeColorMatchOffset(100, 120);
      expect(offset).toBeCloseTo((120 - 100) / 255, 3);
      expect(offset).toBeGreaterThan(0);
    });

    it('computes negative brightness offset when clip is brighter than median', () => {
      const offset = computeColorMatchOffset(130, 120);
      expect(offset).toBeCloseTo((120 - 130) / 255, 3);
      expect(offset).toBeLessThan(0);
    });

    it('clamps offset strictly to [-0.08, +0.08]', () => {
      expect(computeColorMatchOffset(20, 200)).toBe(0.08);
      expect(computeColorMatchOffset(220, 30)).toBe(-0.08);
    });
  });

  describe('Vidstab graceful skip & configuration', () => {
    it('defines vidstab smoothing parameter around 10', () => {
      expect(VIDSTAB_SMOOTHING).toBe(10);
    });

    it('checks ffmpeg vidstab availability without throwing', async () => {
      const hasVidstab = await checkFfmpegHasVidstab();
      expect(typeof hasVidstab).toBe('boolean');
    });
  });

  describe('Recent-use relaxation & heuristic photo exclusion in B-roll planning', () => {
    it('exports DEFAULT_EXCLUDE_RECENT_DAYS as 14', () => {
      expect(DEFAULT_EXCLUDE_RECENT_DAYS).toBe(14);
    });

    it('relaxes recent-use exclusion when relaxIfEmpty is true and no candidates remain', async () => {
      const recentShot = {
        _id: 'shot_1',
        clipKey: 'test.mp4',
        room: 'KITCHEN',
        start: 0,
        end: 4,
        quality: 4,
        issues: [],
        usedIn: [{ renderId: 'r1', at: new Date() }], // used today
      };

      vi.spyOn(ContentShot, 'find').mockReturnValue({
        populate: () => ({
          lean: async () => [recentShot],
        }),
      } as any);

      // Without relaxation: strictly excluded
      const strict = await searchShots({ room: 'KITCHEN', excludeRecentDays: 7, relaxIfEmpty: false });
      expect(strict).toHaveLength(0);

      // With relaxation: returns candidates instead of leaving editor with empty candidates
      const relaxed = await searchShots({ room: 'KITCHEN', excludeRecentDays: 7, relaxIfEmpty: true });
      expect(relaxed).toHaveLength(1);
    });

    it('excludes heuristic photos from auto-selected B-roll overlays', () => {
      const overlays = buildBrollPlan({
        clips: [],
        memoryCandidates: [
          {
            key: 'photo_heuristic.jpg',
            clipIndex: -1,
            start: 0,
            end: 4.0,
            category: 'KITCHEN',
            label: 'Kitchen photo',
            features: ['kitchen'],
            actualOrIllustrative: 'ACTUAL',
            isPhoto: true,
            analysisSource: 'heuristic', // unverified
          },
        ],
        speechCues: [
          { start: 3.0, end: 5.0, text: 'modular kitchen' },
        ],
        totalNarrationDuration: 20,
      });

      // The heuristic photo must NOT be chosen automatically as B-roll
      const photoOverlays = overlays.filter((o) => o.source.key === 'photo_heuristic.jpg');
      expect(photoOverlays).toHaveLength(0);
    });
  });
});
