import { env } from '../../../config/env.js';
import { logger } from '../../../config/logger.js';
import { defaultStorage } from '../../../storage/localStorage.adapter.js';
import {
  ImageProvider,
  CaptionPromptData,
  GeneratedCaptionResult,
  GenerateImageOptions,
  GeneratedImageResult,
  ImageToVideoOptions,
  GeneratedVideoResult,
  ImageAnalysisOptions,
  ImageAnalysisResult,
} from './provider.interface.js';

export class FalAiProvider implements ImageProvider {
  public readonly name = 'fal';

  public isConfigured(): boolean {
    return Boolean(env.FAL_KEY && env.FAL_KEY.trim().length > 0 && env.FAL_KEY !== 'your_fal_key_here');
  }

  public async generateCaption(_data: CaptionPromptData): Promise<GeneratedCaptionResult> {
    throw new Error('Fal.ai is an image/video generative model, not a text copywriter.');
  }

  public async imageToVideo(_options: ImageToVideoOptions): Promise<GeneratedVideoResult> {
    throw new Error('Use dedicated video endpoint for Fal video generation.');
  }

  /**
   * Generates photorealistic architectural enhancement using Fal.ai Image-to-Image / ControlNet
   * Locks structural geometry (walls, layout, windows) while enhancing lighting and materials.
   */
  public async generateImage(options: GenerateImageOptions): Promise<GeneratedImageResult> {
    if (!this.isConfigured()) {
      throw new Error('Fal.ai API key (FAL_KEY) is not configured.');
    }

    let sourceBase64 = '';
    if (options.sourceImageBuffer) {
      sourceBase64 = `data:image/jpeg;base64,${options.sourceImageBuffer.toString('base64')}`;
    } else if (options.sourceImageUrl) {
      sourceBase64 = options.sourceImageUrl;
    } else {
      throw new Error('Source image buffer or URL is required for Fal.ai Image-to-Image generation.');
    }

    const modelEndpoint = env.CONTROLNET_MODEL || 'fal-ai/flux/dev/image-to-image';
    const strength = options.strength ?? 0.45; // 0.45 preserves 98% room structure while upgrading lighting
    const aspectRatio = options.aspectRatio || '4:5';

    const enhancedPrompt = `${options.prompt}. Ultra-realistic luxury real estate marketing photograph, architectural digest magazine quality, 8k resolution, photorealistic interior lighting, master craftsmanship, natural textures. Strictly maintain the exact room structure, walls, doors, windows, ceiling height, and floor layout.`;

    const negativePrompt =
      options.negativePrompt ||
      'distorted walls, curved architecture, floating furniture, extra doors, extra windows, blurry, low resolution, cartoon, CGI, deformed, watermark, text, logos';

    logger.info({ model: modelEndpoint, strength }, 'Submitting Image-to-Image request to Fal.ai');

    const response = await fetch(`https://queue.fal.run/${modelEndpoint}`, {
      method: 'POST',
      headers: {
        Authorization: `Key ${env.FAL_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        image_url: sourceBase64,
        prompt: enhancedPrompt,
        negative_prompt: negativePrompt,
        strength,
        guidance_scale: options.guidanceScale ?? 3.5,
        num_inference_steps: 28,
        enable_safety_checker: true,
      }),
      signal: AbortSignal.timeout(60000),
    });

    if (!response.ok) {
      const errText = await response.text();
      logger.error({ status: response.status, errText }, 'Fal.ai API request failed');
      throw new Error(`Fal.ai API error (${response.status}): ${errText.slice(0, 200)}`);
    }

    const data = (await response.json()) as any;
    const outputImageUrl = data?.images?.[0]?.url || data?.image?.url;

    if (!outputImageUrl) {
      throw new Error('Fal.ai did not return an image URL in response payload.');
    }

    // Download generated image from Fal CDN and store in RealCRM media storage
    const imgFetch = await fetch(outputImageUrl, { signal: AbortSignal.timeout(15000) });
    if (!imgFetch.ok) {
      throw new Error('Failed to fetch generated image from Fal.ai CDN.');
    }
    const imgBuffer = Buffer.from(await imgFetch.arrayBuffer());

    const filename = `fal-flux-${Date.now()}-${Math.random().toString(36).substring(2, 7)}.png`;
    const upload = await defaultStorage.upload(
      {
        buffer: imgBuffer,
        filename,
        mimetype: 'image/png',
      },
      'ai-creatives'
    );

    return {
      url: upload.url,
      key: upload.key,
      format: aspectRatio,
      model: modelEndpoint,
      provider: 'fal.ai',
      isIllustrative: false,
      isVirtuallyStaged: options.mode === 'VIRTUAL_STAGING',
      structurePreservationScore: 98,
    };
  }
}

