import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  identifyBrollPool,
  buildEditSheet,
  proposeAiEdit,
  isVisuallyRelevant,
  validateAiProposal,
  planSmartEditsWithDirector,
  AiEditProposal,
  IdentifiedBrollShot,
} from '../src/modules/videolab/editDirector.js';
import { CaptionCue, LabClip } from '../src/modules/videolab/recipe.js';
import { buildBrollPlan } from '../src/modules/videolab/brollPlan.js';
import { setAIProviderOverride, IAIProvider } from '../src/modules/ai/providers/index.js';
import { MockAIProvider } from './fakes/fakeAIProvider.js';

describe('Video Lab AI Edit Director - Step 2 Comprehensive Unit Tests', () => {
  // Shared mock test data
  const sampleClips: LabClip[] = [
    {
      key: 'presenter_speech.mp4',
      durationSeconds: 20,
      shots: [
        {
          start: 0,
          end: 20,
          label: 'Presenter speaking',
          category: 'PRESENTER',
          quality: 5,
          hookScore: 5,
          issues: [],
          hasSpeech: true,
          bestStart: 0,
          bestEnd: 20,
          keep: true,
          reason: 'Main A-roll presenter narration',
        },
      ],
    },
    {
      key: 'broll_footage.mp4',
      durationSeconds: 15,
      shots: [
        {
          start: 0,
          end: 4.5,
          label: 'Modular kitchen with granite island',
          category: 'KITCHEN',
          quality: 5,
          hookScore: 4,
          issues: [],
          hasSpeech: false,
          bestStart: 0.5,
          bestEnd: 4.0,
          keep: true,
          reason: 'Clear shot of kitchen',
        },
        {
          start: 5.0,
          end: 9.5,
          label: 'Scenic balcony view of green valley',
          category: 'BALCONY_VIEW',
          quality: 4,
          hookScore: 4,
          issues: [],
          hasSpeech: false,
          bestStart: 5.5,
          bestEnd: 9.0,
          keep: true,
          reason: 'Bright balcony view',
        },
        {
          start: 10.0,
          end: 14.5,
          label: 'Olympic size swimming pool',
          category: 'AMENITY',
          quality: 5,
          hookScore: 3,
          issues: [],
          hasSpeech: false,
          bestStart: 10.5,
          bestEnd: 14.0,
          keep: true,
          reason: 'Luxury pool amenity',
        },
      ],
    },
  ];

  const sampleSpeechCues: CaptionCue[] = [
    {
      start: 0.2,
      end: 2.4,
      text: 'Namaste and welcome to this luxury flat',
      words: [
        { text: 'Namaste', start: 0.2, end: 0.7 },
        { text: 'and', start: 0.7, end: 0.9 },
        { text: 'welcome', start: 0.9, end: 1.4 },
        { text: 'to', start: 1.4, end: 1.6 },
        { text: 'this', start: 1.6, end: 1.8 },
        { text: 'luxury', start: 1.8, end: 2.1 },
        { text: 'flat', start: 2.1, end: 2.4 },
      ],
    },
    {
      start: 2.8,
      end: 6.2,
      text: 'Yahan pe aapko milega modern modular kitchen',
      words: [
        { text: 'Yahan', start: 2.8, end: 3.2 },
        { text: 'pe', start: 3.2, end: 3.4 },
        { text: 'aapko', start: 3.4, end: 3.8 },
        { text: 'milega', start: 3.8, end: 4.2 },
        { text: 'modern', start: 4.2, end: 4.7 },
        { text: 'modular', start: 4.7, end: 5.3 },
        { text: 'kitchen', start: 5.3, end: 6.2 },
      ],
    },
    {
      start: 7.8,
      end: 11.5,
      text: 'Aur balcony se sundar scenic balcony view',
      words: [
        { text: 'Aur', start: 7.8, end: 8.2 },
        { text: 'balcony', start: 8.2, end: 8.8 },
        { text: 'se', start: 8.8, end: 9.1 },
        { text: 'sundar', start: 9.1, end: 9.6 },
        { text: 'scenic', start: 9.6, end: 10.2 },
        { text: 'balcony', start: 10.2, end: 10.8 },
        { text: 'view', start: 10.8, end: 11.5 },
      ],
    },
    {
      start: 13.0,
      end: 16.5,
      text: 'Clubhouse mein luxury swimming pool bhi hai',
      words: [
        { text: 'Clubhouse', start: 13.0, end: 13.8 },
        { text: 'mein', start: 13.8, end: 14.1 },
        { text: 'luxury', start: 14.1, end: 14.6 },
        { text: 'swimming', start: 14.6, end: 15.3 },
        { text: 'pool', start: 15.3, end: 15.8 },
        { text: 'bhi', start: 15.8, end: 16.1 },
        { text: 'hai', start: 16.1, end: 16.5 },
      ],
    },
    {
      start: 17.5,
      end: 19.5,
      text: 'Call now for site visit booking',
      words: [
        { text: 'Call', start: 17.5, end: 17.9 },
        { text: 'now', start: 17.9, end: 18.3 },
        { text: 'for', start: 18.3, end: 18.6 },
        { text: 'site', start: 18.6, end: 19.0 },
        { text: 'visit', start: 19.0, end: 19.5 },
      ],
    },
  ];

  const totalNarrationDuration = 20.0;

  // --------------------------------------------------------------------------
  // 1. Edit Sheet Tests
  // --------------------------------------------------------------------------
  describe('1. Edit Sheet Tests', () => {
    it('verifies narration transcript formatting and timestamps', () => {
      const pool = identifyBrollPool([
        {
          key: 'broll_footage.mp4',
          start: 0,
          end: 4.5,
          category: 'KITCHEN',
          label: 'Modular kitchen',
          quality: 5,
        },
      ]);

      const sheet = buildEditSheet({
        projectName: 'Royal Heights',
        orgName: 'Prestige Realty',
        language: 'Hinglish',
        targetSeconds: 20,
        speechCues: sampleSpeechCues,
        identifiedPool: pool,
        totalNarrationDuration,
      });

      // Narration lines formatted as [start.toFixed(1)s - end.toFixed(1)s]: "text"
      expect(sheet).toContain('[0.2s - 2.4s]: "Namaste and welcome to this luxury flat"');
      expect(sheet).toContain('[2.8s - 6.2s]: "Yahan pe aapko milega modern modular kitchen"');
      expect(sheet).toContain('Total Narration: 20.0s');
      expect(sheet).toContain('Project: Royal Heights | Agency: Prestige Realty | Language: Hinglish');
    });

    it('verifies final-timeline timestamps and stable B-roll shot IDs', () => {
      const rawPool = [
        {
          key: 'broll_footage.mp4',
          start: 0,
          end: 4.5,
          category: 'KITCHEN' as const,
          label: 'Modular kitchen',
          quality: 5,
        },
        {
          key: 'broll_footage.mp4',
          start: 5.0,
          end: 9.5,
          category: 'BALCONY_VIEW' as const,
          label: 'Balcony view',
          quality: 4,
        },
      ];

      const identified = identifyBrollPool(rawPool);
      expect(identified[0].shotId).toBe('shot_0');
      expect(identified[1].shotId).toBe('shot_1');

      const sheet = buildEditSheet({
        speechCues: sampleSpeechCues,
        identifiedPool: identified,
        totalNarrationDuration,
      });

      expect(sheet).toContain('[shot_0] Category: KITCHEN | Dur: 4.5s | Quality: 5/5 | Label: Modular kitchen');
      expect(sheet).toContain('[shot_1] Category: BALCONY_VIEW | Dur: 4.5s | Quality: 4/5 | Label: Balcony view');
    });

    it('verifies editorial constraints are included in the instructions', () => {
      const sheet = buildEditSheet({
        speechCues: sampleSpeechCues,
        identifiedPool: [],
        totalNarrationDuration,
      });

      // Hook rule
      expect(sheet).toContain('1. The first 2.5s MUST show the presenter\'s face (the hook)');
      // Cutaway duration rule
      expect(sheet).toContain('2. Each B-roll cutaway must last between 1.5s and 4.0s');
      // Resurface face rule
      expect(sheet).toContain('3. Keep at least 1.5s of presenter face visible between consecutive B-roll cutaways');
      // Budget rule
      expect(sheet).toContain('4. Total B-roll cutaway duration must NOT exceed 60% of total narration time');
      // No reuse rule
      expect(sheet).toContain('6. Never reuse the same shot ID twice');
      // End card protection
      expect(sheet).toContain('7. Do not schedule B-roll within 1.0s of the narration end');
    });

    it('handles missing or empty B-Roll footage cleanly in the edit sheet', () => {
      const sheet = buildEditSheet({
        speechCues: sampleSpeechCues,
        identifiedPool: [],
        totalNarrationDuration,
      });

      expect(sheet).toContain('=== AVAILABLE B-ROLL FOOTAGE POOL ===');
      expect(sheet).toContain('No B-roll available.');
    });

    it('verifies the prompt remains concise and well under token limits', () => {
      const rawPool = [
        { key: 'broll.mp4', start: 0, end: 4, category: 'KITCHEN' as const, label: 'Kitchen', quality: 5 },
        { key: 'broll.mp4', start: 4, end: 8, category: 'BEDROOM' as const, label: 'Bedroom', quality: 4 },
        { key: 'broll.mp4', start: 8, end: 12, category: 'BALCONY_VIEW' as const, label: 'Balcony', quality: 5 },
      ];
      const identified = identifyBrollPool(rawPool);
      const sheet = buildEditSheet({
        speechCues: sampleSpeechCues,
        identifiedPool: identified,
        totalNarrationDuration,
      });

      // The sheet should be concise: typically ~1500 to 2500 characters (< 600 tokens)
      expect(sheet.length).toBeLessThan(3000);
      expect(sheet.length).toBeGreaterThan(500);
    });
  });

  // --------------------------------------------------------------------------
  // 2. AI Proposal Validation Tests
  // --------------------------------------------------------------------------
  describe('2. AI Proposal Validation Tests', () => {
    let identifiedPool: IdentifiedBrollShot[];

    beforeEach(() => {
      identifiedPool = identifyBrollPool([
        {
          key: 'broll_footage.mp4',
          start: 0,
          end: 4.5,
          category: 'KITCHEN',
          label: 'Modular kitchen with granite island',
          quality: 5,
        },
        {
          key: 'broll_footage.mp4',
          start: 5.0,
          end: 9.5,
          category: 'BALCONY_VIEW',
          label: 'Scenic balcony view of green valley',
          quality: 4,
        },
        {
          key: 'broll_footage.mp4',
          start: 10.0,
          end: 14.5,
          category: 'AMENITY',
          label: 'Olympic size swimming pool',
          quality: 5,
        },
      ]);
    });

    it('accepts valid B-roll decisions with proper bounds, style, and motion', () => {
      const proposal: AiEditProposal = {
        editorialTheme: 'Highlighting high-end kitchen and scenic balcony',
        brollDecisions: [
          {
            shotId: 'shot_0',
            targetTimelineStart: 4.2,
            targetTimelineEnd: 6.2,
            spokenPhrase: 'modern modular kitchen',
            reason: 'Visual match for modular kitchen',
          },
        ],
      };

      const overlays = validateAiProposal({
        proposal,
        clips: sampleClips,
        identifiedPool,
        speechCues: sampleSpeechCues,
        totalNarrationDuration,
      });

      expect(overlays).toHaveLength(1);
      const overlay = overlays[0];
      expect(overlay.style).toBe('FULL');
      expect(overlay.motion).toBe('ZOOM_IN');
      expect(overlay.source.key).toBe('broll_footage.mp4');
      expect(overlay.source.in).toBe(0);
      expect(overlay.source.out).toBeGreaterThan(overlay.source.in);
      expect(overlay.start).toBeGreaterThanOrEqual(2.5); // hook respected
      expect(overlay.end).toBeLessThanOrEqual(totalNarrationDuration);
    });

    it('correctly maps stable shot IDs to exact B-roll clip metadata', () => {
      const proposal: AiEditProposal = {
        brollDecisions: [
          {
            shotId: 'shot_1', // Balcony shot (start: 5.0, end: 9.5)
            targetTimelineStart: 8.2,
            targetTimelineEnd: 11.2,
            spokenPhrase: 'scenic balcony view',
            reason: 'Shows beautiful balcony view',
          },
        ],
      };

      const overlays = validateAiProposal({
        proposal,
        clips: sampleClips,
        identifiedPool,
        speechCues: sampleSpeechCues,
        totalNarrationDuration,
      });

      expect(overlays).toHaveLength(1);
      expect(overlays[0].source.key).toBe('broll_footage.mp4');
      expect(overlays[0].source.in).toBe(5.0); // Exact shot_1 in point
      expect(overlays[0].label).toContain('Scenic balcony view');
    });

    it('rejects unknown or hallucinated shot IDs', () => {
      const proposal: AiEditProposal = {
        brollDecisions: [
          {
            shotId: 'shot_99_hallucinated',
            targetTimelineStart: 4.0,
            targetTimelineEnd: 6.0,
            spokenPhrase: 'modular kitchen',
          },
        ],
      };

      const overlays = validateAiProposal({
        proposal,
        clips: sampleClips,
        identifiedPool,
        speechCues: sampleSpeechCues,
        totalNarrationDuration,
      });

      expect(overlays).toHaveLength(0);
    });

    it('rejects invalid source timestamps (negative or NaN)', () => {
      const invalidPool: IdentifiedBrollShot[] = [
        {
          shotId: 'shot_invalid_start',
          key: 'broll_footage.mp4',
          start: -2.0, // Invalid negative start
          end: 4.0,
          category: 'KITCHEN',
          label: 'Modular kitchen',
          quality: 5,
        },
      ];

      const proposal: AiEditProposal = {
        brollDecisions: [
          {
            shotId: 'shot_invalid_start',
            targetTimelineStart: 4.5,
            targetTimelineEnd: 6.5,
            spokenPhrase: 'modular kitchen',
          },
        ],
      };

      const overlays = validateAiProposal({
        proposal,
        clips: sampleClips,
        identifiedPool: invalidPool,
        speechCues: sampleSpeechCues,
        totalNarrationDuration,
      });

      expect(overlays).toHaveLength(0);
    });

    it('rejects negative timeline decision timestamps (targetTimelineStart < 0)', () => {
      const proposal: AiEditProposal = {
        brollDecisions: [
          {
            shotId: 'shot_0',
            targetTimelineStart: -3.5, // Invalid negative timeline start
            targetTimelineEnd: 2.0,
            spokenPhrase: 'modular kitchen',
          },
        ],
      };

      const overlays = validateAiProposal({
        proposal,
        clips: sampleClips,
        identifiedPool,
        speechCues: sampleSpeechCues,
        totalNarrationDuration,
      });

      expect(overlays).toHaveLength(0);
    });

    it('rejects source timestamps exceeding clip duration', () => {
      const exceedingPool: IdentifiedBrollShot[] = [
        {
          shotId: 'shot_exceeding',
          key: 'broll_footage.mp4',
          start: 22.0, // Clip duration is only 15.0s
          end: 26.0,
          category: 'KITCHEN',
          label: 'Modular kitchen',
          quality: 5,
        },
      ];

      const proposal: AiEditProposal = {
        brollDecisions: [
          {
            shotId: 'shot_exceeding',
            targetTimelineStart: 4.5,
            targetTimelineEnd: 6.5,
            spokenPhrase: 'modular kitchen',
          },
        ],
      };

      const overlays = validateAiProposal({
        proposal,
        clips: sampleClips,
        identifiedPool: exceedingPool,
        speechCues: sampleSpeechCues,
        totalNarrationDuration,
      });

      expect(overlays).toHaveLength(0);
    });

    it('rejects visually irrelevant shots (semantic mismatch with speech)', () => {
      // Presenter talks about kitchen at 4.0s - 6.0s, but AI proposes swimming pool shot
      const proposal: AiEditProposal = {
        brollDecisions: [
          {
            shotId: 'shot_2', // shot_2 is AMENITY / swimming pool
            targetTimelineStart: 4.2,
            targetTimelineEnd: 6.2,
            spokenPhrase: 'modular kitchen',
            reason: 'Showing pool during kitchen talk',
          },
        ],
      };

      const overlays = validateAiProposal({
        proposal,
        clips: sampleClips,
        identifiedPool,
        speechCues: sampleSpeechCues,
        totalNarrationDuration,
      });

      // Must be rejected by isVisuallyRelevant
      expect(overlays).toHaveLength(0);
    });

    it('rejects B-roll during the first 2.5 seconds (Hook Protection)', () => {
      // Decision placed at 1.0s - 2.4s (during hook)
      const proposal: AiEditProposal = {
        brollDecisions: [
          {
            shotId: 'shot_0',
            targetTimelineStart: 1.0,
            targetTimelineEnd: 2.4,
            spokenPhrase: 'welcome flat',
          },
        ],
      };

      const overlays = validateAiProposal({
        proposal,
        clips: sampleClips,
        identifiedPool,
        speechCues: sampleSpeechCues,
        totalNarrationDuration,
      });

      expect(overlays).toHaveLength(0);
    });

    it('enforces at least 1.5 seconds of presenter visibility between overlays', () => {
      const proposal: AiEditProposal = {
        brollDecisions: [
          // Overlay 1: 3.5s - 5.5s (kitchen)
          {
            shotId: 'shot_0',
            targetTimelineStart: 3.5,
            targetTimelineEnd: 5.5,
            spokenPhrase: 'modular kitchen',
          },
          // Overlay 2: starts at 6.0s (only 0.5s after Overlay 1; violates 1.5s resurface rule)
          {
            shotId: 'shot_1',
            targetTimelineStart: 6.0,
            targetTimelineEnd: 8.0,
            spokenPhrase: 'balcony view',
          },
        ],
      };

      const overlays = validateAiProposal({
        proposal,
        clips: sampleClips,
        identifiedPool,
        speechCues: sampleSpeechCues,
        totalNarrationDuration,
      });

      // First overlay accepted, second overlay rejected due to violation of 1.5s face resurfacing
      expect(overlays).toHaveLength(1);
      expect(overlays[0].source.key).toBe('broll_footage.mp4');
      expect(overlays[0].label).toContain('Modular kitchen');
    });

    it('enforces the maximum 60% B-roll budget', () => {
      // 10s video duration -> max budget is 6.0s
      const shortNarrationDuration = 10.0;
      const proposal: AiEditProposal = {
        brollDecisions: [
          // First cutaway: ~3.5s
          {
            shotId: 'shot_0',
            targetTimelineStart: 2.8,
            targetTimelineEnd: 6.3,
            spokenPhrase: 'modular kitchen',
          },
          // Second cutaway: ~3.0s (3.5 + 3.0 = 6.5s > 6.0s budget limit)
          {
            shotId: 'shot_1',
            targetTimelineStart: 7.0,
            targetTimelineEnd: 10.0,
            spokenPhrase: 'balcony view',
          },
        ],
      };

      const overlays = validateAiProposal({
        proposal,
        clips: sampleClips,
        identifiedPool,
        speechCues: sampleSpeechCues,
        totalNarrationDuration: shortNarrationDuration,
        maxBrollBudgetPercent: 0.6,
      });

      // Total B-roll must not exceed 60% of 10s (6.0s)
      const totalBrollTime = overlays.reduce((acc, o) => acc + (o.end - o.start), 0);
      expect(totalBrollTime).toBeLessThanOrEqual(shortNarrationDuration * 0.6);
    });

    it('prevents duplicate shots in the same generated video', () => {
      const proposal: AiEditProposal = {
        brollDecisions: [
          {
            shotId: 'shot_0',
            targetTimelineStart: 3.5,
            targetTimelineEnd: 5.5,
            spokenPhrase: 'modular kitchen',
          },
          {
            shotId: 'shot_0', // duplicate shotId
            targetTimelineStart: 8.0,
            targetTimelineEnd: 10.0,
            spokenPhrase: 'modular kitchen',
          },
        ],
      };

      const overlays = validateAiProposal({
        proposal,
        clips: sampleClips,
        identifiedPool,
        speechCues: sampleSpeechCues,
        totalNarrationDuration,
      });

      expect(overlays).toHaveLength(1);
    });

    it('snaps overlay timings to valid word boundaries', () => {
      // Spoken cue has words: "modern" (4.2 - 4.7), "modular" (4.7 - 5.3), "kitchen" (5.3 - 6.2)
      // Decision requests start at 4.3s (within 0.1s of "modern" word start at 4.2s)
      const proposal: AiEditProposal = {
        brollDecisions: [
          {
            shotId: 'shot_0',
            targetTimelineStart: 4.3,
            targetTimelineEnd: 6.0,
            spokenPhrase: 'modern modular kitchen',
          },
        ],
      };

      const overlays = validateAiProposal({
        proposal,
        clips: sampleClips,
        identifiedPool,
        speechCues: sampleSpeechCues,
        totalNarrationDuration,
      });

      expect(overlays).toHaveLength(1);
      // Snapped to word "modern" start (4.2s)
      expect(overlays[0].start).toBe(4.2);
    });

    it('prevents B-roll from overlapping the end card boundary', () => {
      // Total duration 20s. End card protection prevents B-roll in last 1.5s (>= 18.5s)
      const proposal: AiEditProposal = {
        brollDecisions: [
          {
            shotId: 'shot_0',
            targetTimelineStart: 18.8,
            targetTimelineEnd: 19.8,
            spokenPhrase: 'site visit',
          },
        ],
      };

      const overlays = validateAiProposal({
        proposal,
        clips: sampleClips,
        identifiedPool,
        speechCues: sampleSpeechCues,
        totalNarrationDuration,
      });

      expect(overlays).toHaveLength(0);
    });
  });

  // --------------------------------------------------------------------------
  // 3. Gemini Request and Failure Tests
  // --------------------------------------------------------------------------
  describe('3. Gemini Request and Failure Tests', () => {
    afterEach(() => {
      // Restore standard mock provider
      setAIProviderOverride(new MockAIProvider());
    });

    it('successfully parses valid Gemini JSON proposal via proposeAiEdit', async () => {
      class SuccessMockProvider extends MockAIProvider {
        override async generateJson<T>(): Promise<T> {
          return {
            editorialTheme: 'Highlighting luxury interiors',
            brollDecisions: [
              {
                shotId: 'shot_0',
                targetTimelineStart: 4.2,
                targetTimelineEnd: 6.2,
                spokenPhrase: 'modern modular kitchen',
                reason: 'Kitchen cutaway during feature description',
              },
            ],
          } as T;
        }
      }

      setAIProviderOverride(new SuccessMockProvider());

      const proposal = await proposeAiEdit('Dummy Edit Sheet');
      expect(proposal.editorialTheme).toBe('Highlighting luxury interiors');
      expect(proposal.brollDecisions).toHaveLength(1);
      expect(proposal.brollDecisions[0].shotId).toBe('shot_0');
    });

    it('simulates a successful Gemini response and executes AI-directed edit without fallback', async () => {
      class SmartAiProvider extends MockAIProvider {
        override async generateJson<T>(): Promise<T> {
          return {
            editorialTheme: 'Show kitchen then swimming pool',
            brollDecisions: [
              {
                shotId: 'shot_0',
                targetTimelineStart: 4.2,
                targetTimelineEnd: 6.2,
                spokenPhrase: 'modular kitchen',
                reason: 'Visual match for modular kitchen',
              },
              {
                shotId: 'shot_1',
                targetTimelineStart: 13.8,
                targetTimelineEnd: 16.2,
                spokenPhrase: 'swimming pool',
                reason: 'Visual match for luxury swimming pool',
              },
            ],
          } as T;
        }
      }

      setAIProviderOverride(new SmartAiProvider());

      const overlays = await planSmartEditsWithDirector({
        clips: sampleClips,
        speechCues: sampleSpeechCues,
        totalNarrationDuration,
        projectName: 'Smart AI Reels',
      });

      expect(overlays).toHaveLength(2);
      expect(overlays[0].source.key).toBe('broll_footage.mp4');
      expect(overlays[0].label).toContain('Modular kitchen');
      expect(overlays[1].label).toContain('Olympic size swimming pool');
      // Resurface face between them: overlay 1 end <= overlay 2 start - 1.5s
      expect(overlays[1].start - overlays[0].end).toBeGreaterThanOrEqual(1.5);
    });

    it('triggers fallback to Phase 2 deterministic planner when Gemini times out (>5s)', async () => {
      // Provider that delays response for 6000ms
      class TimeoutMockProvider extends MockAIProvider {
        override async generateJson<T>(): Promise<T> {
          return new Promise((resolve) => {
            setTimeout(() => {
              resolve({
                brollDecisions: [],
              } as T);
            }, 6000);
          });
        }
      }

      setAIProviderOverride(new TimeoutMockProvider());

      // proposeAiEdit should reject with timeout error
      // Use fake timers to advance time cleanly without waiting 6 real seconds
      vi.useFakeTimers();
      const p = proposeAiEdit('Dummy Edit Sheet');
      vi.advanceTimersByTime(5100);

      await expect(p).rejects.toThrow(/timed out/i);
      vi.useRealTimers();
    });

    it('triggers fallback when Gemini API fails with an error', async () => {
      class ErrorMockProvider extends MockAIProvider {
        override async generateJson<T>(): Promise<T> {
          throw new Error('Gemini API rate limit exceeded (HTTP 429)');
        }
      }

      setAIProviderOverride(new ErrorMockProvider());

      // planSmartEditsWithDirector catches the error and safely falls back to Phase 2
      const overlays = await planSmartEditsWithDirector({
        clips: sampleClips,
        speechCues: sampleSpeechCues,
        totalNarrationDuration,
        projectName: 'Fallback Test',
      });

      // Phase 2 deterministic planner detects "modular kitchen" and produces at least 1 overlay
      expect(overlays.length).toBeGreaterThan(0);
      expect(overlays[0].source.key).toBe('broll_footage.mp4');
    });

    it('triggers fallback when Gemini returns invalid or non-object JSON', async () => {
      class InvalidJsonMockProvider extends MockAIProvider {
        override async generateJson<T>(): Promise<T> {
          return 'this is a raw string, not an object' as unknown as T;
        }
      }

      setAIProviderOverride(new InvalidJsonMockProvider());

      const overlays = await planSmartEditsWithDirector({
        clips: sampleClips,
        speechCues: sampleSpeechCues,
        totalNarrationDuration,
      });

      expect(overlays.length).toBeGreaterThan(0);
      expect(overlays[0].source.key).toBe('broll_footage.mp4');
    });

    it('triggers fallback when required response fields are missing', async () => {
      class MissingFieldsMockProvider extends MockAIProvider {
        override async generateJson<T>(): Promise<T> {
          // Missing brollDecisions array
          return { editorialTheme: 'Great theme' } as unknown as T;
        }
      }

      setAIProviderOverride(new MissingFieldsMockProvider());

      const overlays = await planSmartEditsWithDirector({
        clips: sampleClips,
        speechCues: sampleSpeechCues,
        totalNarrationDuration,
      });

      expect(overlays.length).toBeGreaterThan(0);
      expect(overlays[0].source.key).toBe('broll_footage.mp4');
    });

    it('triggers fallback when AI returns empty B-roll decisions', async () => {
      class EmptyDecisionsMockProvider extends MockAIProvider {
        override async generateJson<T>(): Promise<T> {
          return { editorialTheme: 'No cuts recommended', brollDecisions: [] } as unknown as T;
        }
      }

      setAIProviderOverride(new EmptyDecisionsMockProvider());

      const overlays = await planSmartEditsWithDirector({
        clips: sampleClips,
        speechCues: sampleSpeechCues,
        totalNarrationDuration,
      });

      // Falls back to Phase 2 keyword planner which detects the keywords in speech
      expect(overlays.length).toBeGreaterThan(0);
      expect(overlays[0].source.key).toBe('broll_footage.mp4');
    });

    it('triggers fallback when AI returns only invalid or rejected shot identifiers', async () => {
      class InvalidShotsMockProvider extends MockAIProvider {
        override async generateJson<T>(): Promise<T> {
          return {
            editorialTheme: 'Hallucinated plan',
            brollDecisions: [
              {
                shotId: 'shot_invalid_99',
                targetTimelineStart: 4.0,
                targetTimelineEnd: 6.0,
                spokenPhrase: 'modular kitchen',
              },
            ],
          } as unknown as T;
        }
      }

      setAIProviderOverride(new InvalidShotsMockProvider());

      const overlays = await planSmartEditsWithDirector({
        clips: sampleClips,
        speechCues: sampleSpeechCues,
        totalNarrationDuration,
      });

      // Since the AI proposal was 100% rejected, it safely falls back to Phase 2
      expect(overlays.length).toBeGreaterThan(0);
      expect(overlays[0].source.key).toBe('broll_footage.mp4');
    });

    it('verifies fallback output preserves continuous narration and matches Phase 2 plan', async () => {
      class AlwaysFailsMockProvider extends MockAIProvider {
        override async generateJson<T>(): Promise<T> {
          throw new Error('Service Unavailable (503)');
        }
      }

      setAIProviderOverride(new AlwaysFailsMockProvider());

      const fallbackOverlays = await planSmartEditsWithDirector({
        clips: sampleClips,
        speechCues: sampleSpeechCues,
        totalNarrationDuration,
      });

      const phase2Expected = buildBrollPlan({
        clips: sampleClips,
        speechCues: sampleSpeechCues,
        totalNarrationDuration,
      });

      expect(fallbackOverlays).toEqual(phase2Expected);
    });

    it('returns empty array when narration is too short (<6s) without invoking Gemini', async () => {
      const mockGenerateJson = vi.fn();
      class SpyProvider extends MockAIProvider {
        override async generateJson<T>(prompt: string, options?: any): Promise<T> {
          mockGenerateJson();
          return super.generateJson(prompt, options);
        }
      }

      setAIProviderOverride(new SpyProvider());

      const shortOverlays = await planSmartEditsWithDirector({
        clips: sampleClips,
        speechCues: sampleSpeechCues,
        totalNarrationDuration: 4.5, // Less than 6s
      });

      expect(shortOverlays).toEqual([]);
      expect(mockGenerateJson).not.toHaveBeenCalled();
    });
  });
});
