import { geminiService, GeneratedImageResult, GeneratedCopyResult } from '../../services/gemini.service.js';
import { GenerateImageInput, GenerateCopyInput } from './validation.js';
import { UsageLedger, MediaAsset } from '../../models/index.js';
import mongoose from 'mongoose';

export class AiModuleService {
  public async generateImage(input: GenerateImageInput): Promise<GeneratedImageResult> {
    const result = await geminiService.generateImage(input.prompt, {
      aspectRatio: input.aspectRatio,
      projectName: input.projectName,
    });

    // If an organizationId is provided and valid, record telemetry to database
    if (input.organizationId && mongoose.isValidObjectId(input.organizationId)) {
      try {
        const orgId = new mongoose.Types.ObjectId(input.organizationId);

        // Record usage ledger
        await UsageLedger.create({
          organizationId: orgId,
          creditType: 'IMAGE_RENDER',
          amount: 1,
          balanceAfter: 4999,
          description: `AI Image render for prompt: "${input.prompt.slice(0, 40)}..."`,
        });

        // Store into media assets
        await MediaAsset.create({
          organizationId: orgId,
          filename: `ai-${Date.now()}.png`,
          storageKey: result.key,
          url: result.url,
          mimetype: 'image/png',
          sizeBytes: 1024,
          aspectRatio: input.aspectRatio || '4:5',
          tags: ['AI_GENERATED', 'GEMINI_CREATIVE'],
        });
      } catch {
        // Telemetry errors should not block generation response
      }
    }

    return result;
  }

  public async generateCopy(input: GenerateCopyInput): Promise<GeneratedCopyResult> {
    const result = await geminiService.generateCopy({
      projectName: input.projectName,
      category: input.category,
      location: input.location,
      tone: input.tone,
      language: input.language,
    });

    if (input.organizationId && mongoose.isValidObjectId(input.organizationId)) {
      try {
        await UsageLedger.create({
          organizationId: new mongoose.Types.ObjectId(input.organizationId),
          creditType: 'AI_COPY',
          amount: 1,
          balanceAfter: 4998,
          description: `AI Marketing copy generated for ${input.projectName}`,
        });
      } catch {
        // Ignore telemetry errors
      }
    }

    return result;
  }
}

export const aiModuleService = new AiModuleService();
