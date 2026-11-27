import { describe, it, expect } from 'vitest';
import {
  buildImagePrompt,
  buildVideoPrompt,
  cleanBrief,
  cleanIdeaUses,
  cleanImageKnowledge,
  cleanTranscript,
  cleanVideoKnowledge,
  cleanVideoShots,
} from '../src/modules/creativelab/knowledge.js';

describe('Creative Lab knowledge cards', () => {
  it('brief keeps only written facts and turns "not mentioned" into null', () => {
    const brief = cleanBrief({
      projectName: 'Green Heights',
      city: 'Mohali',
      price: 'not mentioned',
      reraNumber: 'N/A',
      configurations: ['3 BHK', '3 BHK', '4 BHK', 7],
      nearbyPlaces: [{ name: 'Airport', distance: '15 min' }, { name: '' }, { name: 'School' }],
      missingFacts: ['price', 'RERA number'],
    });
    expect(brief.projectName).toBe('Green Heights');
    expect(brief.price).toBeNull();
    expect(brief.reraNumber).toBeNull();
    expect(brief.developer).toBeNull();
    expect(brief.configurations).toEqual(['3 BHK', '4 BHK', '7']);
    expect(brief.nearbyPlaces).toEqual([
      { name: 'Airport', distance: '15 min' },
      { name: 'School', distance: null },
    ]);
    expect(brief.missingFacts).toEqual(['price', 'RERA number']);
  });

  it('idea uses: only known ideas, no duplicates, capped', () => {
    const uses = cleanIdeaUses(
      [
        { idea: 'drone_reveal', why: 'tall tower' },
        { idea: 'drone_reveal', why: 'again' },
        { idea: 'made_up_idea', why: 'x' },
        { idea: 'day_to_night', why: 'clear sky' },
        'junk',
      ],
      5
    );
    expect(uses.map((u) => u.idea)).toEqual(['drone_reveal', 'day_to_night']);
  });

  it('image card: unknown enums fall back, scores clamped, junk ignored', () => {
    const card = cleanImageKnowledge({
      title: 'Front elevation',
      sourceType: 'PAINTING',
      space: 'EXTERIOR_ELEVATION',
      quality: { score: 9, issues: ['blurry', 'not_an_issue'] },
      animation: { imageToVideoScore: -3 },
      people: { count: 2 },
      bestUses: [{ idea: 'drone_reveal', why: 'tall' }],
    });
    expect(card.kind).toBe('image');
    expect(card.sourceType).toBe('UNSURE');
    expect(card.space).toBe('EXTERIOR_ELEVATION');
    expect(card.quality).toEqual({ score: 5, issues: ['blurry'] });
    expect(card.animation.imageToVideoScore).toBe(1);
    expect(card.people.present).toBe(true);
    expect(card.bestUses).toHaveLength(1);
  });

  it('image card from an empty answer still has a valid shape', () => {
    const card = cleanImageKnowledge(null);
    expect(card.title).toBe('Untitled image');
    expect(card.space).toBe('OTHER');
    expect(card.tags).toEqual([]);
  });

  it('video shots: contiguous, snapped to hard cuts, tiny shots merged, best part inside the shot', () => {
    const shots = cleanVideoShots(
      [
        { start: 0.3, end: 4, title: 'Gate', bestStart: 1, bestEnd: 3.5 },
        { start: 4.4, end: 4.6, title: 'Flash' },
        { start: 4.6, end: 10, title: 'Lobby', bestStart: 20, bestEnd: 25 },
      ],
      10,
      [4.1]
    );
    expect(shots.map((s) => [s.start, s.end])).toEqual([
      [0, 4.1],
      [4.1, 10],
    ]);
    expect(shots[0].bestStart).toBe(1);
    // best part outside the shot: whole shot is used
    expect([shots[1].bestStart, shots[1].bestEnd]).toEqual([4.1, 10]);
  });

  it('transcript: sorted, inside the clip, end after start', () => {
    const lines = cleanTranscript(
      [
        { start: 5, end: 7, text: 'second' },
        { start: 1, end: 0.5, text: 'first' },
        { start: 50, end: 52, text: 'beyond the clip' },
        { start: 2, end: 3, text: '' },
      ],
      30
    );
    expect(lines).toEqual([
      { start: 1, end: 3, text: 'first' },
      { start: 5, end: 7, text: 'second' },
    ]);
  });

  it('video card: no speech or music claimed when the clip has no audio', () => {
    const card = cleanVideoKnowledge(
      { speech: { hasSpeech: true, transcript: [{ start: 0, end: 1, text: 'hello' }] }, hasMusic: true, shots: [{ start: 0, end: 5 }] },
      { durationSeconds: 5, analyzedSeconds: 5, sceneCuts: [], hasAudio: false }
    );
    expect(card.speech.hasSpeech).toBe(false);
    expect(card.speech.transcript).toEqual([]);
    expect(card.hasMusic).toBe(false);
    expect(card.shots).toHaveLength(1);
  });

  it('prompts include the project facts and forbid guessing', () => {
    const brief = cleanBrief({ projectName: 'Green Heights', floors: 'G+12' });
    const imagePrompt = buildImagePrompt(brief);
    expect(imagePrompt).toContain('Green Heights');
    expect(imagePrompt).toContain('Describe only what is actually visible');
    const videoPrompt = buildVideoPrompt({ analyzedSeconds: 20, sceneCuts: [3.5], hasAudio: true, brief });
    expect(videoPrompt).toContain('3.50');
    expect(videoPrompt).toContain('Transcript');
  });
});

describe('nearby places + map card prompt', () => {
  it('keeps valid rows and rejects rows without time or distance', async () => {
    const { cleanPlaces } = await import('../src/modules/creativelab/knowledge.js');
    const places = cleanPlaces([
      { name: '  Mohali   Airport ', time: { value: '15', unit: 'min' }, distance: { value: 12, unit: 'km' } },
      { name: 'PGI', time: { value: 1.5, unit: 'hr' } },
      { name: 'Quark City', distance: { value: 800, unit: 'm' } },
    ]);
    expect(places).toEqual([
      { name: 'Mohali Airport', time: { value: 15, unit: 'min' }, distance: { value: 12, unit: 'km' } },
      { name: 'PGI', time: { value: 1.5, unit: 'hr' } },
      { name: 'Quark City', distance: { value: 800, unit: 'm' } },
    ]);
    expect(() => cleanPlaces([{ name: 'Mall' }])).toThrow(/add a time or a distance/);
    expect(() => cleanPlaces([{ name: '', time: { value: 5, unit: 'min' } }])).toThrow(/name is required/);
    expect(() => cleanPlaces(Array.from({ length: 9 }, () => ({ name: 'x', time: { value: 1 } })))).toThrow(/Up to 8/);
  });

  it('puts every place and number in the prompt exactly, and the variant changes the style', async () => {
    const { buildMapCardPrompt, formatPlaceChip } = await import('../src/modules/creativelab/knowledge.js');
    const places = [
      { name: 'Mohali Airport', time: { value: 15, unit: 'min' as const }, distance: { value: 12, unit: 'km' as const } },
      { name: 'PGI', time: { value: 1, unit: 'hr' as const } },
    ];
    expect(formatPlaceChip(places[0])).toBe('15 min · 12 km');
    expect(formatPlaceChip(places[1])).toBe('1 hr');
    const a = buildMapCardPrompt({ projectName: 'TDI Wellington Heights 2', locality: 'Sector 117, Mohali', places, hasLogo: true, variant: 0 });
    expect(a).toContain('"Mohali Airport" with the chip "15 min · 12 km"');
    expect(a).toContain('"PGI" with the chip "1 hr"');
    expect(a).toContain('Not to scale');
    expect(a).toContain('attached logo');
    const b = buildMapCardPrompt({ projectName: 'TDI Wellington Heights 2', places, hasLogo: false, variant: 1 });
    expect(b).not.toEqual(a);
    expect(b).toContain('No logo');
  });
});

describe('map card directions and 3D style', () => {
  it('keeps a valid direction, drops a bad one, and puts it in the prompt', async () => {
    const { cleanPlaces, buildMapCardPrompt } = await import('../src/modules/creativelab/knowledge.js');
    const places = cleanPlaces([
      { name: 'Mohali Airport', direction: 'NE', time: { value: 10, unit: 'min' } },
      { name: 'Bus Stand', direction: 'UP', distance: { value: 2, unit: 'km' } },
    ]);
    expect(places[0].direction).toBe('NE');
    expect(places[1].direction).toBeUndefined();
    const p = buildMapCardPrompt({ projectName: 'X', places, hasLogo: false, style: '3d' });
    expect(p).toContain('north-east');
    expect(p).toContain('North is up');
    expect(p).toContain('3D ');
    expect(buildMapCardPrompt({ projectName: 'X', places: [places[1]], hasLogo: false })).toContain('do not add a compass');
  });
});

describe('free map card (background + our own text)', () => {
  it('lays out places by direction, then fills free slots without overlap', async () => {
    const { layoutPlaces } = await import('../src/modules/creativelab/mapCardRender.js');
    const out = layoutPlaces([
      { name: 'A', direction: 'NE', time: { value: 1, unit: 'min' } },
      { name: 'B', time: { value: 2, unit: 'min' } },
      { name: 'C', direction: 'NE', time: { value: 3, unit: 'min' } },
    ]);
    expect(out.map((o) => o.slot)).toEqual(['NE', 'NW', 'SW']);
    expect(new Set(out.map((o) => o.slot)).size).toBe(3);
  });

  it('draws every name and chip exactly (escaped) and renders a 1080x1920 PNG', async () => {
    const { buildOverlaySvg, renderMapCard } = await import('../src/modules/creativelab/mapCardRender.js');
    const { buildMapScenePrompt } = await import('../src/modules/creativelab/knowledge.js');
    const places = [{ name: 'Mall & Co <1>', time: { value: 15, unit: 'min' as const }, distance: { value: 12, unit: 'km' as const } }];
    const svg = buildOverlaySvg({ projectName: 'Green Heights', locality: 'Sector 82, Mohali', places, hasLogo: false });
    expect(svg).toContain('Mall &amp; Co &lt;1&gt;');
    expect(svg).toContain('15 min · 12 km');
    expect(svg).toContain('Not to scale');
    expect(buildMapScenePrompt('3d', 0)).toMatch(/no text/);
    const sharp = (await import('sharp')).default;
    const bg = await sharp({ create: { width: 256, height: 256, channels: 3, background: '#e8d5b0' } }).jpeg().toBuffer();
    const png = await renderMapCard({ background: bg, projectName: 'Green Heights', places });
    const meta = await sharp(png).metadata();
    expect([meta.width, meta.height]).toEqual([1080, 1920]);
  });
});
