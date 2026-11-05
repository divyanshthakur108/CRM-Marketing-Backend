import { GoogleGenAI } from '@google/genai';
import {
  IAIProvider,
  CaptionPromptData,
  GeneratedCaptionResult,
  GenerateImageOptions,
  GeneratedImageResult,
  ImageToVideoOptions,
  GeneratedVideoResult,
  ImageAnalysisOptions,
  ImageAnalysisResult,
  GenerateJsonOptions,
} from './provider.interface.js';
import { aiNotConfigured, toAiError } from '../../../utils/aiErrors.js';
import { env, maskSecret } from '../../../config/env.js';
import { logger } from '../../../config/logger.js';
import { defaultStorage } from '../../../storage/localStorage.adapter.js';
import { AppError } from '../../../utils/AppError.js';
import fs from 'fs/promises';
import path from 'path';

export class GeminiAIProvider implements IAIProvider {
  public readonly name = 'gemini';
  private client: GoogleGenAI | null = null;
  private healthCached: boolean | null = null;

  constructor() {
    if (this.isConfigured()) {
      try {
        this.client = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
      } catch (err) {
        logger.warn({ err: this.sanitizeError(err) }, 'Failed to initialize GoogleGenAI client');
      }
    }
  }

  /**
   * Safe check if Gemini API is configured without revealing keys
   */
  public isConfigured(): boolean {
    return Boolean(
      env.AI_PROVIDER === 'gemini' &&
      env.GEMINI_API_KEY &&
      env.GEMINI_API_KEY.trim().length > 0 &&
      env.GEMINI_API_KEY !== 'your_gemini_api_key_here'
    );
  }

  /**
   * Runs a JSON-returning prompt (optionally with photos for vision) and parses the result.
   */
  public async generateJson<T = unknown>(prompt: string, options: GenerateJsonOptions = {}): Promise<T> {
    const feature = options.feature || 'AI generation';
    if (!this.isConfigured()) throw aiNotConfigured(feature);

    const parts: Array<Record<string, unknown>> = (options.images || []).map((img) => ({
      inlineData: { data: img.data.toString('base64'), mimeType: img.mimeType || 'image/jpeg' },
    }));
    parts.push({ text: prompt });

    try {
      const ai = this.getClient();
      const response = await this.retryWithBackoff(() =>
        ai.models.generateContent({
          model: env.GEMINI_TEXT_MODEL,
          contents: [{ role: 'user', parts }],
          config: { responseMimeType: 'application/json' },
        })
      );
      this.checkSafetyFeedback(response);
      const parsed = this.parseJson(response.text || '');
      if (parsed === null || parsed === undefined) {
        throw new Error('Gemini returned an empty or non-JSON response');
      }
      return parsed as T;
    } catch (err) {
      throw toAiError(this.sanitizeError(err), feature);
    }
  }

  private parseJson(text: string): any {
    const clean = text.replace(/```json/g, '').replace(/```/g, '').trim();
    if (!clean) return null;
    try {
      return JSON.parse(clean);
    } catch {
      const match = clean.match(/[\[{][\s\S]*[\]}]/);
      if (!match) throw new Error('Gemini returned text that is not valid JSON');
      return JSON.parse(match[0]);
    }
  }

  /**
   * Health endpoint status (at most one check call)
   */
  public async checkHealth(): Promise<{
    configured: boolean;
    imageModel: string;
    videoModel: string;
    costPerImageUsd: number;
    costPerVideoSecondUsd: number;
    dailyCapUsd: number;
    maxVideoSecondsPerReel: number;
  }> {
    const configured = this.isConfigured();
    if (!configured) {
      return {
        configured: false,
        imageModel: env.GEMINI_IMAGE_MODEL,
        videoModel: env.GEMINI_VIDEO_MODEL,
        costPerImageUsd: 0.03,
        costPerVideoSecondUsd: 0.06,
        dailyCapUsd: env.AI_DAILY_COST_CAP_USD,
        maxVideoSecondsPerReel: env.AI_MAX_VIDEO_SECONDS_PER_REEL,
      };
    }

    if (this.healthCached === null && this.client) {
      try {
        // One cheap check call: countTokens on a 1-word text
        await this.client.models.countTokens({
          model: env.GEMINI_TEXT_MODEL,
          contents: 'health',
        });
        this.healthCached = true;
      } catch (err: unknown) {
        const errMsg = this.sanitizeError(err);
        logger.warn({ error: errMsg }, 'Gemini health ping failed');
        this.healthCached = false;
      }
    }

    return {
      configured: this.healthCached ?? true,
      imageModel: env.GEMINI_IMAGE_MODEL,
      videoModel: env.GEMINI_VIDEO_MODEL,
      costPerImageUsd: 0.03,
      costPerVideoSecondUsd: 0.06,
      dailyCapUsd: env.AI_DAILY_COST_CAP_USD,
      maxVideoSecondsPerReel: env.AI_MAX_VIDEO_SECONDS_PER_REEL,
    };
  }

  /**
   * Generate captions using Gemini text models
   */
  public async generateCaption(data: CaptionPromptData): Promise<GeneratedCaptionResult> {
    if (!this.isConfigured()) {
      throw aiNotConfigured();
    }

    const lang = data.language || 'English';
    const prompt = `You are an elite real estate marketing copywriter. Generate marketing copy for:
Project: ${data.projectName}
Category: ${data.category || 'Luxury Residential'}
Location: ${data.micromarket || data.city || 'Prime Metropolitan'}
Tone: ${data.tone || 'Sophisticated, Exclusive'}
Language: ${lang}
Price: ${data.priceDisplay || 'Upon Request'}

Output strict JSON with keys:
"headline": "compelling 1-line hook",
"caption": "detailed 3-sentence description with CTA",
"hashtags": ["array", "of", "6", "tags"]`;

    try {
      const ai = this.getClient();
      const response = await this.retryWithBackoff(() =>
        ai.models.generateContent({
          model: env.GEMINI_TEXT_MODEL,
          contents: prompt,
          config: { responseMimeType: 'application/json' },
        })
      );

      const parsed = this.parseJson(response.text || '');
      if (!parsed?.headline || !parsed?.caption) {
        throw new Error('Gemini returned an incomplete caption (missing headline or caption)');
      }

      return {
        headline: String(parsed.headline),
        caption: String(parsed.caption),
        hashtags: Array.isArray(parsed.hashtags) ? parsed.hashtags.map(String) : [],
        language: lang,
        model: env.GEMINI_TEXT_MODEL,
      };
    } catch (err) {
      throw toAiError(this.sanitizeError(err), 'AI caption generation');
    }
  }

  /**
   * Generate or enhance real estate marketing images using Imagen / Gemini
   */
  public async generateImage(options: GenerateImageOptions): Promise<GeneratedImageResult> {
    if (!this.isConfigured()) {
      throw aiNotConfigured();
    }

    const aspectRatio = options.aspectRatio || '4:5';
    const ai = this.getClient();

    let imageBuffer: Buffer | null = options.sourceImageBuffer || null;
    if (!imageBuffer && options.sourceImageUrl) {
      imageBuffer = await this.fetchImageBuffer(options.sourceImageUrl);
    }

    try {
      if (imageBuffer) {
        // Image edit / background enhancement mode
        const prompt = options.prompt ||
          'Subtle architectural lighting and background enhancement. Keep room structure, walls, windows, furniture, and all objects exactly as they are. Do not add or remove any objects. Enhance natural lighting and clarity.';

        const response = await this.retryWithBackoff(() =>
          ai.models.generateContent({
            model: env.GEMINI_IMAGE_MODEL,
            contents: [
              {
                role: 'user',
                parts: [
                  {
                    inlineData: {
                      data: imageBuffer!.toString('base64'),
                      mimeType: 'image/jpeg',
                    },
                  },
                  { text: prompt },
                ],
              },
            ],
          })
        );

        // Check for safety filter blocks
        this.checkSafetyFeedback(response);

        const imgPart = response.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
        if (!imgPart?.inlineData?.data) {
          throw new Error('blocked by provider: No image content generated');
        }

        const outBuffer = Buffer.from(imgPart.inlineData.data, 'base64');
        const upload = await defaultStorage.upload(
          {
            buffer: outBuffer,
            filename: `gemini-enhanced-${Date.now()}.png`,
            mimetype: imgPart.inlineData.mimeType || 'image/png',
          },
          'ai-creatives'
        );

        return {
          url: upload.url,
          key: upload.key,
          format: aspectRatio,
          model: env.GEMINI_IMAGE_MODEL,
          isIllustrative: true,
        };
      } else {
        // Text-to-image architectural generation mode
        const prompt = `Render a photorealistic architectural photograph for luxury property: ${options.prompt}. Aspect ratio ${aspectRatio}. Golden hour architectural lighting, pristine ultra-luxury finish.`;

        const response = await this.retryWithBackoff(() =>
          ai.models.generateContent({
            model: env.GEMINI_IMAGE_MODEL,
            contents: prompt,
          })
        );

        this.checkSafetyFeedback(response);

        const imgPart = response.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
        if (!imgPart?.inlineData?.data) {
          throw new Error('blocked by provider: No image data returned');
        }

        const outBuffer = Buffer.from(imgPart.inlineData.data, 'base64');
        const upload = await defaultStorage.upload(
          {
            buffer: outBuffer,
            filename: `gemini-img-${Date.now()}.png`,
            mimetype: imgPart.inlineData.mimeType || 'image/png',
          },
          'ai-creatives'
        );

        return {
          url: upload.url,
          key: upload.key,
          format: aspectRatio,
          model: env.GEMINI_IMAGE_MODEL,
          isIllustrative: true,
        };
      }
    } catch (err: unknown) {
      throw toAiError(this.sanitizeError(err), 'AI image generation');
    }
  }

  /**
   * Convert first-frame photo to short cinematic video clip using Veo
   */
  public async imageToVideo(options: ImageToVideoOptions): Promise<GeneratedVideoResult> {
    if (!this.isConfigured()) {
      throw aiNotConfigured();
    }

    let imageBuffer: Buffer | null = options.imageBuffer || null;
    const sourceUrl = options.imageUrl || options.firstFrameUrl;
    if (!imageBuffer && sourceUrl) {
      imageBuffer = await this.fetchImageBuffer(sourceUrl);
    }

    if (!imageBuffer) {
      throw AppError.badRequest('First-frame image is required for AI video motion clip');
    }

    // 4 camera moves cycling per scene index:
    const CAMERA_MOVES = [
      'gentle push-in',
      'slow pan-left',
      'slow pan-right',
      'gentle tilt-up',
    ];
    const cameraMove = CAMERA_MOVES[Math.abs(options.sceneIndex ?? 0) % CAMERA_MOVES.length];

    // Standard Veo motion prompt per specification
    const motionPrompt =
      options.motionPrompt ||
      `Use the provided photo as the first frame. Create a 4-second vertical 9:16 real-estate video clip with a slow, smooth, steady camera move: ${cameraMove}. Keep every object, furniture, wall, window, ceiling and the room layout exactly as in the photo. Do not add, remove, resize or change anything. Natural indoor lighting, realistic, professional property tour look. No people, no text, no logos, no watermark, no music, no morphing, no warping, no flicker.`;

    const durationSeconds = Math.min(
      options.durationSeconds || 4,
      env.AI_MAX_VIDEO_SECONDS_PER_REEL
    );

    const ai = this.getClient();

    try {
      // 1. Submit asynchronous video generation request
      logger.info({ model: env.GEMINI_VIDEO_MODEL }, 'Submitting Veo video generation job');

      const operation = await this.retryWithBackoff(() =>
        ai.models.generateVideos({
          model: env.GEMINI_VIDEO_MODEL,
          source: {
            prompt: motionPrompt,
            image: {
              imageBytes: imageBuffer!.toString('base64'),
              mimeType: 'image/jpeg',
            },
          },
          config: {
            aspectRatio: '9:16',
            durationSeconds,
            personGeneration: 'allow_adult',
            generateAudio: false, // Provider audio stripped per prompt requirements
          },
        })
      );

      const operationName = (operation as { name?: string }).name;
      if (!operationName) {
        throw new Error('Veo provider did not return an operation ID');
      }

      // 2. Poll long-running operation until complete with backoff & timeout (if not already done)
      let finishedOp: any;
      if ((operation as any).done) {
        if ((operation as any).error) {
          const errObj = (operation as any).error;
          const message = errObj.message || JSON.stringify(errObj);
          if (message.toLowerCase().includes('safety') || message.toLowerCase().includes('policy')) {
            throw new Error(`blocked by provider: ${message}`);
          }
          throw new Error(message);
        }
        finishedOp = operation;
      } else {
        logger.info({ operationName }, 'Veo video job submitted successfully. Polling progress...');
        finishedOp = await this.pollOperation(operationName, 180000); // 3 minutes timeout
      }

      // 3. Check for safety rating blocks
      if (finishedOp.response?.raiMediaFilteredCount && finishedOp.response.raiMediaFilteredCount > 0) {
        const reasons = finishedOp.response.raiMediaFilteredReasons?.join(', ') || 'policy violation';
        throw new Error(`blocked by provider: Safety filter triggered (${reasons})`);
      }

      const generatedVideo = finishedOp.response?.generatedVideos?.[0];
      const videoUri = generatedVideo?.video?.uri;
      if (!videoUri) {
        throw new Error('blocked by provider: No video file returned in completed operation');
      }

      // 4. Download video IMMEDIATELY to avoid signed URL expiration
      logger.info({ videoUri }, 'Downloading Veo video before URL expiration');
      const videoBuffer = await this.downloadVideoBuffer(videoUri);

      // 5. Store downloaded video through StorageAdapter
      const storageKey = `ai-videos/veo-${Date.now()}-${Math.random().toString(36).substring(2, 8)}.mp4`;
      const upload = await defaultStorage.upload(
        {
          buffer: videoBuffer,
          filename: path.basename(storageKey),
          mimetype: 'video/mp4',
        },
        'ai-creatives'
      );

      return {
        videoUrl: upload.url,
        storageKey: upload.key,
        durationSeconds,
        format: '9:16',
        model: env.GEMINI_VIDEO_MODEL,
        operationId: operationName,
        isIllustrative: true,
      };
    } catch (err: unknown) {
      throw toAiError(this.sanitizeError(err), 'AI video generation');
    }
  }

  /**
   * Polls long-running operation until complete or timeout
   */
  private async pollOperation(operationName: string, timeoutMs: number): Promise<any> {
    const ai = this.getClient();
    const startTime = Date.now();
    let pollInterval = 4000; // Start at 4s

    while (Date.now() - startTime < timeoutMs) {
      await new Promise((r) => setTimeout(r, pollInterval));

      try {
        const currentOp = await ai.operations.getVideosOperation({
          operation: { name: operationName } as any,
        });

        if (currentOp && (currentOp as any).done) {
          if ((currentOp as any).error) {
            const errObj = (currentOp as any).error;
            const message = errObj.message || JSON.stringify(errObj);
            if (message.toLowerCase().includes('safety') || message.toLowerCase().includes('policy')) {
              throw new Error(`blocked by provider: ${message}`);
            }
            throw new Error(message);
          }
          return currentOp;
        }

        // Exponential backoff up to 10s intervals
        pollInterval = Math.min(pollInterval * 1.25, 10000);
      } catch (err: any) {
        if (err.message && err.message.includes('blocked by provider')) {
          throw err;
        }
        logger.warn({ error: this.sanitizeError(err) }, 'Transient poll error; continuing wait');
      }
    }

    throw new Error(`Video generation operation timed out after ${timeoutMs / 1000} seconds`);
  }

  /**
   * Downloads video binary immediately from URI
   */
  private async downloadVideoBuffer(uri: string): Promise<Buffer> {
    if ((uri.startsWith('http://') || uri.startsWith('https://')) && !uri.includes('generativelanguage.googleapis.com')) {
      try {
        const response = await fetch(uri);
        if (response.ok) {
          const arrayBuffer = await response.arrayBuffer();
          return Buffer.from(arrayBuffer);
        }
      } catch {
        // Fall through to Files API
      }
    }

    // Try Files API if uri is a Google Files resource
    const tempFile = path.resolve(process.cwd(), 'storage', 'scratch', `veo-dl-${Date.now()}.mp4`);
    await fs.mkdir(path.dirname(tempFile), { recursive: true });
    try {
      const ai = this.getClient();
      await ai.files.download({ file: uri, downloadPath: tempFile });
      const buf = await fs.readFile(tempFile);
      await fs.unlink(tempFile).catch(() => {});
      return buf;
    } catch {
      await fs.unlink(tempFile).catch(() => {});
      // Direct authenticated fetch fallback
      const directUrl = `${uri}${uri.includes('?') ? '&' : '?'}key=${env.GEMINI_API_KEY}`;
      const response = await fetch(directUrl);
      if (!response.ok) {
        throw new Error(`Failed to fetch video binary from provider: ${response.statusText}`);
      }
      const arrayBuffer = await response.arrayBuffer();
      return Buffer.from(arrayBuffer);
    }
  }

  private getClient(): GoogleGenAI {
    if (!this.client) {
      if (!this.isConfigured()) {
        throw aiNotConfigured();
      }
      this.client = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
    }
    return this.client;
  }

  /**
   * Retries operation with exponential backoff on HTTP 429 rate limits
   */
  private async retryWithBackoff<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
    let delay = 1000;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (err: any) {
        const errMsg = this.sanitizeError(err);
        const isRateLimit =
          errMsg.includes('429') ||
          errMsg.toLowerCase().includes('quota') ||
          errMsg.toLowerCase().includes('rate limit');
        // Gemini is temporarily overloaded ("high demand", 503 UNAVAILABLE)
        const isBusy = /"code":\s*503|UNAVAILABLE|overloaded|high demand/i.test(errMsg);

        if ((isRateLimit || isBusy) && attempt < maxRetries) {
          logger.warn(
            { attempt, delay, reason: isBusy ? 'busy' : 'rate-limit' },
            'Gemini API busy or rate limited. Backing off before retry...'
          );
          await new Promise((r) => setTimeout(r, delay));
          delay *= 2;
          continue;
        }

        // If safety filter or other error, do not retry
        throw err;
      }
    }
    throw new Error('Max retries exceeded');
  }

  /**
   * Checks for safety blocks in Gemini response metadata
   */
  private checkSafetyFeedback(response: any): void {
    const promptFeedback = response?.promptFeedback;
    if (promptFeedback?.blockReason) {
      throw new Error(`blocked by provider: ${promptFeedback.blockReason}`);
    }

    const candidate = response?.candidates?.[0];
    if (candidate?.finishReason === 'SAFETY') {
      const safetyRatings = candidate.safetyRatings
        ?.filter((r: any) => r.blocked)
        .map((r: any) => `${r.category}:${r.probability}`)
        .join(', ');
      throw new Error(`blocked by provider: Safety rating block (${safetyRatings || 'RESTRICTED'})`);
    }
  }

  private async fetchImageBuffer(url: string): Promise<Buffer> {
    if (url.startsWith('/storage/')) {
      const absPath = await defaultStorage.ensureLocal(url.replace('/storage/', ''));
      return fs.readFile(absPath);
    }
    if (url.startsWith('http://') || url.startsWith('https://')) {
      const res = await fetch(url);
      const ab = await res.arrayBuffer();
      return Buffer.from(ab);
    }
    const cleanPath = url.replace(/^[/\\]+/, '');
    const absPath = await defaultStorage.ensureLocal(cleanPath);
    return fs.readFile(absPath);
  }

  /**
   * AI vision analysis of one property photo: room category, visible features, lighting, angle.
   * Fails with a clear AI error (never invented defaults) when Gemini is unavailable or unsure.
   */
  public async analyzeImage(options: ImageAnalysisOptions): Promise<ImageAnalysisResult> {
    const parsed = await this.generateJson<{
      category?: string;
      detectedFeatures?: unknown[];
      lighting?: string;
      perspective?: string;
      isFurnished?: boolean;
      dominantColors?: unknown[];
    }>(
      `Analyze this real estate property photograph. Describe ONLY what is clearly visible; do not guess.
Identify:
1. Room/space category, strictly one of: "Grand Living Room", "Master Bedroom Suite", "Modular Island Kitchen", "Spa En-Suite Bathroom", "Panoramic Sky Balcony", "Ceiling & Architectural Lighting", "Exterior Facade & Arrival", "Formal Dining Foyer", "Resident Clubhouse & Amenities".
2. Up to 3 architectural features actually visible.
3. Lighting profile.
4. Perspective / camera angle.
5. Whether it appears furnished (true/false).
6. Up to 2 dominant colors.

Respond with JSON: {"category": "...", "detectedFeatures": ["..."], "lighting": "...", "perspective": "...", "isFurnished": true, "dominantColors": ["..."]}`,
      {
        images: [{ data: options.imageBuffer, mimeType: options.mimeType || 'image/jpeg' }],
        feature: 'AI photo analysis',
      }
    );

    if (!parsed.category) {
      throw toAiError('Gemini returned an incomplete photo analysis (no category)', 'AI photo analysis');
    }
    return {
      category: String(parsed.category),
      detectedFeatures: Array.isArray(parsed.detectedFeatures) ? parsed.detectedFeatures.map(String).slice(0, 3) : [],
      lighting: parsed.lighting ? String(parsed.lighting) : '',
      perspective: parsed.perspective ? String(parsed.perspective) : '',
      isFurnished: typeof parsed.isFurnished === 'boolean' ? parsed.isFurnished : undefined,
      dominantColors: Array.isArray(parsed.dominantColors) ? parsed.dominantColors.map(String).slice(0, 2) : [],
    };
  }

  /**
   * Strips any raw API keys from errors or log objects
   */
  private sanitizeError(err: unknown): string {
    if (!err) return 'Unknown error';
    let str = typeof err === 'string' ? err : (err as any).message || JSON.stringify(err);
    if (env.GEMINI_API_KEY && env.GEMINI_API_KEY.length > 5) {
      str = str.split(env.GEMINI_API_KEY).join(maskSecret(env.GEMINI_API_KEY));
    }
    return str;
  }
}

export const geminiProvider = new GeminiAIProvider();
