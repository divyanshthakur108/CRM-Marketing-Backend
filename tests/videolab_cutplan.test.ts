import { describe, it, expect } from 'vitest';
import { buildCutPlan, snapToSilence } from '../src/modules/videolab/cutPlan.js';
import { buildVariants, cuesForCut, ClipShot, LabInput } from '../src/modules/videolab/recipe.js';
import { normalizeShots, parseSceneCuts, parseSilences, pauseThreshold } from '../src/modules/videolab/analyze.js';

const shot = (over: Partial<ClipShot>): ClipShot => ({
  start: 0,
  end: 4,
  label: 'Shot',
  category: 'OTHER',
  quality: 3,
  hookScore: 2,
  issues: [],
  hasSpeech: false,
  bestStart: over.start ?? 0,
  bestEnd: over.end ?? 4,
  keep: true,
  reason: '',
  ...over,
});

describe('Smart cut plan', () => {
  const broll = {
    key: 'video-lab/assets/broll.mp4',
    shots: [
      shot({ start: 0, end: 3, label: 'Kitchen', category: 'KITCHEN', quality: 3 }),
      shot({ start: 3, end: 6, label: 'Drone over tower', category: 'AERIAL', quality: 5, hookScore: 5 }),
      shot({ start: 6, end: 9, label: 'Floor by accident', keep: false }),
      shot({ start: 9, end: 20, label: 'Long living room pan', category: 'LIVING', quality: 4, bestStart: 10, bestEnd: 19 }),
      shot({ start: 20, end: 24, label: 'Bedroom with watermark', category: 'BEDROOM', quality: 4, hookScore: 5, issues: ['text_or_watermark'] }),
    ],
  };

  it('skips shots marked cut, uses the best part, caps long shots and follows the property-tour order', () => {
    const plan = buildCutPlan([broll], { targetSeconds: 60, style: 'STORY', transitionSeconds: 0.25 });
    expect(plan.map((c) => c.label)).toEqual(['Drone over tower', 'Long living room pan', 'Kitchen', 'Bedroom with watermark']);
    const living = plan.find((c) => c.label === 'Long living room pan')!;
    expect(living).toMatchObject({ start: 10, end: 14.5 }); // best part, max 4.5 s
    expect(plan.some((c) => c.label === 'Floor by accident')).toBe(false);
  });

  it('stops adding shots at the target length, best shots first', () => {
    const plan = buildCutPlan([broll], { targetSeconds: 6, style: 'STORY', transitionSeconds: 0.25 });
    expect(plan.map((c) => c.label)).toEqual(['Drone over tower', 'Long living room pan']);
  });

  it('opens with the strongest shot without problems for HOOK_FIRST', () => {
    const plan = buildCutPlan([broll], { targetSeconds: 60, style: 'HOOK_FIRST', transitionSeconds: 0.25 });
    expect(plan[0].label).toBe('Drone over tower');
    expect(plan[0].end - plan[0].start).toBeLessThanOrEqual(2.5);
  });

  it('keeps speech in order, never cuts mid-word, and joins speech that continues', () => {
    const talk = {
      key: 'video-lab/assets/talk.mp4',
      silences: [
        { start: 4.6, end: 5.1 },
        { start: 9.8, end: 10.3 },
      ],
      shots: [
        shot({ start: 0, end: 5.3, label: 'Intro', category: 'PRESENTER', hasSpeech: true }),
        shot({ start: 5.3, end: 10, label: 'Kitchen talk', category: 'KITCHEN', hasSpeech: true }),
      ],
    };
    const plan = buildCutPlan([talk], { targetSeconds: 30, style: 'STORY', transitionSeconds: 0.25 });
    // 5.3 is mid-word → moved back to the pause ending at 5.1; both shots continue each other → one cut
    expect(plan).toEqual([{ key: talk.key, start: 0, end: 10, label: 'Intro → Kitchen talk' }]);
  });

  it('puts b-roll between speech blocks', () => {
    const talk = {
      key: 'video-lab/assets/talk.mp4',
      shots: [
        shot({ start: 0, end: 4, label: 'Hello', hasSpeech: true }),
        shot({ start: 20, end: 24, label: 'Silent pan', category: 'LIVING' }),
        shot({ start: 8, end: 12, label: 'Book a visit', hasSpeech: true }),
      ],
    };
    const plan = buildCutPlan([talk, broll], { targetSeconds: 20, style: 'STORY', transitionSeconds: 0.25 });
    expect(plan[0].label).toBe('Hello');
    expect(plan.findIndex((c) => c.label === 'Book a visit')).toBeGreaterThan(1);
  });

  it('snaps to the nearest pause only when it is close', () => {
    const silences = [{ start: 2, end: 2.5 }];
    expect(snapToSilence(2.8, silences)).toBe(2.5);
    expect(snapToSilence(2.2, silences)).toBe(2.2);
    expect(snapToSilence(5, silences)).toBe(5);
  });

  it('builds smart variants with re-timed captions for each cut', () => {
    const input: LabInput = {
      clips: [{ ...broll, filename: 'broll.mp4', cues: [{ start: 3.5, end: 5, text: 'Drone shot' }] }],
      facts: { orgName: 'O', projectName: 'P' },
      captions: { language: 'en', source: 'speech', lines: [] },
      editing: 'smart',
      targetSeconds: 15,
    };
    const [a] = buildVariants(input, 1);
    expect(a.editing).toBe('smart');
    expect(a.cuts[0]).toMatchObject({ start: 3, end: 6, label: 'Drone over tower', cues: [{ start: 0.5, end: 2, text: 'Drone shot' }] });
  });

  it('keeps a caption in a cut only if most of it is inside', () => {
    const cues = [
      { start: 0, end: 2, text: 'before' },
      { start: 4.5, end: 6, text: 'half in' },
      { start: 6, end: 7, text: 'inside' },
    ];
    expect(cuesForCut(cues, 5, 8)).toEqual([
      { start: 0, end: 0.95, text: 'half in' },
      { start: 1, end: 2, text: 'inside' },
    ]);
  });
});

describe('Clip understanding helpers', () => {
  it('reads scene cuts and ignores flashes', () => {
    expect(parseSceneCuts('frame:1 pts:1 pts_time:2.4\nframe:2 pts:2 pts_time:2.6\nframe:3 pts:3 pts_time:7.05')).toEqual([2.4, 7.05]);
  });

  it('reads pauses, including one that runs to the end', () => {
    const text = 'lavfi.silence_start=1.2\nlavfi.silence_end=1.8\nlavfi.silence_start=9.5\n';
    expect(parseSilences(text, 10)).toEqual([
      { start: 1.2, end: 1.8 },
      { start: 9.5, end: 10 },
    ]);
  });

  it('sets the pause threshold from the clip loudness', () => {
    expect(pauseThreshold('RMS_level=-15\nRMS_level=-14\nRMS_level=-16\nRMS_level=-inf')).toBe(-18);
    expect(pauseThreshold('')).toBe(-35);
  });

  it('cleans Gemini shots: valid values, snapped to hard cuts, no gaps, tiny shots merged', () => {
    const shots = normalizeShots(
      [
        { start: 0.2, end: 3.9, label: 'A', category: 'KITCHEN', quality: 9, hookScore: 'x', issues: ['shaky', 'made_up'], hasSpeech: true, bestStart: -1, bestEnd: 3, keep: true },
        { start: 4.3, end: 4.5, label: 'Flash', category: 'NOPE' },
        { start: 4.5, end: 8, label: 'B', category: 'AERIAL', keep: false },
      ],
      8,
      [4.0]
    , false);
    // Both the flash and B start near the hard cut at 4.0 → the flash disappears, B starts exactly at the cut
    expect(shots).toHaveLength(2);
    expect(shots[0]).toMatchObject({ start: 0, end: 4, category: 'KITCHEN', quality: 5, hookScore: 2, issues: ['shaky'], hasSpeech: false, bestStart: 0, bestEnd: 3 });
    expect(shots[1]).toMatchObject({ start: 4, end: 8, category: 'AERIAL', keep: false });
  });
});
