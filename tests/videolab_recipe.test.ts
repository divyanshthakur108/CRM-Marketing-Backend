import { describe, it, expect } from 'vitest';
import { buildVariants, cleanCues, placeCuesOnTimeline, LabInput } from '../src/modules/videolab/recipe.js';
import { buildEndCardAss, buildMainAss, fontForText, withFontRuns, assColor } from '../src/modules/videolab/ass.js';

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

describe('Video Lab captions from speech', () => {
  const speechInput: LabInput = {
    ...baseInput,
    clips: [
      { key: 'video-lab/assets/a.mp4', filename: 'a.mp4', cues: [{ start: 0.5, end: 2, text: 'clip A says hi' }] },
      { key: 'video-lab/assets/b.mp4', filename: 'b.mp4', cues: [{ start: 1, end: 3, text: 'clip B says hello' }] },
    ],
    captions: { language: 'hinglish', source: 'speech', lines: ['typed lines are ignored'] },
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

  it('cleans cues: sorts, drops empty text, removes overlaps, clamps to the clip', () => {
    const out = cleanCues(
      [
        { start: 3, end: 9, text: 'last' },
        { start: 0, end: 2.5, text: 'first' },
        { start: 1, end: 1.2, text: '  ' },
        { start: 2, end: 2.1, text: 'short' },
      ],
      5
    );
    expect(out).toEqual([
      { start: 0, end: 1.95, text: 'first' },
      { start: 2, end: 2.6, text: 'short' },
      { start: 3, end: 5, text: 'last' },
    ]);
  });

  it('shifts cues by where each clip starts on the merged timeline (minus crossfades)', () => {
    const cues = placeCuesOnTimeline(speechInput.clips, [6, 5], 0.4);
    expect(cues).toEqual([
      { start: 0.5, end: 2, text: 'clip A says hi' },
      { start: 6.6, end: 8.6, text: 'clip B says hello' },
    ]);
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
