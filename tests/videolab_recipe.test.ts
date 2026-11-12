import { describe, it, expect, afterEach } from 'vitest';
import {
  buildVariants,
  buildVariantsWithDirector,
  cleanCues,
  placeCuesOnTimeline,
  splitCueIntoWords,
  LabInput,
} from '../src/modules/videolab/recipe.js';
import { buildEndCardAss, buildMainAss, fontForText, withFontRuns, assColor } from '../src/modules/videolab/ass.js';
import { setAIProviderOverride } from '../src/modules/ai/providers/index.js';
import { MockAIProvider } from './fakes/fakeAIProvider.js';

const baseInput: LabInput = {
  clips: [
    { key: 'video-lab/assets/a.mp4', filename: 'a.mp4' },
    { key: 'video-lab/assets/b.mp4', filename: 'b.mp4' },
    { key: 'video-lab/assets/c.mp4', filename: 'c.mp4' },
  ],
  musicKey: 'video-lab/assets/m.mp3',
  facts: { orgName: ' Test Developers ', projectName: 'Test Heights', phone: '  ', rera: '' },
  captions: { language: 'hinglish', lines: ['Line one', '  ', 'Line two'] },
};

describe('Video Lab recipe', () => {
  it('builds up to 3 variants that differ only in presentation', () => {
    const variants = buildVariants(baseInput, 3);
    expect(variants).toHaveLength(3);

    // Facts are identical in every variant
    for (const v of variants) {
      expect(v.endCard.projectName).toBe('Test Heights');
      expect(v.endCard.orgName).toBe('Test Developers');
      expect(v.captions?.lines).toEqual(['Line one', 'Line two']);
    }

    // Presentation differs
    expect(variants.map((v) => v.cuts.map((c) => c.filename![0]).join(''))).toEqual(['abc', 'bca', 'cba']);
    expect(variants.every((v) => v.editing === 'whole' && v.cuts.every((c) => c.start === 0 && c.end === undefined))).toBe(true);
    expect(new Set(variants.map((v) => v.endCard.template)).size).toBe(2);
    expect(new Set(variants.map((v) => v.music?.volume)).size).toBe(3);
    // Variants have distinct modern animated caption styles
    expect(variants[0].captions?.style).toBe('POP');
    expect(variants[1].captions?.style).toBe('KARAOKE');
    expect(variants[2].captions?.style).toBe('SLIDE');
  });

  it('omits phone and RERA when they are empty, and uses the org name as watermark without a logo', () => {
    const [v] = buildVariants(baseInput, 1);
    expect(v.endCard).not.toHaveProperty('phone');
    expect(v.endCard).not.toHaveProperty('rera');
    expect(v.watermark).toEqual({ text: 'Test Developers' });
  });

  it('keeps phone and RERA when provided, and uses the logo as watermark', () => {
    const [v] = buildVariants(
      { ...baseInput, logoKey: 'video-lab/assets/l.png', facts: { ...baseInput.facts, phone: '+91 98000 00000', rera: 'PBRERA-1' } },
      1
    );
    expect(v.endCard.phone).toBe('+91 98000 00000');
    expect(v.endCard.rera).toBe('PBRERA-1');
    expect(v.watermark).toEqual({ logoKey: 'video-lab/assets/l.png' });
  });

  it('clamps the variant count and drops captions when there are no lines', () => {
    expect(buildVariants(baseInput, 10)).toHaveLength(3);
    expect(buildVariants(baseInput, 0)).toHaveLength(1);
    const [v] = buildVariants({ ...baseInput, captions: { language: 'en', lines: ['   '] } }, 1);
    expect(v.captions).toBeNull();
  });
});

describe('Video Lab word-level timestamp interpolation & keyword matching', () => {
  it('interpolates word timestamps proportionally by character length in English', () => {
    const words = splitCueIntoWords({ start: 0, end: 3, text: 'Luxury penthouse balcony' }, ['luxury', 'penthouse']);
    expect(words).toHaveLength(3);
    expect(words[0].text).toBe('Luxury');
    expect(words[0].start).toBe(0);
    expect(words[0].isKeyword).toBe(true);
    expect(words[1].text).toBe('penthouse');
    expect(words[1].isKeyword).toBe(true);
    expect(words[2].text).toBe('balcony');
    expect(words[2].end).toBe(3);
    expect(words[2].isKeyword).toBe(false);
    expect(words[0].end).toBeCloseTo(words[1].start, 2);
    expect(words[1].end).toBeCloseTo(words[2].start, 2);
  });

  it('handles Hindi Devanagari text cleanly without splitting ligatures', () => {
    const words = splitCueIntoWords({ start: 1, end: 4, text: 'शानदार 3 BHK अपार्टमेंट' }, ['शानदार', 'अपार्टमेंट']);
    expect(words).toHaveLength(4);
    expect(words[0].text).toBe('शानदार');
    expect(words[0].isKeyword).toBe(true);
    expect(words[1].text).toBe('3');
    expect(words[2].text).toBe('BHK');
    expect(words[3].text).toBe('अपार्टमेंट');
    expect(words[3].isKeyword).toBe(true);
  });

  it('handles Punjabi Gurmukhi text cleanly', () => {
    const words = splitCueIntoWords({ start: 0.5, end: 2.5, text: 'ਸੁੰਦਰ ਕੋਠੀ ਮੋਹਾਲੀ ਵਿੱਚ' }, ['ਕੋਠੀ', 'ਮੋਹਾਲੀ']);
    expect(words).toHaveLength(4);
    expect(words[0].text).toBe('ਸੁੰਦਰ');
    expect(words[1].text).toBe('ਕੋਠੀ');
    expect(words[1].isKeyword).toBe(true);
    expect(words[2].text).toBe('ਮੋਹਾਲੀ');
    expect(words[2].isKeyword).toBe(true);
    expect(words[3].text).toBe('ਵਿੱਚ');
  });

  it('handles Hinglish mixed-script text with keyword matching', () => {
    const words = splitCueIntoWords({ start: 0, end: 2, text: 'Ye luxurious villa aapka ho sakta hai' }, ['luxurious', 'villa']);
    expect(words).toHaveLength(7);
    expect(words[1].text).toBe('luxurious');
    expect(words[1].isKeyword).toBe(true);
    expect(words[2].text).toBe('villa');
    expect(words[2].isKeyword).toBe(true);
    expect(words[0].isKeyword).toBe(false);
  });
});

describe('Video Lab captions from speech', () => {
  const speechInput: LabInput = {
    ...baseInput,
    clips: [
      { key: 'video-lab/assets/a.mp4', filename: 'a.mp4', cues: [{ start: 0.5, end: 2, text: 'clip A says hi' }] },
      { key: 'video-lab/assets/b.mp4', filename: 'b.mp4', cues: [{ start: 1, end: 3, text: 'clip B says hello' }] },
    ],
    captions: { language: 'hinglish', source: 'speech', lines: ['typed lines are ignored'], keywords: ['clip'] },
  };

  it('keeps each clip\'s cues with that clip when variants reorder clips', () => {
    const [a, b] = buildVariants(speechInput, 2);
    expect(a.captions).toMatchObject({ source: 'speech', lines: [] });
    expect(a.cuts.map((c) => c.cues?.[0].text)).toEqual(['clip A says hi', 'clip B says hello']);
    expect(b.cuts.map((c) => c.cues?.[0].text)).toEqual(['clip B says hello', 'clip A says hi']);
  });

  it('has no captions when no clip has speech', () => {
    const [v] = buildVariants({ ...speechInput, clips: speechInput.clips.map(({ cues: _c, ...c }) => c) }, 1);
    expect(v.captions).toBeNull();
  });

  it('cleans cues: sorts, drops empty text, removes overlaps, clamps to the clip, and generates word timings', () => {
    const out = cleanCues(
      [
        { start: 3, end: 9, text: 'last' },
        { start: 0, end: 2.5, text: 'first' },
        { start: 1, end: 1.2, text: '  ' },
        { start: 2, end: 2.1, text: 'short' },
      ],
      5,
      ['first']
    );
    expect(out).toHaveLength(3);
    expect(out[0]).toMatchObject({ start: 0, end: 1.95, text: 'first' });
    expect(out[0].words).toBeDefined();
    expect(out[0].words![0].text).toBe('first');
    expect(out[0].words![0].isKeyword).toBe(true);

    expect(out[1]).toMatchObject({ start: 2, end: 2.6, text: 'short' });
    expect(out[2]).toMatchObject({ start: 3, end: 5, text: 'last' });
  });

  it('shifts cues and word timings by where each clip starts on the merged timeline (minus crossfades)', () => {
    const cues = placeCuesOnTimeline(speechInput.clips, [6, 5], 0.4, ['clip']);
    expect(cues).toHaveLength(2);
    expect(cues[0]).toMatchObject({ start: 0.5, end: 2, text: 'clip A says hi' });
    expect(cues[0].words).toHaveLength(4);
    expect(cues[0].words![0].start).toBe(0.5);
    expect(cues[0].words![0].text).toBe('clip');
    expect(cues[0].words![0].isKeyword).toBe(true);

    expect(cues[1]).toMatchObject({ start: 6.6, end: 8.6, text: 'clip B says hello' });
    expect(cues[1].words).toHaveLength(4);
    expect(cues[1].words![0].start).toBe(6.6);
    expect(cues[1].words![0].text).toBe('clip');
    expect(cues[1].words![0].isKeyword).toBe(true);
  });
});

describe('Video Lab captions (ASS)', () => {
  it('picks the font from the script', () => {
    expect(fontForText('आपका घर')).toBe('Noto Sans Devanagari');
    expect(fontForText('ਤੁਹਾਡਾ ਘਰ')).toBe('Noto Sans Gurmukhi');
    expect(fontForText('Aapka ghar')).toBe('Noto Sans');
  });

  it('switches font inside mixed-script lines', () => {
    const out = withFontRuns('मोहाली में 3 BHK');
    expect(out).toContain('\\fnNoto Sans Devanagari');
    expect(out).toContain('\\fnNoto Sans\\fscx100');
    expect(out.indexOf('Noto Sans Devanagari')).toBeLessThan(out.indexOf('BHK'));
  });

  it('converts colours to ASS format', () => {
    expect(assColor('#C9A227')).toBe('&H0027A2C9');
    expect(assColor('#E05A47')).toBe('&H00475AE0');
  });

  it('spreads caption lines evenly and strips ASS override characters', () => {
    const ass = buildMainAss({
      durationSeconds: 10,
      captions: { language: 'en', style: 'BOXED', lines: ['First {\\b1} line', 'Second'] },
    })!;
    expect(ass).toContain('Dialogue: 1,0:00:00.00,0:00:04.95,CaptionBoxed');
    expect(ass).toContain('Dialogue: 1,0:00:05.00,0:00:09.95,CaptionBoxed');
    expect(ass).not.toContain('{\\b1}');
    expect(buildMainAss({ durationSeconds: 5, captions: null })).toBeNull();
  });

  it('uses timed speech cues instead of evenly spread lines', () => {
    const ass = buildMainAss({
      durationSeconds: 10,
      captions: { language: 'hi', style: 'OUTLINE', lines: [] },
      cues: [
        { start: 1.2, end: 3.15, text: 'मोहाली में' },
        { start: 12, end: 13, text: 'after the video ends' },
      ],
    })!;
    expect(ass).toContain('Dialogue: 1,0:00:01.20,0:00:03.15,CaptionOutline');
    expect(ass).not.toContain('after the video ends');
  });

  it('renders POP style with word-level highlight animation tags', () => {
    const cues = [
      {
        start: 1,
        end: 3,
        text: 'Modern luxury home',
        words: [
          { text: 'Modern', start: 1, end: 1.6, isKeyword: false },
          { text: 'luxury', start: 1.6, end: 2.3, isKeyword: true },
          { text: 'home', start: 2.3, end: 3, isKeyword: false },
        ],
      },
    ];
    const ass = buildMainAss({
      durationSeconds: 5,
      captions: { language: 'en', style: 'POP', lines: [] },
      cues,
      accentHex: '#FFD700',
    })!;
    expect(ass).toContain('Style: CaptionPop');
    expect(ass).toContain('Dialogue: 1,0:00:01.00,0:00:01.60,CaptionPop');
    expect(ass).toContain('Dialogue: 1,0:00:01.60,0:00:02.30,CaptionPop');
    expect(ass).toContain('Dialogue: 1,0:00:02.30,0:00:03.00,CaptionPop');
    // Active word has pop bounce animation tag
    expect(ass).toContain('\\t(0,100,\\fscx100\\fscy100)');
    // Accent color is used
    expect(ass).toContain(assColor('#FFD700'));
  });

  it('renders KARAOKE style with progressive word fills and dimmed upcoming words', () => {
    const cues = [
      {
        start: 0,
        end: 2,
        text: 'Beautiful prime location',
        words: [
          { text: 'Beautiful', start: 0, end: 0.7, isKeyword: false },
          { text: 'prime', start: 0.7, end: 1.3, isKeyword: true },
          { text: 'location', start: 1.3, end: 2.0, isKeyword: false },
        ],
      },
    ];
    const ass = buildMainAss({
      durationSeconds: 5,
      captions: { language: 'en', style: 'KARAOKE', lines: [] },
      cues,
      accentHex: '#C9A227',
    })!;
    expect(ass).toContain('Style: CaptionKaraoke');
    expect(ass).toContain('Dialogue: 1,0:00:00.00,0:00:00.70,CaptionKaraoke');
    // Spoken words are white, active word is accent, future words are dimmed
    expect(ass).toContain('&H70FFFFFF');
    expect(ass).toContain(assColor('#C9A227'));
  });

  it('renders SLIDE style with smooth vertical offset movement', () => {
    const cues = [
      {
        start: 0.5,
        end: 2.5,
        text: 'Prime real estate investment',
        words: [
          { text: 'Prime', start: 0.5, end: 1.0, isKeyword: false },
          { text: 'real', start: 1.0, end: 1.5, isKeyword: false },
          { text: 'estate', start: 1.5, end: 2.0, isKeyword: true },
          { text: 'investment', start: 2.0, end: 2.5, isKeyword: false },
        ],
      },
    ];
    const ass = buildMainAss({
      durationSeconds: 5,
      captions: { language: 'en', style: 'SLIDE', lines: [] },
      cues,
      accentHex: '#2563EB',
    })!;
    expect(ass).toContain('Style: CaptionSlide');
    expect(ass).toContain('\\move(540,1540,540,1500,0,200)\\fad(120,100)');
    // Keyword gets highlighted
    expect(ass).toContain(assColor('#2563EB'));
  });

  it('renders MINIMAL style with clean styling and accent keywords', () => {
    const cues = [
      {
        start: 0,
        end: 2,
        text: 'Exclusive gated community',
        words: [
          { text: 'Exclusive', start: 0, end: 0.8, isKeyword: true },
          { text: 'gated', start: 0.8, end: 1.4, isKeyword: false },
          { text: 'community', start: 1.4, end: 2.0, isKeyword: false },
        ],
      },
    ];
    const ass = buildMainAss({
      durationSeconds: 5,
      captions: { language: 'en', style: 'MINIMAL', lines: [] },
      cues,
      accentHex: '#10B981',
    })!;
    expect(ass).toContain('Style: CaptionMinimal');
    expect(ass).toContain(assColor('#10B981'));
  });

  it('shows phone and RERA on the end card only when provided', () => {
    const base = { seconds: 2, projectName: 'P', orgName: 'O', accentHex: '#C9A227', textHex: '#FFFFFF', hasLogo: false };
    const without = buildEndCardAss(base);
    expect(without).not.toContain('Call / WhatsApp');
    expect(without).not.toContain('RERA:');
    const withAll = buildEndCardAss({ ...base, phone: '+91 1', rera: 'R-1' });
    expect(withAll).toContain('Call / WhatsApp: +91 1');
    expect(withAll).toContain('RERA: R-1');
  });
});

describe('Video Lab recipe with AI Edit Director (Step 3)', () => {
  afterEach(() => {
    setAIProviderOverride(new MockAIProvider());
  });

  const brollInput: LabInput = {
    editing: 'smart',
    targetSeconds: 20,
    clips: [
      {
        key: 'video-lab/assets/presenter.mp4',
        filename: 'presenter.mp4',
        durationSeconds: 20,
        cues: [
          {
            start: 0.5,
            end: 2.2,
            text: 'Welcome to this luxury residence',
            words: [
              { text: 'Welcome', start: 0.5, end: 1.0 },
              { text: 'to', start: 1.0, end: 1.3 },
              { text: 'luxury', start: 1.3, end: 1.8 },
              { text: 'residence', start: 1.8, end: 2.2 },
            ],
          },
          {
            start: 3.5,
            end: 7.0,
            text: 'Yahan pe aapko milega modern modular kitchen',
            words: [
              { text: 'Yahan', start: 3.5, end: 4.0 },
              { text: 'pe', start: 4.0, end: 4.3 },
              { text: 'milega', start: 4.3, end: 4.8 },
              { text: 'modern', start: 4.8, end: 5.5 },
              { text: 'modular', start: 5.5, end: 6.2 },
              { text: 'kitchen', start: 6.2, end: 7.0 },
            ],
          },
          {
            start: 8.5,
            end: 12.0,
            text: 'Aur balcony se sundar scenic balcony view',
            words: [
              { text: 'Aur', start: 8.5, end: 9.0 },
              { text: 'balcony', start: 9.0, end: 9.6 },
              { text: 'se', start: 9.6, end: 10.0 },
              { text: 'sundar', start: 10.0, end: 10.8 },
              { text: 'scenic', start: 10.8, end: 11.4 },
              { text: 'view', start: 11.4, end: 12.0 },
            ],
          },
        ],
        shots: [
          {
            start: 0,
            end: 20,
            label: 'Presenter speech',
            category: 'PRESENTER',
            quality: 5,
            hookScore: 5,
            issues: [],
            hasSpeech: true,
            bestStart: 0,
            bestEnd: 20,
            keep: true,
            reason: 'Main presenter narration',
          },
        ],
      },
      {
        key: 'video-lab/assets/broll.mp4',
        filename: 'broll.mp4',
        durationSeconds: 15,
        shots: [
          {
            start: 0,
            end: 5,
            label: 'Modern modular kitchen',
            category: 'KITCHEN',
            quality: 5,
            hookScore: 4,
            issues: [],
            hasSpeech: false,
            bestStart: 0.5,
            bestEnd: 4.5,
            keep: true,
            reason: 'Kitchen shot',
          },
          {
            start: 6,
            end: 11,
            label: 'Scenic balcony view',
            category: 'BALCONY_VIEW',
            quality: 4,
            hookScore: 4,
            issues: [],
            hasSpeech: false,
            bestStart: 6.5,
            bestEnd: 10.5,
            keep: true,
            reason: 'Balcony shot',
          },
        ],
      },
    ],
    facts: { orgName: 'Real Estate Co', projectName: 'Golden Palms' },
    captions: { language: 'hinglish', source: 'speech', lines: [], keywords: ['kitchen', 'balcony'] },
  };

  it('buildVariantsWithDirector creates Recipe v3 with AI-directed B-roll overlays when Gemini succeeds', async () => {
    class SuccessfulAiProvider extends MockAIProvider {
      override async generateJson<T>(): Promise<T> {
        return {
          editorialTheme: 'Highlighting kitchen during narration',
          brollDecisions: [
            {
              shotId: 'shot_0',
              targetTimelineStart: 4.5,
              targetTimelineEnd: 7.0,
              spokenPhrase: 'modern modular kitchen',
              reason: 'Cutaway to kitchen as speaker describes it',
            },
          ],
        } as T;
      }
    }

    setAIProviderOverride(new SuccessfulAiProvider());

    const variants = await buildVariantsWithDirector(brollInput, 3);
    expect(variants).toHaveLength(3);

    for (const v of variants) {
      expect(v.version).toBe(3);
      expect(v.overlays).toBeDefined();
      expect(v.overlays!.length).toBeGreaterThanOrEqual(1);
      expect(v.overlays![0].source.key).toBe('video-lab/assets/broll.mp4');
      expect(v.overlays![0].label).toContain('Modern modular kitchen');
      // Continuous narration speech cuts intact
      expect(v.cuts).toHaveLength(1);
      expect(v.cuts[0].key).toBe('video-lab/assets/presenter.mp4');
    }

    // Variants maintain distinct caption styles
    expect(variants[0].captions?.style).toBe('POP');
    expect(variants[1].captions?.style).toBe('KARAOKE');
    expect(variants[2].captions?.style).toBe('SLIDE');
  });

  it('buildVariantsWithDirector safely falls back to Phase 2 deterministic planner when Gemini fails', async () => {
    class FailureMockProvider extends MockAIProvider {
      override async generateJson<T>(): Promise<T> {
        throw new Error('Gemini API 500 Internal Error');
      }
    }

    setAIProviderOverride(new FailureMockProvider());

    const variants = await buildVariantsWithDirector(brollInput, 2);
    expect(variants).toHaveLength(2);

    // Fallback succeeds and still produces Recipe v3 with B-roll overlays from Phase 2
    for (const v of variants) {
      expect(v.version).toBe(3);
      expect(v.overlays).toBeDefined();
      expect(v.overlays!.length).toBeGreaterThan(0);
      expect(v.overlays![0].source.key).toBe('video-lab/assets/broll.mp4');
    }
  });

  it('buildVariantsWithDirector falls back to standard cuts when no B-roll footage is present', async () => {
    const speechOnlyInput: LabInput = {
      ...brollInput,
      clips: [brollInput.clips[0]], // only presenter, no b-roll clip
    };

    const variants = await buildVariantsWithDirector(speechOnlyInput, 2);
    expect(variants).toHaveLength(2);
    for (const v of variants) {
      expect(v.version).toBe(2);
      expect(v.overlays).toBeUndefined();
    }
  });

  it('preserves existing synchronous buildVariants API unchanged', () => {
    const variants = buildVariants(brollInput, 2);
    expect(variants).toHaveLength(2);
    expect(variants[0].version).toBe(3);
    expect(variants[0].overlays).toBeDefined();
    expect(variants[0].overlays![0].decidedBy).toBe('rules');
  });

  it('allows explicit caption preset override per variant in buildVariants', () => {
    // Explicitly override Variant A with SLIDE and Variant B with MINIMAL
    const variants = buildVariants(brollInput, [
      { captionStyle: 'SLIDE' },
      { captionStyle: 'MINIMAL' },
      {}, // Variant C stays default (SLIDE)
    ]);

    expect(variants).toHaveLength(3);
    expect(variants[0].captions?.style).toBe('SLIDE');
    expect(variants[0].variant.label).toContain('slide speech captions');

    expect(variants[1].captions?.style).toBe('MINIMAL');
    expect(variants[1].variant.label).toContain('minimal speech captions');

    expect(variants[2].captions?.style).toBe('SLIDE'); // default for Variant C
  });

  it('allows explicit caption preset override in buildVariantsWithDirector and marks decidedBy: "ai"', async () => {
    class CustomAiDirectorMock extends MockAIProvider {
      override async generateJson<T>(): Promise<T> {
        return {
          editorialTheme: 'Highlighting kitchen during narration',
          brollDecisions: [
            {
              shotId: 'shot_0',
              targetTimelineStart: 4.5,
              targetTimelineEnd: 7.0,
              spokenPhrase: 'modern modular kitchen',
              reason: 'Matches kitchen speech',
            },
          ],
        } as T;
      }
    }

    setAIProviderOverride(new CustomAiDirectorMock());

    const variants = await buildVariantsWithDirector(brollInput, [
      { captionStyle: 'KARAOKE' }, // Variant A overridden to KARAOKE (default is POP)
    ]);

    expect(variants).toHaveLength(1);
    expect(variants[0].captions?.style).toBe('KARAOKE');
    expect(variants[0].variant.label).toContain('karaoke speech captions');
    expect(variants[0].overlays).toBeDefined();
    expect(variants[0].overlays!.length).toBeGreaterThanOrEqual(1);
    expect(variants[0].overlays![0].decidedBy).toBe('ai');
  });

  it('marks decidedBy: "rules" when AI director fails and falls back to deterministic planner', async () => {
    class FailingAiMock extends MockAIProvider {
      override async generateJson<T>(): Promise<T> {
        throw new Error('Gemini offline');
      }
    }

    setAIProviderOverride(new FailingAiMock());

    const variants = await buildVariantsWithDirector(brollInput, 1);
    expect(variants).toHaveLength(1);
    expect(variants[0].overlays).toBeDefined();
    expect(variants[0].overlays!.length).toBeGreaterThan(0);
    expect(variants[0].overlays![0].decidedBy).toBe('rules');
  });
});
