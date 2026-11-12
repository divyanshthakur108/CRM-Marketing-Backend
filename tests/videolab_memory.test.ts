import { describe, it, expect, beforeEach, vi } from 'vitest';
import mongoose, { Types } from 'mongoose';
import {
  ContentItem,
  ContentShot,
  upsertContentFromAnalysis,
  recordRenderContentMemory,
  IContentItem,
  IContentShot,
} from '../src/modules/videolab/memoryModel.js';
import { searchShots, getContentMemoryStats } from '../src/modules/videolab/memorySearch.js';
import type { ClipAnalysis } from '../src/modules/videolab/analyze.js';
import type { EditRecipe, LabInput } from '../src/modules/videolab/recipe.js';

describe('Video Lab Content Memory (Step 4a)', () => {
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
        if (op === '$lte') {
          if (doc[key] > target) return false;
          continue;
        }
        if (op === '$gte') {
          if (doc[key] < target) return false;
          continue;
        }
        if (op === '$ne') {
          if (doc[key] === target) return false;
          continue;
        }
      }
      if (doc[key] !== val) return false;
    }
    return true;
  };

  beforeEach(() => {
    itemsMap.clear();
    shotsMap.clear();
    vi.restoreAllMocks();

    vi.spyOn(mongoose.connection, 'readyState', 'get').mockReturnValue(1);
    Object.defineProperty(mongoose.connection, 'db', { value: {}, configurable: true, writable: true });

    // Mock ContentItem
    vi.spyOn(ContentItem, 'countDocuments').mockImplementation(async (filter?: any) => {
      let count = 0;
      for (const item of itemsMap.values()) {
        if (matchFilter(item, filter)) count++;
      }
      return count;
    });

    vi.spyOn(ContentItem, 'findOne').mockImplementation((filter?: any) => {
      let match: any = null;
      for (const item of itemsMap.values()) {
        if (matchFilter(item, filter)) {
          match = item;
          break;
        }
      }
      return {
        lean: () => Promise.resolve(match ? { ...match } : null),
        then: (resolve: any) => resolve(match ? { ...match } : null),
      } as any;
    });

    vi.spyOn(ContentItem, 'findOneAndUpdate').mockImplementation(
      async (filter: any, update: any, options?: any) => {
        let existing: any = null;
        for (const item of itemsMap.values()) {
          if (matchFilter(item, filter)) {
            existing = item;
            break;
          }
        }

        if (!existing && options?.upsert) {
          existing = {
            _id: new Types.ObjectId(),
            ...(update.$setOnInsert || {}),
            ...(update.$set || {}),
          };
          itemsMap.set(existing._id.toString(), existing);
          return existing;
        }

        if (existing) {
          Object.assign(existing, update.$set || {});
          return existing;
        }

        return null;
      }
    );

    // Mock ContentShot
    vi.spyOn(ContentShot, 'countDocuments').mockImplementation(async (filter?: any) => {
      let count = 0;
      for (const shot of shotsMap.values()) {
        if (matchFilter(shot, filter)) count++;
      }
      return count;
    });

    vi.spyOn(ContentShot, 'findOne').mockImplementation((filter?: any) => {
      let match: any = null;
      for (const shot of shotsMap.values()) {
        if (matchFilter(shot, filter)) {
          match = shot;
          break;
        }
      }
      return {
        lean: () => Promise.resolve(match ? { ...match } : null),
        then: (resolve: any) => resolve(match ? { ...match } : null),
      } as any;
    });

    vi.spyOn(ContentShot, 'findOneAndUpdate').mockImplementation(
      async (filter: any, update: any, options?: any) => {
        let existing: any = null;
        for (const shot of shotsMap.values()) {
          if (matchFilter(shot, filter)) {
            existing = shot;
            break;
          }
        }

        if (!existing && options?.upsert) {
          existing = {
            _id: new Types.ObjectId(),
            usedIn: [],
            issues: [],
            features: [],
            ...(update.$setOnInsert || {}),
            ...(update.$set || {}),
          };
          shotsMap.set(existing._id.toString(), existing);
          return existing;
        }

        if (existing) {
          Object.assign(existing, update.$set || {});
          return existing;
        }

        return null;
      }
    );

    vi.spyOn(ContentShot, 'updateMany').mockImplementation(async (filter: any, update: any) => {
      let modified = 0;
      for (const shot of shotsMap.values()) {
        if (filter.clipKey && shot.clipKey !== filter.clipKey) continue;
        if (filter.start?.$lte !== undefined && shot.start > filter.start.$lte) continue;
        if (filter.end?.$gte !== undefined && shot.end < filter.end.$gte) continue;

        if (update.$push?.usedIn) {
          const already = (shot.usedIn || []).some(
            (u: any) => u.renderId?.toString() === update.$push.usedIn.renderId?.toString()
          );
          if (!already) {
            shot.usedIn = [...(shot.usedIn || []), update.$push.usedIn];
            modified++;
          }
        }
      }
      return { matchedCount: modified, modifiedCount: modified } as any;
    });

    vi.spyOn(ContentShot, 'updateOne').mockImplementation(async (filter: any, update: any) => {
      for (const shot of shotsMap.values()) {
        if (matchFilter(shot, filter)) {
          if (update.$set) Object.assign(shot, update.$set);
          if (update.$push?.usedIn) shot.usedIn = [...(shot.usedIn || []), update.$push.usedIn];
          return { matchedCount: 1, modifiedCount: 1 } as any;
        }
      }
      return { matchedCount: 0, modifiedCount: 0 } as any;
    });

    vi.spyOn(ContentShot, 'find').mockImplementation((filter?: any) => {
      const matches: any[] = [];
      for (const shot of shotsMap.values()) {
        if (matchFilter(shot, filter)) {
          matches.push(JSON.parse(JSON.stringify(shot)));
        }
      }

      return {
        populate: (field: string) => ({
          lean: () =>
            Promise.resolve(
              matches.map((s) => {
                if (field === 'itemId') {
                  const item = itemsMap.get(s.itemId?.toString());
                  return { ...s, itemId: item ? { ...item } : null };
                }
                return s;
              })
            ),
        }),
        lean: () => Promise.resolve(matches),
      } as any;
    });
  });

  const mockAnalysis: ClipAnalysis = {
    clipKey: 'video-lab/assets/clip-kitchen.mp4',
    durationSeconds: 12.0,
    analyzedSeconds: 12.0,
    summary: 'Luxury apartment walkthrough showing kitchen and living area',
    shots: [
      {
        start: 0,
        end: 4.5,
        label: 'Modular kitchen with Italian marble counter',
        category: 'KITCHEN',
        quality: 5,
        hookScore: 4,
        issues: [],
        hasSpeech: false,
        bestStart: 0.5,
        bestEnd: 4.0,
        keep: true,
        reason: 'Clean steady shot of modular kitchen',
        thumbnail: 'data:image/jpeg;base64,mockthumbkitchen',
      },
      {
        start: 4.5,
        end: 9.0,
        label: 'Spacious living room with natural sunlight',
        category: 'LIVING',
        quality: 4,
        hookScore: 3,
        issues: [],
        hasSpeech: true,
        bestStart: 5.0,
        bestEnd: 8.5,
        keep: true,
        reason: 'Presenter introducing the hall',
        thumbnail: 'data:image/jpeg;base64,mockthumbliving',
      },
      {
        start: 9.0,
        end: 12.0,
        label: 'Balcony with skyline view',
        category: 'BALCONY_VIEW',
        quality: 3,
        hookScore: 2,
        issues: ['shaky'],
        hasSpeech: false,
        bestStart: 9.5,
        bestEnd: 11.5,
        keep: true,
        reason: 'City skyline view from balcony',
        thumbnail: 'data:image/jpeg;base64,mockthumbbalcony',
      },
    ],
    sceneCuts: [4.5, 9.0],
    silences: [],
    model: 'gemini-3.5-flash',
    ms: 500,
    steps: [],
    fromCache: false,
  };

  describe('1. Upsert Idempotency', () => {
    it('creates ContentItem and ContentShots on first call', async () => {
      const item = await upsertContentFromAnalysis(mockAnalysis);
      expect(item).not.toBeNull();
      expect(item?.kind).toBe('CLIP');
      expect(item?.sourceKey).toBe(mockAnalysis.clipKey);

      const itemsCount = await ContentItem.countDocuments({});
      expect(itemsCount).toBe(1);

      const shotsCount = await ContentShot.countDocuments({ clipKey: mockAnalysis.clipKey });
      expect(shotsCount).toBe(3);

      const kitchenShot = await ContentShot.findOne({ clipKey: mockAnalysis.clipKey, room: 'KITCHEN' });
      expect(kitchenShot.room).toBe('KITCHEN');
      expect(kitchenShot.quality).toBe(5);
      expect(kitchenShot.thumbnailUrl).toContain('mockthumbkitchen');
    });

    it('running upsert twice does not create duplicate items or shots', async () => {
      await upsertContentFromAnalysis(mockAnalysis);
      await upsertContentFromAnalysis(mockAnalysis);

      const itemsCount = await ContentItem.countDocuments({});
      const shotsCount = await ContentShot.countDocuments({});

      expect(itemsCount).toBe(1);
      expect(shotsCount).toBe(3);
    });

    it('updates existing item and shots when analysis changes', async () => {
      await upsertContentFromAnalysis(mockAnalysis);

      const updatedAnalysis: ClipAnalysis = {
        ...mockAnalysis,
        summary: 'Updated walkthrough summary',
        shots: [
          {
            ...mockAnalysis.shots[0],
            label: 'Updated modern kitchen description',
            quality: 5,
          },
        ],
      };

      await upsertContentFromAnalysis(updatedAnalysis);

      const item = await ContentItem.findOne({ sourceKey: mockAnalysis.clipKey });
      expect(item?.summary).toBe('Updated walkthrough summary');

      const kitchenShot = await ContentShot.findOne({ clipKey: mockAnalysis.clipKey, start: 0 });
      expect(kitchenShot?.features).toContain('Updated modern kitchen description');
    });
  });

  describe('2. Search Filtering', () => {
    beforeEach(async () => {
      await upsertContentFromAnalysis(mockAnalysis);
    });

    it('filters accurately by room', async () => {
      const kitchenShots = await searchShots({ room: 'KITCHEN' });
      expect(kitchenShots.length).toBe(1);
      expect(kitchenShots[0].room).toBe('KITCHEN');

      const livingShots = await searchShots({ room: 'LIVING' });
      expect(livingShots.length).toBe(1);
      expect(livingShots[0].room).toBe('LIVING');

      const bedroomShots = await searchShots({ room: 'BEDROOM' });
      expect(bedroomShots.length).toBe(0);
    });

    it('matches by keywords in features or spokenText', async () => {
      const counterShots = await searchShots({ q: 'marble counter' });
      expect(counterShots.length).toBe(1);
      expect(counterShots[0].room).toBe('KITCHEN');

      const sunShots = await searchShots({ keywords: ['sunlight'] });
      expect(sunShots.length).toBe(1);
      expect(sunShots[0].room).toBe('LIVING');
    });

    it('filters out shots recently used within excludeRecentDays', async () => {
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
      await ContentShot.updateOne(
        { room: 'KITCHEN' },
        { $push: { usedIn: { renderId: new Types.ObjectId(), at: yesterday } } }
      );

      // Exclude shots used in the last 7 days: kitchen should be excluded
      const shotsExcluded = await searchShots({ room: 'KITCHEN', excludeRecentDays: 7 });
      expect(shotsExcluded.length).toBe(0);

      // Exclude shots used in the last 0.1 days (few hours): kitchen was used 24h ago, so it IS included
      const shotsAllowed = await searchShots({ room: 'KITCHEN', excludeRecentDays: 0.1 });
      expect(shotsAllowed.length).toBe(1);
    });
  });

  describe('3. Ranking Rules', () => {
    it('ranks a shot used yesterday below an unused one', async () => {
      await upsertContentFromAnalysis(mockAnalysis);

      // Give living room quality 5 (same as kitchen)
      await ContentShot.updateOne({ room: 'LIVING' }, { $set: { quality: 5 } });

      // Mark kitchen shot as used yesterday
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
      await ContentShot.updateOne(
        { room: 'KITCHEN' },
        { $push: { usedIn: { renderId: new Types.ObjectId(), at: yesterday } } }
      );

      // Search without room restriction
      const results = await searchShots({});
      expect(results.length).toBeGreaterThanOrEqual(2);

      // Unused living room shot should rank BEFORE the kitchen shot used yesterday
      const livingIdx = results.findIndex((s) => s.room === 'LIVING');
      const kitchenIdx = results.findIndex((s) => s.room === 'KITCHEN');

      expect(livingIdx).toBeLessThan(kitchenIdx);
    });

    it('ranks higher quality above lower quality when neither was used', async () => {
      await upsertContentFromAnalysis(mockAnalysis);

      const results = await searchShots({});
      const kitchenShot = results.find((s) => s.room === 'KITCHEN'); // quality 5
      const balconyShot = results.find((s) => s.room === 'BALCONY_VIEW'); // quality 3, shaky

      const kitchenIdx = results.indexOf(kitchenShot!);
      const balconyIdx = results.indexOf(balconyShot!);

      expect(kitchenIdx).toBeLessThan(balconyIdx);
    });

    it('ranks ACTUAL media above ILLUSTRATIVE media', async () => {
      // Create an illustrative item
      const itemIll = await ContentItem.findOneAndUpdate(
        { sourceKey: 'illustrative_clip.mp4' },
        {
          $set: {
            kind: 'CLIP',
            sourceKey: 'illustrative_clip.mp4',
            actualOrIllustrative: 'ILLUSTRATIVE',
            rooms: ['KITCHEN'],
            features: ['3D architectural rendering of kitchen'],
          },
        },
        { upsert: true }
      );

      await ContentShot.findOneAndUpdate(
        { clipKey: 'illustrative_clip.mp4', start: 0, end: 5 },
        {
          $set: {
            itemId: itemIll._id,
            clipKey: 'illustrative_clip.mp4',
            start: 0,
            end: 5,
            room: 'KITCHEN',
            quality: 5,
            features: ['3D render of kitchen'],
            issues: [],
            usedIn: [],
          },
        },
        { upsert: true }
      );

      // Create an actual item
      const itemAct = await ContentItem.findOneAndUpdate(
        { sourceKey: 'real_clip.mp4' },
        {
          $set: {
            kind: 'CLIP',
            sourceKey: 'real_clip.mp4',
            actualOrIllustrative: 'ACTUAL',
            rooms: ['KITCHEN'],
            features: ['Real site kitchen'],
          },
        },
        { upsert: true }
      );

      await ContentShot.findOneAndUpdate(
        { clipKey: 'real_clip.mp4', start: 0, end: 5 },
        {
          $set: {
            itemId: itemAct._id,
            clipKey: 'real_clip.mp4',
            start: 0,
            end: 5,
            room: 'KITCHEN',
            quality: 5,
            features: ['Real site kitchen'],
            issues: [],
            usedIn: [],
          },
        },
        { upsert: true }
      );

      const results = await searchShots({ room: 'KITCHEN' });
      expect(results.length).toBe(2);
      expect(results[0].clipKey).toBe('real_clip.mp4');
      expect(results[1].clipKey).toBe('illustrative_clip.mp4');
    });

    it('ranks shots without serious issues above shots with serious issues', async () => {
      await upsertContentFromAnalysis(mockAnalysis);

      const cleanShots = await searchShots({ q: 'sunlight' });
      const shakyShots = await searchShots({ q: 'skyline' });

      expect(cleanShots[0].issues).toEqual([]);
      expect(shakyShots[0].issues).toContain('shaky');
    });
  });

  describe('4. Tenant Isolation', () => {
    it('isolates shots between different organizations', async () => {
      const orgA = new Types.ObjectId();
      const orgB = new Types.ObjectId();

      await upsertContentFromAnalysis(mockAnalysis, { organizationId: orgA });

      const mockAnalysisB: ClipAnalysis = {
        ...mockAnalysis,
        clipKey: 'orgB_clip.mp4',
        shots: [
          {
            ...mockAnalysis.shots[0],
            label: 'Org B luxury kitchen',
          },
        ],
      };
      await upsertContentFromAnalysis(mockAnalysisB, { organizationId: orgB });

      const shotsA = await searchShots({ organizationId: orgA });
      expect(shotsA.every((s) => s.organizationId?.toString() === orgA.toString())).toBe(true);
      expect(shotsA.some((s) => s.clipKey === 'orgB_clip.mp4')).toBe(false);

      const shotsB = await searchShots({ organizationId: orgB });
      expect(shotsB.every((s) => s.organizationId?.toString() === orgB.toString())).toBe(true);
      expect(shotsB.some((s) => s.clipKey === mockAnalysis.clipKey)).toBe(false);
    });
  });

  describe('5. Render Completion & Usage Logging', () => {
    it('records ContentItem for finished reel and appends usedIn on shots', async () => {
      await upsertContentFromAnalysis(mockAnalysis);

      const renderId = new Types.ObjectId();
      const mockRecipe: EditRecipe = {
        version: 3,
        variant: { index: 0, label: 'Variant A' },
        output: { width: 1080, height: 1920, fps: 30, maxSecondsPerClip: 30 },
        editing: 'smart',
        cuts: [
          {
            key: mockAnalysis.clipKey,
            start: 0,
            end: 4.5,
            label: 'Kitchen shot',
          },
        ],
        overlays: [
          {
            start: 1.0,
            end: 3.5,
            source: {
              kind: 'clip',
              key: mockAnalysis.clipKey,
              in: 1.0,
              out: 3.5,
            },
            label: 'Kitchen close-up',
          },
        ],
        transitionSeconds: 0.4,
        captions: {
          language: 'en',
          style: 'POP',
          source: 'speech',
          lines: ['Welcome to our premium apartments'],
        },
        watermark: { text: 'RealCRM' },
        endCard: {
          template: 'HERITAGE_LUXURY',
          seconds: 2.4,
          projectName: 'Skyline Palms',
          orgName: 'Prestige Realty',
        },
      };

      const mockInput: LabInput = {
        clips: [{ key: mockAnalysis.clipKey }],
        facts: { orgName: 'Prestige Realty', projectName: 'Skyline Palms' },
        captions: { language: 'en', lines: ['Welcome to our premium apartments'] },
      };

      await recordRenderContentMemory({
        renderId,
        recipe: mockRecipe,
        input: mockInput,
        outputKey: `video-lab/renders/${renderId}/reel.mp4`,
      });

      // Verify reel ContentItem created
      const reelItem = await ContentItem.findOne({ renderId });
      expect(reelItem).not.toBeNull();
      expect(reelItem?.kind).toBe('REEL');
      expect(reelItem?.hook).toBe('Welcome to our premium apartments');

      // Verify kitchen ContentShot marked as usedIn
      const kitchenShot = await ContentShot.findOne({
        clipKey: mockAnalysis.clipKey,
        start: 0,
      });
      expect(kitchenShot?.usedIn.length).toBe(1);
      expect(kitchenShot?.usedIn[0].renderId.toString()).toBe(renderId.toString());

      // Stats check
      const stats = await getContentMemoryStats();
      expect(stats.itemCount).toBe(2); // 1 CLIP + 1 REEL
      expect(stats.shotCount).toBe(3); // 3 shots from clip
    });
  });
});
