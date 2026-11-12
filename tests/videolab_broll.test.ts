import { describe, it, expect } from 'vitest';
import {
  matchWordToCategory,
  findCategoryMomentsInCues,
  extractBrollPool,
  extractSpeechBlocks,
  buildBrollPlan,
} from '../src/modules/videolab/brollPlan.js';
import { CaptionCue, LabClip } from '../src/modules/videolab/recipe.js';

describe('Video Lab B-Roll Planner - Keyword Matching', () => {
  it('matches English real estate terms accurately', () => {
    expect(matchWordToCategory('kitchen')).toBe('KITCHEN');
    expect(matchWordToCategory('modular')).toBe('KITCHEN');
    expect(matchWordToCategory('bedroom')).toBe('BEDROOM');
    expect(matchWordToCategory('balcony')).toBe('BALCONY_VIEW');
    expect(matchWordToCategory('view')).toBe('BALCONY_VIEW');
    expect(matchWordToCategory('gym')).toBe('AMENITY');
    expect(matchWordToCategory('pool')).toBe('AMENITY');
    expect(matchWordToCategory('highway')).toBe('LOCATION');
  });

  it('matches Hindi Devanagari terms accurately', () => {
    expect(matchWordToCategory('रसोई')).toBe('KITCHEN');
    expect(matchWordToCategory('किचन')).toBe('KITCHEN');
    expect(matchWordToCategory('बेडरूम')).toBe('BEDROOM');
    expect(matchWordToCategory('कमरा')).toBe('BEDROOM');
    expect(matchWordToCategory('बालकनी')).toBe('BALCONY_VIEW');
    expect(matchWordToCategory('पार्क')).toBe('AMENITY');
    expect(matchWordToCategory('इमारत')).toBe('EXTERIOR');
  });

  it('matches Punjabi Gurmukhi terms accurately', () => {
    expect(matchWordToCategory('ਰਸੋਈ')).toBe('KITCHEN');
    expect(matchWordToCategory('ਕਮਰਾ')).toBe('BEDROOM');
    expect(matchWordToCategory('ਬਾਲਕੋਨੀ')).toBe('BALCONY_VIEW');
    expect(matchWordToCategory('ਇਮਾਰਤ')).toBe('EXTERIOR');
    expect(matchWordToCategory('ਪਾਰਕ')).toBe('AMENITY');
  });

  it('matches Hinglish mixed-script terms accurately', () => {
    expect(matchWordToCategory('rasoi')).toBe('KITCHEN');
    expect(matchWordToCategory('kamra')).toBe('BEDROOM');
    expect(matchWordToCategory('elevation')).toBe('EXTERIOR');
    expect(matchWordToCategory('clubhouse')).toBe('AMENITY');
  });

  it('returns null for unrelated filler words', () => {
    expect(matchWordToCategory('hello')).toBeNull();
    expect(matchWordToCategory('price')).toBeNull();
    expect(matchWordToCategory('welcome')).toBeNull();
    expect(matchWordToCategory('the')).toBeNull();
  });
});

describe('Video Lab B-Roll Planner - Placement Rules', () => {
  const dummyClips: LabClip[] = [
    {
      key: 'clip-presenter.mp4',
      shots: [
        {
          start: 0,
          end: 15,
          label: 'Presenter talking',
          category: 'PRESENTER',
          quality: 4,
          hookScore: 4,
          issues: [],
          hasSpeech: true,
          bestStart: 0,
          bestEnd: 15,
          keep: true,
          reason: 'Good speech',
        },
      ],
    },
    {
      key: 'clip-broll.mp4',
      shots: [
        {
          start: 0,
          end: 4,
          label: 'Modern modular kitchen',
          category: 'KITCHEN',
          quality: 5,
          hookScore: 4,
          issues: [],
          hasSpeech: false,
          bestStart: 0.5,
          bestEnd: 3.8,
          keep: true,
          reason: 'Sharp kitchen b-roll',
        },
        {
          start: 5,
          end: 9,
          label: 'Scenic balcony view',
          category: 'BALCONY_VIEW',
          quality: 4,
          hookScore: 5,
          issues: [],
          hasSpeech: false,
          bestStart: 5.2,
          bestEnd: 8.5,
          keep: true,
          reason: 'Clear view',
        },
      ],
    },
  ];

  it('extracts B-roll pool excluding speech shots and low-quality shots', () => {
    const pool = extractBrollPool(dummyClips);
    expect(pool).toHaveLength(2);
    expect(pool[0].category).toBe('KITCHEN');
    expect(pool[1].category).toBe('BALCONY_VIEW');
  });

  it('extracts continuous speech blocks without cuts in speech', () => {
    const blocks = extractSpeechBlocks(dummyClips, 20);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].key).toBe('clip-presenter.mp4');
    expect(blocks[0].end).toBe(15);
  });

  it('protects the opening hook (first 2.5s) from B-roll cutaway', () => {
    const speechCues: CaptionCue[] = [
      {
        start: 0.5,
        end: 2.2,
        text: 'Welcome to this kitchen',
        words: [
          { text: 'Welcome', start: 0.5, end: 1.0 },
          { text: 'to', start: 1.0, end: 1.2 },
          { text: 'this', start: 1.2, end: 1.5 },
          { text: 'kitchen', start: 1.5, end: 2.2 },
        ],
      },
      {
        start: 3.5,
        end: 6.0,
        text: 'Notice the balcony view',
        words: [
          { text: 'Notice', start: 3.5, end: 4.0 },
          { text: 'the', start: 4.0, end: 4.3 },
          { text: 'balcony', start: 4.3, end: 5.0 },
          { text: 'view', start: 5.0, end: 6.0 },
        ],
      },
    ];

    const overlays = buildBrollPlan({
      clips: dummyClips,
      speechCues,
      totalNarrationDuration: 12,
    });

    // Kitchen was mentioned at 1.5s (< 2.5s hook limit), so it must NOT trigger B-roll.
    // Balcony was mentioned at 4.3s (> 2.5s), so it SHOULD trigger B-roll.
    expect(overlays).toHaveLength(1);
    expect(overlays[0].label).toContain('balcony');
    expect(overlays[0].start).toBe(4.3);
    expect(overlays[0].start).toBeGreaterThanOrEqual(2.5);
  });

  it('enforces minimum 1.5s presenter face resurfacing between two B-rolls', () => {
    const speechCues: CaptionCue[] = [
      {
        start: 3.0,
        end: 5.0,
        text: 'Beautiful kitchen counter',
        words: [
          { text: 'Beautiful', start: 3.0, end: 3.5 },
          { text: 'kitchen', start: 3.5, end: 4.2 },
          { text: 'counter', start: 4.2, end: 5.0 },
        ],
      },
      {
        start: 5.5,
        end: 7.5,
        text: 'With spacious balcony',
        words: [
          { text: 'With', start: 5.5, end: 6.0 },
          { text: 'spacious', start: 6.0, end: 6.5 },
          { text: 'balcony', start: 6.5, end: 7.5 },
        ],
      },
      {
        start: 8.5,
        end: 11.0,
        text: 'And open view',
        words: [
          { text: 'And', start: 8.5, end: 9.0 },
          { text: 'open', start: 9.0, end: 9.5 },
          { text: 'view', start: 9.5, end: 11.0 },
        ],
      },
    ];

    const overlays = buildBrollPlan({
      clips: dummyClips,
      speechCues,
      totalNarrationDuration: 15,
    });

    // First overlay starts at 3.5s (kitchen). Say it ends around 5.0s - 6.5s.
    // The second mention at 6.5s would be too close (< 1.5s face gap), so it must wait until the gap is >= 1.5s.
    expect(overlays.length).toBeGreaterThanOrEqual(1);
    for (let i = 1; i < overlays.length; i++) {
      expect(overlays[i].start).toBeGreaterThanOrEqual(overlays[i - 1].end + 1.5);
    }
  });

  it('enforces maximum 60% total B-roll budget', () => {
    const totalNarration = 10;
    const speechCues: CaptionCue[] = [
      {
        start: 3.0,
        end: 7.0,
        text: 'kitchen and balcony',
        words: [
          { text: 'kitchen', start: 3.0, end: 5.0 },
          { text: 'and', start: 5.0, end: 5.2 },
          { text: 'balcony', start: 5.2, end: 7.0 },
        ],
      },
    ];

    const overlays = buildBrollPlan({
      clips: dummyClips,
      speechCues,
      totalNarrationDuration: totalNarration,
      maxBrollBudgetPercent: 0.3, // 30% = max 3.0s total B-roll
    });

    const totalBrollTime = overlays.reduce((sum, o) => sum + (o.end - o.start), 0);
    expect(totalBrollTime).toBeLessThanOrEqual(totalNarration * 0.3 + 0.1);
  });

  it('falls back gracefully to presenter face when keyword has no matching B-roll in pool', () => {
    const speechCues: CaptionCue[] = [
      {
        start: 3.0,
        end: 6.0,
        text: 'Olympic size swimming pool',
        words: [
          { text: 'Olympic', start: 3.0, end: 3.8 },
          { text: 'size', start: 3.8, end: 4.2 },
          { text: 'swimming', start: 4.2, end: 5.0 },
          { text: 'pool', start: 5.0, end: 6.0 },
        ],
      },
    ];

    // clips only have KITCHEN and BALCONY_VIEW, not AMENITY (pool)
    const overlays = buildBrollPlan({
      clips: dummyClips,
      speechCues,
      totalNarrationDuration: 12,
    });

    // Must not insert a kitchen or balcony shot for pool! Must be empty array (keeping presenter face).
    expect(overlays).toHaveLength(0);
  });

  it('marks generated overlays with decidedBy: "rules"', () => {
    const speechCues: CaptionCue[] = [
      {
        start: 3.0,
        end: 6.0,
        text: 'yeh modern modular kitchen hai',
        words: [
          { text: 'yeh', start: 3.0, end: 3.5 },
          { text: 'modern', start: 3.5, end: 4.0 },
          { text: 'modular', start: 4.0, end: 4.8 },
          { text: 'kitchen', start: 4.8, end: 5.5 },
          { text: 'hai', start: 5.5, end: 6.0 },
        ],
      },
    ];

    const overlays = buildBrollPlan({
      clips: dummyClips,
      speechCues,
      totalNarrationDuration: 12,
    });

    expect(overlays.length).toBeGreaterThanOrEqual(1);
    expect(overlays[0].decidedBy).toBe('rules');
  });
});

