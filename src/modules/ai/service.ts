import fs from 'fs/promises';
import mongoose from 'mongoose';
import { GenerateImageInput, GenerateCopyInput } from './validation.js';
import { UsageLedger, MediaAsset } from '../../models/index.js';
import { Subscription } from '../../models/Subscription.js';
import { getAIProvider } from './providers/index.js';
import { defaultStorage } from '../../storage/localStorage.adapter.js';
import { AppError } from '../../utils/AppError.js';
import { logger } from '../../config/logger.js';

export interface GeneratedImageResult {
  url: string;
  key: string;
  prompt: string;
  model: string;
}

export interface GeneratedCopyResult {
  hooks: string[];
  captions: { short: string; long: string };
  hashtags: string[];
  language: string;
  model: string;
}

export class AiModuleService {
  public async generateImage(input: GenerateImageInput): Promise<GeneratedImageResult> {
    // Throws a clear AI_* error (not configured / quota / blocked) instead of returning a placeholder
    const result = await getAIProvider().generateImage({
      prompt: input.prompt,
      aspectRatio: input.aspectRatio,
      projectName: input.projectName,
    });
    if (!result.key) {
      throw AppError.internal('AI image generation returned no file');
    }

    if (input.organizationId && mongoose.isValidObjectId(input.organizationId)) {
      const orgId = new mongoose.Types.ObjectId(input.organizationId);
      try {
        const sizeBytes = await fs
          .stat(defaultStorage.getAbsolutePath(result.key))
          .then((s) => s.size)
          .catch(() => 0);
        const subscription = await Subscription.findOne({ organizationId: orgId });

        await UsageLedger.create({
          organizationId: orgId,
          creditType: 'IMAGE_RENDER',
          amount: 1,
          balanceAfter: subscription?.creditsRemaining ?? 0,
          description: `AI image for prompt: "${input.prompt.slice(0, 40)}..."`,
        });

        await MediaAsset.create({
          organizationId: orgId,
          filename: result.key.split('/').pop() || `ai-${Date.now()}.png`,
          storageKey: result.key,
          url: result.url,
          mimetype: 'image/png',
          sizeBytes,
          aspectRatio: input.aspectRatio || '4:5',
          tags: ['AI_GENERATED', 'GEMINI_CREATIVE'],
        });
      } catch (err) {
        // Bookkeeping failures shouldn't hide a successful generation
        logger.warn({ err }, 'Failed to record AI image usage');
      }
    }

    return { url: result.url, key: result.key, prompt: input.prompt, model: result.model };
  }

  public async generateCopy(input: GenerateCopyInput): Promise<GeneratedCopyResult> {
    const language = input.language || 'English';
    const facts = [
      `Project name: ${input.projectName}`,
      input.category ? `Category: ${input.category}` : null,
      input.location ? `Location: ${input.location}` : null,
    ]
      .filter(Boolean)
      .join('\n');

    const parsed = await getAIProvider().generateJson<{
      hooks?: unknown;
      shortCaption?: unknown;
      longCaption?: unknown;
      hashtags?: unknown;
    }>(
      `You are a real estate marketing copywriter. Write social media copy in ${language}${
        input.tone ? ` with a ${input.tone} tone` : ''
      }.

Facts (use ONLY these — do not invent prices, amenities, views, materials, distances, phone numbers or RERA details):
${facts}

Return JSON: {"hooks": [3 one-line hooks], "shortCaption": "2 sentences with a call to action", "longCaption": "4 sentences", "hashtags": [up to 8 hashtags]}`,
      { feature: 'AI copywriting' }
    );

    const hooks = Array.isArray(parsed.hooks) ? parsed.hooks.map(String).filter(Boolean) : [];
    if (hooks.length === 0 || !parsed.shortCaption || !parsed.longCaption) {
      throw new AppError(502, 'AI_FAILED', 'AI copywriting failed: Gemini returned incomplete copy. Please try again.');
    }

    if (input.organizationId && mongoose.isValidObjectId(input.organizationId)) {
      try {
        const orgId = new mongoose.Types.ObjectId(input.organizationId);
        const subscription = await Subscription.findOne({ organizationId: orgId });
        await UsageLedger.create({
          organizationId: orgId,
          creditType: 'AI_COPY',
          amount: 1,
          balanceAfter: subscription?.creditsRemaining ?? 0,
          description: `AI marketing copy for ${input.projectName}`,
        });
      } catch (err) {
        logger.warn({ err }, 'Failed to record AI copy usage');
      }
    }

    return {
      hooks,
      captions: { short: String(parsed.shortCaption), long: String(parsed.longCaption) },
      hashtags: Array.isArray(parsed.hashtags) ? parsed.hashtags.map(String) : [],
      language,
      model: 'gemini',
    };
  }
}

export const aiModuleService = new AiModuleService();
