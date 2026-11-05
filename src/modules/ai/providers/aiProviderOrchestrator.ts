import { env } from '../../../config/env.js';
import { logger } from '../../../config/logger.js';
import {
  IAIProvider,
  ImageProvider,
  CaptionPromptData,
  GeneratedCaptionResult,
  GenerateImageOptions,
  GeneratedImageResult,
  GenerateJsonOptions,
  ImageToVideoOptions,
  GeneratedVideoResult,
  ImageAnalysisOptions,
  ImageAnalysisResult,
} from './provider.interface.js';
import { FalAiProvider } from './falAiProvider.js';
import { ReplicateAiProvider } from './replicateAiProvider.js';
import { GeminiAIProvider } from './geminiProvider.js';
import { EnhancedLocalProvider } from './enhancedLocalProvider.js';

/**
 * Routes each AI task to the right provider:
 * - text, captions, JSON, photo analysis, video → Gemini
 * - image-to-image / ControlNet → fal.ai, Replicate or Gemini (IMAGE_TO_IMAGE_PROVIDER, default 'auto')
 *
 * No fake output: when the chosen provider fails, the error is passed on (AI_NOT_CONFIGURED,
 * AI_QUOTA_EXCEEDED, ...). The local enhancer is used only when IMAGE_TO_IMAGE_PROVIDER=local is set.
 */
export class AIProviderOrchestrator implements IAIProvider {
  public readonly name = 'ai-provider-orchestrator';

  private falProvider = new FalAiProvider();
  private replicateProvider = new ReplicateAiProvider();
  private geminiProvider = new GeminiAIProvider();
  private localProvider = new EnhancedLocalProvider();

  public isConfigured(): boolean {
    return this.geminiProvider.isConfigured();
  }

  /** Gemini status (models, costs, never the key) plus which image-to-image provider is active. */
  public async checkHealth() {
    return { ...(await this.geminiProvider.checkHealth()), imageProvider: this.getPrimaryImageProvider().name };
  }

  /**
   * Image-to-image provider from IMAGE_TO_IMAGE_PROVIDER and the keys that are set.
   * 'auto' prefers ControlNet-capable cloud providers, then Gemini (which errors clearly if not configured).
   */
  public getPrimaryImageProvider(): ImageProvider {
    const pref = env.IMAGE_TO_IMAGE_PROVIDER;

    if (pref === 'fal' && this.falProvider.isConfigured()) return this.falProvider;
    if (pref === 'replicate' && this.replicateProvider.isConfigured()) return this.replicateProvider;
    if (pref === 'gemini') return this.geminiProvider;
    if (pref === 'local') return this.localProvider;

    if (this.falProvider.isConfigured()) return this.falProvider;
    if (this.replicateProvider.isConfigured()) return this.replicateProvider;
    return this.geminiProvider;
  }

  public generateJson<T = unknown>(prompt: string, options?: GenerateJsonOptions): Promise<T> {
    return this.geminiProvider.generateJson<T>(prompt, options);
  }

  public generateCaption(data: CaptionPromptData): Promise<GeneratedCaptionResult> {
    return this.geminiProvider.generateCaption(data);
  }

  public imageToVideo(options: ImageToVideoOptions): Promise<GeneratedVideoResult> {
    return this.geminiProvider.imageToVideo(options);
  }

  public async generateImage(options: GenerateImageOptions): Promise<GeneratedImageResult> {
    const primary = this.getPrimaryImageProvider();
    logger.info({ provider: primary.name, mode: options.mode }, 'Executing AI image generation');
    return primary.generateImage(options);
  }

  public analyzeImage(options: ImageAnalysisOptions): Promise<ImageAnalysisResult> {
    return this.geminiProvider.analyzeImage(options);
  }
}

export const aiOrchestrator = new AIProviderOrchestrator();
