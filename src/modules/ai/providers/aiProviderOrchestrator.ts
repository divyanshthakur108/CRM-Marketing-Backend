import { env } from '../../../config/env.js';
import { logger } from '../../../config/logger.js';
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
} from './provider.interface.js';
import { FalAiProvider } from './falAiProvider.js';
import { ReplicateAiProvider } from './replicateAiProvider.js';
import { GeminiAIProvider } from './geminiProvider.js';
import { EnhancedLocalProvider } from './enhancedLocalProvider.js';
import { MockAIProvider } from './mockProvider.js';

export class AIProviderOrchestrator implements IAIProvider {
  public readonly name = 'ai-provider-orchestrator';

  private falProvider = new FalAiProvider();
  private replicateProvider = new ReplicateAiProvider();
  private geminiProvider = new GeminiAIProvider();
  private localProvider = new EnhancedLocalProvider();
  private mockProvider = new MockAIProvider();

  public isConfigured(): boolean {
    return true;
  }

  /**
   * Resolves the primary Image-to-Image provider based on configuration and available API keys
   */
  public getPrimaryImageProvider(): IAIProvider {
    const pref = env.IMAGE_TO_IMAGE_PROVIDER;

    if (pref === 'fal' && this.falProvider.isConfigured()) {
      return this.falProvider;
    }
    if (pref === 'replicate' && this.replicateProvider.isConfigured()) {
      return this.replicateProvider;
    }
    if (pref === 'gemini' && this.geminiProvider.isConfigured()) {
      return this.geminiProvider;
    }
    if (pref === 'local') {
      return this.localProvider;
    }

    // Auto resolution: prioritize ControlNet capable cloud providers, then Gemini, then local
    if (this.falProvider.isConfigured()) {
      return this.falProvider;
    }
    if (this.replicateProvider.isConfigured()) {
      return this.replicateProvider;
    }
    if (this.geminiProvider.isConfigured()) {
      return this.geminiProvider;
    }

    return this.localProvider;
  }

  public async generateCaption(data: CaptionPromptData): Promise<GeneratedCaptionResult> {
    if (this.geminiProvider.isConfigured()) {
      try {
        return await this.geminiProvider.generateCaption(data);
      } catch (err) {
        logger.warn({ err }, 'Gemini caption failed, using mock provider');
      }
    }
    return this.mockProvider.generateCaption(data);
  }

  public async imageToVideo(options: ImageToVideoOptions): Promise<GeneratedVideoResult> {
    if (this.geminiProvider.isConfigured()) {
      return this.geminiProvider.imageToVideo(options);
    }
    return this.mockProvider.imageToVideo(options);
  }

  /**
   * Resilient Image Generation with Automatic Failover
   * Attempts cloud Image-to-Image / ControlNet generation; on failure, falls back to local photographic synthesis.
   */
  public async generateImage(options: GenerateImageOptions): Promise<GeneratedImageResult> {
    const primary = this.getPrimaryImageProvider();

    try {
      logger.info({ provider: primary.name, mode: options.mode }, 'Executing AI Image generation');
      const result = await primary.generateImage(options);
      return result;
    } catch (err: unknown) {
      logger.warn(
        { primaryProvider: primary.name, error: (err as any)?.message || err },
        'Primary AI Image Provider failed or blocked; engaging Enhanced Local Fallback'
      );

      // Invoke local architectural tone and composition engine
      const fallbackResult = await this.localProvider.generateImage(options);
      fallbackResult.model = `${primary.name}-fallback->local-architectural`;
      return fallbackResult;
    }
  }

  /**
   * Multi-modal Vision Analysis with Automatic Fallback
   */
  public async analyzeImage(options: ImageAnalysisOptions): Promise<ImageAnalysisResult> {
    if (this.geminiProvider.isConfigured()) {
      try {
        return await this.geminiProvider.analyzeImage(options);
      } catch (err) {
        logger.warn({ err }, 'Gemini vision analysis failed; using local analysis');
      }
    }
    return this.localProvider.analyzeImage(options);
  }
}

export const aiOrchestrator = new AIProviderOrchestrator();
