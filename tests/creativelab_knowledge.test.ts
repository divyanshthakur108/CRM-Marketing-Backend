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
