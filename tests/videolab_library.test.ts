import { describe, it, expect, beforeEach, vi, beforeAll } from 'vitest';
import mongoose, { Types } from 'mongoose';
import path from 'path';
import fs from 'fs';
import fsp from 'fs/promises';
import {
  buildBrollPlan,
  fetchMemoryBrollCandidates,
  BrollCandidate,
  RecipeOverlay,
} from '../src/modules/videolab/brollPlan.js';
import {
  buildEditSheet,
  validateAiProposal,
  identifyBrollPool,
  planSmartEditsWithDirector,
} from '../src/modules/videolab/editDirector.js';
import { renderRecipeWithFfmpeg } from '../src/modules/videolab/ffmpegRenderer.js';
import { ContentItem, ContentShot } from '../src/modules/videolab/memoryModel.js';
import { probeMedia } from '../src/utils/ffmpeg.js';
import type { LabClip, CaptionCue, EditRecipe } from '../src/modules/videolab/recipe.js';

const TEST_OUT_DIR = path.resolve(process.cwd(), 'storage', 'scratch', 'library-broll-verify');
const SOURCE_CLIP_KEY = 'video-lab/assets/eeb3f88e-0035-4e27-8323-f684122ca1a7.mp4';
const PHOTO_KEY = 'video-lab/library/test-kitchen.jpg';

describe('Video Lab - Step 4b: Project Library as B-roll', () => {
  const itemsMap = new Map<string, any>();
  const shotsMap = new Map<string, any>();

  const matchFilter = (doc: any, filter: any): boolean => {
    if (!filter || Object.keys(filter).length === 0) return true;
    for (const [key, val] of Object.entries(filter)) {
      if (key === '$or' && Array.isArray(val)) {
        const matchesAny = val.some((subFilter) => matchFilter(doc, subFilter));
        if (!matchesAny) return false;
        continue;
      }
      if (val instanceof Types.ObjectId) {
        if (!doc[key] || doc[key].toString() !== val.toString()) return false;
        continue;
      }
      if (val instanceof RegExp) {
        if (!val.test(doc[key])) return false;
        continue;
      }
      if (typeof val === 'object' && val !== null) {
        const op = Object.keys(val)[0];
        const target = (val as any)[op];
        if (op === '$regex') {
          if (!new RegExp(target).test(doc[key])) return false;
          continue;
        }
        if (op === '$in' && Array.isArray(target)) {
          const docVal = doc[key];
          const hasMatch = target.some((regexOrVal: any) => {
            if (regexOrVal instanceof RegExp) {
              if (Array.isArray(docVal)) return docVal.some((v) => regexOrVal.test(v));
              return regexOrVal.test(docVal);
            }
            if (Array.isArray(docVal)) return docVal.includes(regexOrVal);
            return docVal === regexOrVal;
          });
          if (!hasMatch) return false;
          continue;
        }
      }
      if (doc[key] !== val) return false;
    }
    return true;
  };

  beforeAll(async () => {
    await fsp.mkdir(TEST_OUT_DIR, { recursive: true });
    await fsp.mkdir(path.dirname(path.resolve(process.cwd(), 'storage', PHOTO_KEY)), { recursive: true });
    // Ensure test photo exists
    const photoPath = path.resolve(process.cwd(), 'storage', PHOTO_KEY);
    if (!fs.existsSync(photoPath)) {
      // Create simple 1080x1920 jpeg if missing
      await fsp.writeFile(photoPath, Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]));
    }
  });

  beforeEach(() => {
    itemsMap.clear();
    shotsMap.clear();

    vi.restoreAllMocks();

    vi.spyOn(mongoose.connection, 'readyState', 'get').mockReturnValue(1);
    Object.defineProperty(mongoose.connection, 'db', {
      value: {},
      configurable: true,
      writable: true,
    });

    vi.spyOn(ContentItem, 'find').mockImplementation((filter: any) => ({
      lean: async () => Array.from(itemsMap.values()).filter((item) => matchFilter(item, filter)),
    } as any));

    vi.spyOn(ContentShot, 'find').mockImplementation((filter: any) => ({
      populate: (field: string) => ({
        lean: async () =>
          Array.from(shotsMap.values())
            .filter((shot) => matchFilter(shot, filter))
            .map((shot) => {
              if (field === 'itemId') {
                const item = itemsMap.get(shot.itemId?.toString());
                return { ...shot, itemId: item || null };
              }
              return shot;
            }),
      }),
    } as any));
  });

  it('prioritizes current clip B-roll over library video and library photo', () => {
    const clips: LabClip[] = [
      {
        key: 'current_presenter.mp4',
        durationSeconds: 20,
        shots: [
          {
            start: 0,
            end: 8,
            label: 'Presenter explaining living and kitchen',
            category: 'PRESENTER',
            quality: 4,
            hookScore: 4,
            hasSpeech: true,
            bestStart: 0,
            bestEnd: 8,
            keep: true,
          },
          {
            start: 10,
            end: 15,
            label: 'Current footage kitchen modular island',
            category: 'KITCHEN',
            quality: 4,
            hookScore: 3,
            hasSpeech: false,
            bestStart: 10,
            bestEnd: 15,
            keep: true,
          },
        ],
      },
    ];

    const speechCues: CaptionCue[] = [
      {
        start: 0.5,
        end: 2.2,
        text: 'Welcome to our luxury penthouse',
        words: [
          { text: 'Welcome', start: 0.5, end: 1.0 },
          { text: 'to', start: 1.0, end: 1.2 },
          { text: 'our', start: 1.2, end: 1.5 },
          { text: 'luxury', start: 1.5, end: 1.8 },
          { text: 'penthouse', start: 1.8, end: 2.2 },
        ],
      },
      {
        start: 3.0,
        end: 6.5,
        text: 'Check out this modular kitchen and granite finish',
        words: [
          { text: 'Check', start: 3.0, end: 3.3 },
          { text: 'out', start: 3.3, end: 3.6 },
          { text: 'this', start: 3.6, end: 3.9 },
          { text: 'modular', start: 3.9, end: 4.4 },
          { text: 'kitchen', start: 4.4, end: 5.0 },
          { text: 'and', start: 5.0, end: 5.3 },
          { text: 'granite', start: 5.3, end: 5.8 },
          { text: 'finish', start: 5.8, end: 6.5 },
        ],
      },
    ];

    const memoryCandidates: BrollCandidate[] = [
      {
        key: 'video-lab/library/old_kitchen_clip.mp4',
        clipIndex: -1,
        start: 2.0,
        end: 6.0,
        label: 'Old video kitchen shot',
        category: 'KITCHEN',
        quality: 5,
        hookScore: 4,
        problems: 0,
        score: 10,
        kind: 'clip',
        origin: 'library_video',
        isIllustrative: false,
      },
      {
        key: 'video-lab/library/kitchen_photo.jpg',
        clipIndex: -1,
        start: 0,
        end: 4.0,
        label: 'Kitchen photo render',
        category: 'KITCHEN',
        quality: 5,
        hookScore: 4,
        problems: 0,
        score: 10,
        kind: 'photo',
        origin: 'library_photo',
        isIllustrative: true,
      },
    ];

    const overlays = buildBrollPlan({
      clips,
      speechCues,
      totalNarrationDuration: 10,
      memoryCandidates,
    });

    expect(overlays.length).toBe(1);
    // Should choose the current clip shot, NOT library video or photo
    expect(overlays[0].source.key).toBe('current_presenter.mp4');
    expect(overlays[0].origin).toBe('this_clip');
  });

  it('selects library video over library photo when current clip has no match', () => {
    const clips: LabClip[] = [
      {
        key: 'current_presenter.mp4',
        durationSeconds: 20,
        shots: [
          {
            start: 0,
            end: 15,
            label: 'Presenter talking',
            category: 'PRESENTER',
            quality: 4,
            hookScore: 4,
            hasSpeech: true,
            bestStart: 0,
            bestEnd: 15,
            keep: true,
          },
        ],
      },
    ];

    const speechCues: CaptionCue[] = [
      {
        start: 3.0,
        end: 6.5,
        text: 'This spacious bedroom has wooden flooring',
        words: [
          { text: 'This', start: 3.0, end: 3.3 },
          { text: 'spacious', start: 3.3, end: 3.8 },
          { text: 'bedroom', start: 3.8, end: 4.5 },
          { text: 'has', start: 4.5, end: 4.8 },
          { text: 'wooden', start: 4.8, end: 5.4 },
          { text: 'flooring', start: 5.4, end: 6.5 },
        ],
      },
    ];

    const memoryCandidates: BrollCandidate[] = [
      {
        key: 'video-lab/library/past_bedroom_shot.mp4',
        clipIndex: -1,
        start: 1.0,
        end: 5.0,
        label: 'Past project master bedroom video',
        category: 'BEDROOM',
        quality: 4,
        hookScore: 3,
        problems: 0,
        score: 8,
        kind: 'clip',
        origin: 'library_video',
        isIllustrative: false,
      },
      {
        key: 'video-lab/library/bedroom_photo.jpg',
        clipIndex: -1,
        start: 0,
        end: 4.0,
        label: 'Past project bedroom photo',
        category: 'BEDROOM',
        quality: 5,
        hookScore: 4,
        problems: 0,
        score: 10,
        kind: 'photo',
        origin: 'library_photo',
        isIllustrative: false,
      },
    ];

    const overlays = buildBrollPlan({
      clips,
      speechCues,
      totalNarrationDuration: 10,
      memoryCandidates,
    });

    expect(overlays.length).toBe(1);
    // Should prioritize library_video over library_photo
    expect(overlays[0].source.key).toBe('video-lab/library/past_bedroom_shot.mp4');
    expect(overlays[0].origin).toBe('library_video');
    expect(overlays[0].source.kind).toBe('clip');
  });

  it('selects photo when only photo exists for a mentioned category and marks CARD style', () => {
    const clips: LabClip[] = [
      {
        key: 'current_presenter.mp4',
        durationSeconds: 20,
        shots: [
          {
            start: 0,
            end: 15,
            label: 'Presenter talking',
            category: 'PRESENTER',
            quality: 4,
            hookScore: 4,
            hasSpeech: true,
            bestStart: 0,
            bestEnd: 15,
            keep: true,
          },
        ],
      },
    ];

    const speechCues: CaptionCue[] = [
      {
        start: 3.0,
        end: 6.0,
        text: 'The scenic balcony view is breathtaking',
        words: [
          { text: 'The', start: 3.0, end: 3.2 },
          { text: 'scenic', start: 3.2, end: 3.7 },
          { text: 'balcony', start: 3.7, end: 4.3 },
          { text: 'view', start: 4.3, end: 4.8 },
          { text: 'is', start: 4.8, end: 5.0 },
          { text: 'breathtaking', start: 5.0, end: 6.0 },
        ],
      },
    ];

    const memoryCandidates: BrollCandidate[] = [
      {
        key: 'video-lab/library/balcony_render.png',
        clipIndex: -1,
        start: 0,
        end: 4.0,
        label: 'Sunset balcony architectural render',
        category: 'BALCONY_VIEW',
        quality: 5,
        hookScore: 4,
        problems: 0,
        score: 10,
        kind: 'photo',
        origin: 'library_photo',
        isIllustrative: true,
      },
    ];

    const overlays = buildBrollPlan({
      clips,
      speechCues,
      totalNarrationDuration: 10,
      memoryCandidates,
    });

    expect(overlays.length).toBe(1);
    expect(overlays[0].source.key).toBe('video-lab/library/balcony_render.png');
    expect(overlays[0].source.kind).toBe('photo');
    expect(overlays[0].origin).toBe('library_photo');
    expect(overlays[0].isIllustrative).toBe(true);
    expect(overlays[0].style).toBe('CARD');
  });

  it('strictly excludes memory candidates when consentOk is false', async () => {
    const noConsentItemId = new Types.ObjectId();
    itemsMap.set(noConsentItemId.toString(), {
      _id: noConsentItemId,
      sourceKey: 'video-lab/library/private_flat.mp4',
      kind: 'VIDEO',
      consentOk: false, // Owner did not grant consent!
      actualOrIllustrative: 'ACTUAL',
    });

    const shotId = new Types.ObjectId();
    shotsMap.set(shotId.toString(), {
      _id: shotId,
      itemId: noConsentItemId,
      clipKey: 'video-lab/library/private_flat.mp4',
      room: 'KITCHEN',
      start: 0,
      end: 4.0,
      quality: 5,
      issues: [],
      usedIn: [],
    });

    const candidates = await fetchMemoryBrollCandidates(['KITCHEN']);
    expect(candidates).toEqual([]);
  });

  it('strictly excludes memory candidates used within the recent days cutoff', async () => {
    const itemId = new Types.ObjectId();
    itemsMap.set(itemId.toString(), {
      _id: itemId,
      sourceKey: 'video-lab/library/recent_kitchen.mp4',
      kind: 'VIDEO',
      consentOk: true,
      actualOrIllustrative: 'ACTUAL',
    });

    const shotId = new Types.ObjectId();
    const threeDaysAgo = new Date(Date.now() - 3 * 86400000);

    shotsMap.set(shotId.toString(), {
      _id: shotId,
      itemId,
      clipKey: 'video-lab/library/recent_kitchen.mp4',
      room: 'KITCHEN',
      start: 0,
      end: 4.0,
      quality: 5,
      issues: [],
      usedIn: [{ renderId: new Types.ObjectId(), at: threeDaysAgo }],
    });

    // Exclude if used within 14 days
    const candidates = await fetchMemoryBrollCandidates(['KITCHEN'], { excludeRecentDays: 14 });
    expect(candidates).toEqual([]);

    // If excludeRecentDays is 1 day, it should be eligible
    const eligibleCandidates = await fetchMemoryBrollCandidates(['KITCHEN'], { excludeRecentDays: 1 });
    expect(eligibleCandidates.length).toBe(1);
    expect(eligibleCandidates[0].key).toBe('video-lab/library/recent_kitchen.mp4');
  });

  it('falls back to showing face when memory has no matching shots', () => {
    const clips: LabClip[] = [
      {
        key: 'current_presenter.mp4',
        durationSeconds: 20,
        shots: [
          {
            start: 0,
            end: 15,
            label: 'Presenter speech',
            category: 'PRESENTER',
            quality: 4,
            hookScore: 4,
            hasSpeech: true,
            bestStart: 0,
            bestEnd: 15,
            keep: true,
          },
        ],
      },
    ];

    const speechCues: CaptionCue[] = [
      {
        start: 3.0,
        end: 6.0,
        text: 'The master bathroom features Italian marble',
        words: [
          { text: 'The', start: 3.0, end: 3.3 },
          { text: 'master', start: 3.3, end: 3.8 },
          { text: 'bathroom', start: 3.8, end: 4.6 },
          { text: 'features', start: 4.6, end: 5.2 },
          { text: 'Italian', start: 5.2, end: 5.6 },
          { text: 'marble', start: 5.6, end: 6.0 },
        ],
      },
    ];

    // Memory has gym amenity, but no bathroom
    const memoryCandidates: BrollCandidate[] = [
      {
        key: 'video-lab/library/gym.mp4',
        clipIndex: -1,
        start: 0,
        end: 4.0,
        label: 'Fitness club gym',
        category: 'AMENITY',
        quality: 5,
        hookScore: 4,
        problems: 0,
        score: 10,
        kind: 'clip',
        origin: 'library_video',
      },
    ];

    const overlays = buildBrollPlan({
      clips,
      speechCues,
      totalNarrationDuration: 10,
      memoryCandidates,
    });

    // Rule 8: Never show irrelevant cutaway when no room match exists
    expect(overlays).toEqual([]);
  });

  it('includes library and artist impression tags in Edit Sheet for Gemini', () => {
    const identifiedPool = identifyBrollPool([
      {
        key: 'video-lab/assets/presenter.mp4',
        clipIndex: 0,
        start: 2,
        end: 6,
        label: 'Living room hall',
        category: 'LIVING',
        quality: 4,
        hookScore: 3,
        problems: 0,
        score: 8,
        kind: 'clip',
        origin: 'this_clip',
        isIllustrative: false,
      },
      {
        key: 'video-lab/library/old_clip.mp4',
        clipIndex: -1,
        start: 0,
        end: 3.5,
        label: 'Clubhouse gym',
        category: 'AMENITY',
        quality: 4,
        hookScore: 3,
        problems: 0,
        score: 8,
        kind: 'clip',
        origin: 'library_video',
        isIllustrative: false,
      },
      {
        key: 'video-lab/library/photo_render.webp',
        clipIndex: -1,
        start: 0,
        end: 4.0,
        label: 'Modular kitchen island 3D',
        category: 'KITCHEN',
        quality: 5,
        hookScore: 4,
        problems: 0,
        score: 10,
        kind: 'photo',
        origin: 'library_photo',
        isIllustrative: true,
      },
    ]);

    const sheet = buildEditSheet({
      projectName: 'Emerald Towers',
      orgName: 'Prestige Realty',
      language: 'English',
      speechCues: [{ start: 3, end: 6, text: 'Beautiful modular kitchen' }],
      identifiedPool,
      totalNarrationDuration: 12,
    });

    expect(sheet).toContain('Source: Current footage');
    expect(sheet).toContain('Source: Library video');
    expect(sheet).toContain('Source: Library photo [Artist Impression]');
  });

  it('validates AI proposal with library photo and sets CARD style and illustrative flags', () => {
    const identifiedPool = identifyBrollPool([
      {
        key: 'video-lab/library/kitchen_render.jpg',
        clipIndex: -1,
        start: 0,
        end: 4.0,
        label: 'Modular kitchen layout',
        category: 'KITCHEN',
        quality: 5,
        hookScore: 4,
        problems: 0,
        score: 10,
        kind: 'photo',
        origin: 'library_photo',
        isIllustrative: true,
      },
    ]);

    const speechCues: CaptionCue[] = [
      {
        start: 3.0,
        end: 6.0,
        text: 'Check out the modular kitchen finish',
        words: [
          { text: 'Check', start: 3.0, end: 3.3 },
          { text: 'out', start: 3.3, end: 3.6 },
          { text: 'the', start: 3.6, end: 3.9 },
          { text: 'modular', start: 3.9, end: 4.5 },
          { text: 'kitchen', start: 4.5, end: 5.2 },
          { text: 'finish', start: 5.2, end: 6.0 },
        ],
      },
    ];

    const proposal = {
      editorialTheme: 'Luxury highlight',
      brollDecisions: [
        {
          shotId: 'shot_0',
          targetTimelineStart: 3.5,
          targetTimelineEnd: 5.8,
          spokenPhrase: 'modular kitchen',
          reason: 'Show kitchen design as presenter describes it',
        },
      ],
    };

    const overlays = validateAiProposal({
      proposal,
      clips: [],
      identifiedPool,
      speechCues,
      totalNarrationDuration: 10,
    });

    expect(overlays.length).toBe(1);
    expect(overlays[0].source.kind).toBe('photo');
    expect(overlays[0].source.key).toBe('video-lab/library/kitchen_render.jpg');
    expect(overlays[0].origin).toBe('library_photo');
    expect(overlays[0].isIllustrative).toBe(true);
    expect(overlays[0].style).toBe('CARD');
  });

  it('renders a real video with a CARD photo overlay and Artist Impression tag using FFmpeg', async () => {
    expect(fs.existsSync(path.resolve(process.cwd(), 'storage', SOURCE_CLIP_KEY))).toBe(true);

    const workDir = path.join(TEST_OUT_DIR, 'work-card-photo');
    const outVideo = path.join(TEST_OUT_DIR, 'out-card-photo.mp4');
    const outPoster = path.join(TEST_OUT_DIR, 'out-card-photo.jpg');

    const recipe: EditRecipe = {
      version: 2,
      variant: { index: 0, label: 'Variant A - Card Photo Overlay' },
      output: { width: 1080, height: 1920, fps: 30, maxSecondsPerClip: 10 },
      editing: 'whole',
      cuts: [
        {
          key: SOURCE_CLIP_KEY,
          filename: 'test.mp4',
          start: 0,
          end: 3.0,
          cues: [
            {
              start: 0.5,
              end: 2.5,
              text: 'Luxury modern kitchen design',
              words: [
                { text: 'Luxury', start: 0.5, end: 1.0, isKeyword: true },
                { text: 'modern', start: 1.0, end: 1.5, isKeyword: false },
                { text: 'kitchen', start: 1.5, end: 2.0, isKeyword: true },
                { text: 'design', start: 2.0, end: 2.5, isKeyword: false },
              ],
            },
          ],
        },
      ],
      overlays: [
        {
          start: 0.8,
          end: 2.2,
          source: {
            kind: 'photo',
            key: PHOTO_KEY,
          },
          style: 'CARD',
          motion: 'ZOOM_IN',
          label: 'Modular kitchen',
          origin: 'library_photo',
          isIllustrative: true,
          decidedBy: 'rules',
        },
      ],
      transitionSeconds: 0,
      captions: {
        language: 'en',
        style: 'POP',
        source: 'speech',
        lines: [],
        keywords: ['Luxury', 'kitchen'],
      },
      watermark: { text: 'RealCRM Premier' },
      endCard: {
        template: 'HIGH_GROWTH_ROI',
        seconds: 1.5,
        projectName: 'Grand Penthouse',
        orgName: 'Prestige Realty',
        phone: '+91 98765 43210',
      },
    };

    const result = await renderRecipeWithFfmpeg(recipe, {
      workDir,
      outputVideoPath: outVideo,
      outputPosterPath: outPoster,
    });

    expect(fs.existsSync(outVideo)).toBe(true);
    expect(fs.existsSync(outPoster)).toBe(true);

    const probe = await probeMedia(outVideo);
    expect(probe.hasVideo).toBe(true);
    expect(probe.hasAudio).toBe(true);
    expect(probe.width).toBe(1080);
    expect(probe.height).toBe(1920);
    expect(probe.durationSeconds).toBeGreaterThan(3.5);
  }, 40000);

  it('renders a real video with a FULL (Ken Burns ZOOM_IN) photo overlay using FFmpeg', async () => {
    expect(fs.existsSync(path.resolve(process.cwd(), 'storage', SOURCE_CLIP_KEY))).toBe(true);

    const workDir = path.join(TEST_OUT_DIR, 'work-full-photo');
    const outVideo = path.join(TEST_OUT_DIR, 'out-full-photo.mp4');
    const outPoster = path.join(TEST_OUT_DIR, 'out-full-photo.jpg');

    const recipe: EditRecipe = {
      version: 2,
      variant: { index: 0, label: 'Variant B - Full Zoompan Photo Overlay' },
      output: { width: 1080, height: 1920, fps: 30, maxSecondsPerClip: 10 },
      editing: 'whole',
      cuts: [
        {
          key: SOURCE_CLIP_KEY,
          filename: 'test.mp4',
          start: 0,
          end: 3.0,
          cues: [
            {
              start: 0.5,
              end: 2.5,
              text: 'Modern modular kitchen',
            },
          ],
        },
      ],
      overlays: [
        {
          start: 0.8,
          end: 2.2,
          source: {
            kind: 'photo',
            key: PHOTO_KEY,
          },
          style: 'FULL',
          motion: 'ZOOM_IN',
          label: 'Modular Kitchen Island',
          origin: 'library_photo',
          isIllustrative: false,
          decidedBy: 'rules',
        },
      ],
      transitionSeconds: 0,
      captions: null,
      watermark: { text: 'RealCRM Premier' },
      endCard: {
        template: 'HERITAGE_LUXURY',
        seconds: 1.5,
        projectName: 'Grand Penthouse',
        orgName: 'Prestige Realty',
      },
    };

    const result = await renderRecipeWithFfmpeg(recipe, {
      workDir,
      outputVideoPath: outVideo,
      outputPosterPath: outPoster,
    });

    expect(fs.existsSync(outVideo)).toBe(true);
    const probe = await probeMedia(outVideo);
    expect(probe.hasVideo).toBe(true);
    expect(probe.hasAudio).toBe(true);
    expect(probe.width).toBe(1080);
    expect(probe.height).toBe(1920);
  }, 40000);
});

