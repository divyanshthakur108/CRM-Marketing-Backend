import { describe, it, expect, beforeEach, vi } from 'vitest';
import fsp from 'fs/promises';
import mongoose from 'mongoose';
import {
  ClipAnalysisCache,
  GeminiUsage,
  CURRENT_ANALYZER_VERSION,
  recordGeminiUsage,
  getTodayGeminiUsage,
  getCachedAnalysis,
  setCachedAnalysis,
  getTodayIST,
} from '../src/modules/videolab/cacheModel.js';
import { analyzeClip, ClipAnalysis } from '../src/modules/videolab/analyze.js';
import { transcribeClip, ClipTranscript } from '../src/modules/videolab/transcribe.js';
import { setAIProviderOverride } from '../src/modules/ai/providers/index.js';
import { MockAIProvider } from './fakes/fakeAIProvider.js';
import * as ffmpegUtils from '../src/utils/ffmpeg.js';
import { defaultStorage } from '../src/storage/localStorage.adapter.js';
import { env } from '../src/config/env.js';

describe('Video Lab Persistent Caching & Gemini Usage Counter', () => {
  const cacheMap = new Map<string, any>();
  const usageMap = new Map<string, any>();

  const toCacheKey = (filter: any) =>
    `${filter.kind}:${filter.clipKey}:${filter.language ?? ''}:${filter.analyzerVersion ?? CURRENT_ANALYZER_VERSION}`;

  const toUsageKey = (filter: any) => `${filter.date}:${filter.model}`;

  beforeEach(() => {
    cacheMap.clear();
    usageMap.clear();
    vi.restoreAllMocks();

    // Ensure connection readyState is treated as connected
    vi.spyOn(mongoose.connection, 'readyState', 'get').mockReturnValue(1);

    // Mock ClipAnalysisCache methods
    vi.spyOn(ClipAnalysisCache, 'findOne').mockImplementation((filter: any) => {
      const key = toCacheKey(filter);
      const val = cacheMap.get(key) || null;
      return {
        lean: () => Promise.resolve(val ? { ...val } : null),
        exec: () => Promise.resolve(val ? { ...val } : null),
      } as any;
    });

    vi.spyOn(ClipAnalysisCache, 'findOneAndUpdate').mockImplementation(
      (filter: any, update: any, options: any) => {
        const key = toCacheKey(filter);
        const existing = cacheMap.get(key) || { ...filter };
        const updated = {
          ...existing,
          ...(update.$set || update),
          kind: filter.kind,
          clipKey: filter.clipKey,
          language: filter.language ?? '',
          analyzerVersion: filter.analyzerVersion ?? CURRENT_ANALYZER_VERSION,
        };
        cacheMap.set(key, updated);
        return Promise.resolve(updated) as any;
      }
    );

    vi.spyOn(ClipAnalysisCache, 'create').mockImplementation((doc: any) => {
      const key = toCacheKey(doc);
      if (cacheMap.has(key)) {
        return Promise.reject(new Error(`E11000 duplicate key error collection: realcrm.clipanalysiscaches index: kind_1_clipKey_1_language_1_analyzerVersion_1`));
      }
      cacheMap.set(key, { ...doc });
      return Promise.resolve({ ...doc }) as any;
    });

    vi.spyOn(ClipAnalysisCache, 'deleteOne').mockImplementation((filter: any) => {
      const key = toCacheKey(filter);
      cacheMap.delete(key);
      return Promise.resolve({ deletedCount: 1 }) as any;
    });

    // Mock GeminiUsage methods
    vi.spyOn(GeminiUsage, 'findOneAndUpdate').mockImplementation((filter: any, update: any) => {
      const key = toUsageKey(filter);
      const existing = usageMap.get(key) || { date: filter.date, model: filter.model, count: 0 };
      const inc = update?.$inc?.count || 1;
      const count = existing.count + inc;
      const updated = { ...existing, count };
      usageMap.set(key, updated);
      return Promise.resolve(updated) as any;
    });

    vi.spyOn(GeminiUsage, 'find').mockImplementation((filter: any) => {
      const items = Array.from(usageMap.values()).filter((u) => u.date === filter.date);
      return Promise.resolve(items) as any;
    });
  });

  describe('1. ClipAnalysisCache Model & Helpers', () => {
    it('saves and retrieves cached analysis with analyzerVersion', async () => {
      const mockResult = {
        clipKey: 'test/sample.mp4',
        durationSeconds: 15,
        summary: 'Beautiful 3 BHK',
        shots: [],
      };

      await setCachedAnalysis('ANALYZE', 'test/sample.mp4', '', mockResult);

      const cached = await getCachedAnalysis<typeof mockResult>('ANALYZE', 'test/sample.mp4', '');
      expect(cached).not.toBeNull();
      expect(cached?.summary).toBe('Beautiful 3 BHK');
      expect(cached?.clipKey).toBe('test/sample.mp4');

      const entry = cacheMap.get(`ANALYZE:test/sample.mp4::${CURRENT_ANALYZER_VERSION}`);
      expect(entry?.analyzerVersion).toBe(CURRENT_ANALYZER_VERSION);
      expect(entry?.kind).toBe('ANALYZE');
      expect(entry?.language).toBe('');
    });

    it('enforces unique compound index on { kind, clipKey, language, analyzerVersion }', async () => {
      await ClipAnalysisCache.create({
        kind: 'ANALYZE',
        clipKey: 'clip_uniq.mp4',
        language: '',
        analyzerVersion: CURRENT_ANALYZER_VERSION,
        result: { test: 1 },
      });

      // Attempting to create duplicate entry with identical compound key should fail
      await expect(
        ClipAnalysisCache.create({
          kind: 'ANALYZE',
          clipKey: 'clip_uniq.mp4',
          language: '',
          analyzerVersion: CURRENT_ANALYZER_VERSION,
          result: { test: 2 },
        })
      ).rejects.toThrow(/duplicate key error/);
    });

    it('allows different languages for TRANSCRIBE with the same clipKey', async () => {
      await setCachedAnalysis('TRANSCRIBE', 'speech.mp4', 'hi', { language: 'hi', cues: [] });
      await setCachedAnalysis('TRANSCRIBE', 'speech.mp4', 'en', { language: 'en', cues: [] });

      const hi = await getCachedAnalysis<{ language: string }>('TRANSCRIBE', 'speech.mp4', 'hi');
      const en = await getCachedAnalysis<{ language: string }>('TRANSCRIBE', 'speech.mp4', 'en');

      expect(hi?.language).toBe('hi');
      expect(en?.language).toBe('en');
    });

    it('returns null on cache miss', async () => {
      const missing = await getCachedAnalysis('ANALYZE', 'non_existent.mp4');
      expect(missing).toBeNull();
    });
  });

  describe('2. Gemini Usage Counter & Soft Daily Limit', () => {
    it('increments usage count atomically per date and model', async () => {
      const today = getTodayIST();
      const modelName = 'gemini-3.5-flash';

      await recordGeminiUsage(modelName);
      await recordGeminiUsage(modelName);
      const count = await recordGeminiUsage(modelName);

      expect(count).toBe(3);

      const usage = await getTodayGeminiUsage();
      expect(usage.date).toBe(today);
      expect(usage.totalCount).toBe(3);
      expect(usage.limit).toBe(env.GEMINI_DAILY_LIMIT);
      expect(usage.byModel[modelName]).toBe(3);
    });

    it('tracks separate counts for different models on the same day', async () => {
      await recordGeminiUsage('gemini-3.5-flash');
      await recordGeminiUsage('gemini-3.5-flash');
      await recordGeminiUsage('gemini-3.1-flash-image');

      const usage = await getTodayGeminiUsage();
      expect(usage.totalCount).toBe(3);
      expect(usage.byModel['gemini-3.5-flash']).toBe(2);
      expect(usage.byModel['gemini-3.1-flash-image']).toBe(1);
    });

    it('logs warning when daily limit is reached or exceeded', async () => {
      const { logger } = await import('../src/config/logger.js');
      const warnSpy = vi.spyOn(logger, 'warn');

      // Set usage to limit
      for (let i = 0; i < env.GEMINI_DAILY_LIMIT; i++) {
        await recordGeminiUsage('gemini-3.5-flash');
      }

      expect(warnSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          count: env.GEMINI_DAILY_LIMIT,
          limit: env.GEMINI_DAILY_LIMIT,
          model: 'gemini-3.5-flash',
        }),
        expect.stringContaining('limit reached or exceeded')
      );
    });

    it('verifies getTodayIST formatting is YYYY-MM-DD in Asia/Kolkata', () => {
      const today = getTodayIST();
      expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('records Gemini usage when generateCaption is called on GeminiAIProvider', async () => {
      const { GeminiAIProvider } = await import('../src/modules/ai/providers/geminiProvider.js');
      const provider = new GeminiAIProvider();
      vi.spyOn(provider, 'isConfigured').mockReturnValue(true);
      (provider as any).getClient = vi.fn().mockReturnValue({
        models: {
          generateContent: vi.fn().mockResolvedValue({
            text: JSON.stringify({
              headline: 'Luxury Villa',
              caption: 'Stunning property with modern amenities',
              hashtags: ['#luxury', '#villa'],
            }),
          }),
        },
      });

      await provider.generateCaption({
        projectName: 'Luxury Villa',
        city: 'Mohali',
      });

      const usage = await getTodayGeminiUsage();
      expect(usage.byModel[env.GEMINI_TEXT_MODEL]).toBeGreaterThanOrEqual(1);
    });

    it('records Gemini usage when generateImage is called on GeminiAIProvider', async () => {
      const { GeminiAIProvider } = await import('../src/modules/ai/providers/geminiProvider.js');
      const provider = new GeminiAIProvider();
      vi.spyOn(provider, 'isConfigured').mockReturnValue(true);
      vi.spyOn(defaultStorage, 'upload').mockResolvedValue({
        url: 'https://storage/img.png',
        key: 'ai-creatives/img.png',
        filename: 'img.png',
        mimetype: 'image/png',
        size: 100,
        provider: 'local',
      } as any);

      (provider as any).getClient = vi.fn().mockReturnValue({
        models: {
          generateContent: vi.fn().mockResolvedValue({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      inlineData: {
                        data: Buffer.from('test-image').toString('base64'),
                        mimeType: 'image/png',
                      },
                    },
                  ],
                },
              },
            ],
          }),
        },
      });

      await provider.generateImage({
        prompt: 'Luxury penthouse interior',
      });

      const usage = await getTodayGeminiUsage();
      expect(usage.byModel[env.GEMINI_IMAGE_MODEL]).toBeGreaterThanOrEqual(1);
    });

    it('records Gemini usage when imageToVideo is called on GeminiAIProvider', async () => {
      const { GeminiAIProvider } = await import('../src/modules/ai/providers/geminiProvider.js');
      const provider = new GeminiAIProvider();
      vi.spyOn(provider, 'isConfigured').mockReturnValue(true);
      (provider as any).getClient = vi.fn().mockReturnValue({
        models: {
          generateVideos: vi.fn().mockRejectedValue(new Error('Simulated stop')),
        },
      });

      const fakeImage = Buffer.from('fake-image-bytes');
      await expect(
        provider.imageToVideo({
          imageBuffer: fakeImage,
        })
      ).rejects.toThrow(/AI video generation/);

      const usage = await getTodayGeminiUsage();
      expect(usage.byModel[env.GEMINI_VIDEO_MODEL]).toBeGreaterThanOrEqual(1);
    });
  });

  describe('3. analyzeClip Caching & Bypass Behavior', () => {
    const fakeClipAnalysis: ClipAnalysis = {
      clipKey: 'video-lab/assets/broll.mp4',
      durationSeconds: 10,
      analyzedSeconds: 10,
      summary: 'Spacious living hall',
      shots: [
        {
          start: 0,
          end: 10,
          label: 'Living room',
          category: 'LIVING',
          quality: 4,
          hookScore: 3,
          issues: [],
          hasSpeech: false,
          bestStart: 0,
          bestEnd: 10,
          keep: true,
          reason: 'Good lighting',
        },
      ],
      sceneCuts: [],
      silences: [],
      model: 'gemini-3.5-flash',
      ms: 120,
      steps: [],
    };

    it('returns cached result with fromCache: true and skips Gemini on cache hit', async () => {
      // Seed cache
      await setCachedAnalysis('ANALYZE', 'video-lab/assets/broll.mp4', '', fakeClipAnalysis);

      const mockProvider = new MockAIProvider();
      const generateJsonSpy = vi.spyOn(mockProvider, 'generateJson');
      setAIProviderOverride(mockProvider);

      const result = await analyzeClip('video-lab/assets/broll.mp4', false);

      expect(result.fromCache).toBe(true);
      expect(result.summary).toBe('Spacious living hall');
      expect(generateJsonSpy).not.toHaveBeenCalled();
    });

    it('bypasses cache when force is true, calls Gemini, and saves fresh result', async () => {
      // Seed old cached result
      await setCachedAnalysis('ANALYZE', 'video-lab/assets/broll.mp4', '', {
        ...fakeClipAnalysis,
        summary: 'Old cached summary',
      });

      // Mock storage and ffmpeg media probe
      vi.spyOn(defaultStorage, 'ensureLocal').mockResolvedValue('C:/fake/path.mp4');
      vi.spyOn(ffmpegUtils, 'probeMedia').mockResolvedValue({
        durationSeconds: 10,
        hasVideo: true,
        hasAudio: false,
        width: 1080,
        height: 1920,
      });
      vi.spyOn(ffmpegUtils, 'runFfmpeg').mockImplementation(async (args: string[]) => {
        const out = args[args.length - 1];
        if (out && out !== '-') {
          await fsp.writeFile(out, Buffer.from('mock video data'));
        }
      });

      const mockProvider = new MockAIProvider();
      vi.spyOn(mockProvider, 'generateJson').mockResolvedValue({
        summary: 'Freshly analyzed living room',
        shots: [
          {
            start: 0,
            end: 10,
            label: 'Living room wide',
            category: 'LIVING',
            quality: 5,
            hookScore: 4,
            issues: [],
            hasSpeech: false,
            bestStart: 0,
            bestEnd: 10,
            keep: true,
            reason: 'Bright natural lighting',
          },
        ],
      });
      setAIProviderOverride(mockProvider);

      const result = await analyzeClip('video-lab/assets/broll.mp4', true);

      expect(result.fromCache).toBe(false);
      expect(result.summary).toBe('Freshly analyzed living room');

      // Verify DB was updated with fresh result
      const updatedCache = await getCachedAnalysis<ClipAnalysis>('ANALYZE', 'video-lab/assets/broll.mp4');
      expect(updatedCache?.summary).toBe('Freshly analyzed living room');
    });

    it('does not cache failed analyses', async () => {
      vi.spyOn(defaultStorage, 'ensureLocal').mockResolvedValue('C:/fake/path.mp4');
      vi.spyOn(ffmpegUtils, 'probeMedia').mockResolvedValue({
        durationSeconds: 10,
        hasVideo: true,
        hasAudio: false,
        width: 1080,
        height: 1920,
      });
      vi.spyOn(ffmpegUtils, 'runFfmpeg').mockImplementation(async (args: string[]) => {
        const out = args[args.length - 1];
        if (out && out !== '-') {
          await fsp.writeFile(out, Buffer.from('mock video data'));
        }
      });

      const mockProvider = new MockAIProvider();
      vi.spyOn(mockProvider, 'generateJson').mockRejectedValue(new Error('Gemini API quota exceeded'));
      setAIProviderOverride(mockProvider);

      await expect(analyzeClip('video-lab/assets/error_clip.mp4')).rejects.toThrow('Gemini API quota exceeded');

      const cached = await getCachedAnalysis('ANALYZE', 'video-lab/assets/error_clip.mp4');
      expect(cached).toBeNull();
    });
  });

  describe('4. transcribeClip Caching & Bypass Behavior', () => {
    const fakeTranscript: ClipTranscript = {
      clipKey: 'video-lab/assets/narration.mp4',
      language: 'hi',
      hasSpeech: true,
      spokenLanguage: 'Hindi',
      keywords: ['3 BHK', 'Mohali'],
      cues: [
        { start: 0, end: 2.5, text: 'यह मोहाली का सबसे प्रीमियम प्रोजेक्ट है।' },
      ],
      model: 'gemini-3.5-flash',
      ms: 95,
    };

    it('returns cached transcript with fromCache: true and skips Gemini on hit', async () => {
      await setCachedAnalysis('TRANSCRIBE', 'video-lab/assets/narration.mp4', 'hi', fakeTranscript);

      const mockProvider = new MockAIProvider();
      const generateJsonSpy = vi.spyOn(mockProvider, 'generateJson');
      setAIProviderOverride(mockProvider);

      const result = await transcribeClip('video-lab/assets/narration.mp4', 'hi', false);

      expect(result.fromCache).toBe(true);
      expect(result.cues).toHaveLength(1);
      expect(result.cues[0].text).toBe('यह मोहाली का सबसे प्रीमियम प्रोजेक्ट है।');
      expect(generateJsonSpy).not.toHaveBeenCalled();
    });

    it('bypasses cache when force is true, calls Gemini, and saves fresh transcript', async () => {
      await setCachedAnalysis('TRANSCRIBE', 'video-lab/assets/narration.mp4', 'hi', {
        ...fakeTranscript,
        spokenLanguage: 'Old Language',
      });

      vi.spyOn(defaultStorage, 'ensureLocal').mockResolvedValue('C:/fake/narration.mp4');
      vi.spyOn(ffmpegUtils, 'probeMedia').mockResolvedValue({
        durationSeconds: 15,
        hasVideo: true,
        hasAudio: true,
      });
      vi.spyOn(ffmpegUtils, 'runFfmpeg').mockImplementation(async (args: string[]) => {
        const out = args[args.length - 1];
        if (out && out !== '-') {
          await fsp.writeFile(out, Buffer.from('mock video data'));
        }
      });

      const mockProvider = new MockAIProvider();
      vi.spyOn(mockProvider, 'generateJson').mockResolvedValue({
        hasSpeech: true,
        spokenLanguage: 'Hindi (Fluent)',
        keywords: ['Mohali', 'Luxury'],
        segments: [{ start: 0, end: 2.0, text: 'ताज़ा अपडेट' }],
      });
      setAIProviderOverride(mockProvider);

      const result = await transcribeClip('video-lab/assets/narration.mp4', 'hi', true);

      expect(result.fromCache).toBe(false);
      expect(result.spokenLanguage).toBe('Hindi (Fluent)');

      const updated = await getCachedAnalysis<ClipTranscript>('TRANSCRIBE', 'video-lab/assets/narration.mp4', 'hi');
      expect(updated?.spokenLanguage).toBe('Hindi (Fluent)');
    });

    it('does not cache transcription errors', async () => {
      vi.spyOn(defaultStorage, 'ensureLocal').mockResolvedValue('C:/fake/narration.mp4');
      vi.spyOn(ffmpegUtils, 'probeMedia').mockResolvedValue({
        durationSeconds: 15,
        hasVideo: true,
        hasAudio: true,
      });
      vi.spyOn(ffmpegUtils, 'runFfmpeg').mockImplementation(async (args: string[]) => {
        const out = args[args.length - 1];
        if (out && out !== '-') {
          await fsp.writeFile(out, Buffer.from('mock video data'));
        }
      });

      const mockProvider = new MockAIProvider();
      vi.spyOn(mockProvider, 'generateJson').mockRejectedValue(new Error('Audio processing failed'));
      setAIProviderOverride(mockProvider);

      await expect(transcribeClip('video-lab/assets/fail_narration.mp4', 'hi')).rejects.toThrow('Audio processing failed');

      const cached = await getCachedAnalysis('TRANSCRIBE', 'video-lab/assets/fail_narration.mp4', 'hi');
      expect(cached).toBeNull();
    });
  });
});
