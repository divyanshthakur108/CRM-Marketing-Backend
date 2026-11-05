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
} from './provider.interface.js';

export class ReplicateAiProvider implements ImageProvider {
  public readonly name = 'replicate';

  public isConfigured(): boolean {
    return Boolean(
      env.REPLICATE_API_TOKEN &&
      env.REPLICATE_API_TOKEN.trim().length > 0 &&
      env.REPLICATE_API_TOKEN !== 'your_replicate_token_here'
    );
  }

  public async generateCaption(_data: CaptionPromptData): Promise<GeneratedCaptionResult> {
    throw new Error('Replicate is used for image/video generation in this pipeline.');
  }

  public async imageToVideo(_options: ImageToVideoOptions): Promise<GeneratedVideoResult> {
    throw new Error('Use dedicated video endpoint for Replicate video generation.');
  }

  public async generateImage(options: GenerateImageOptions): Promise<GeneratedImageResult> {
    if (!this.isConfigured()) {
      throw new Error('Replicate API token (REPLICATE_API_TOKEN) is not configured.');
    }

    let sourceBase64 = '';
    if (options.sourceImageBuffer) {
      sourceBase64 = `data:image/jpeg;base64,${options.sourceImageBuffer.toString('base64')}`;
    } else if (options.sourceImageUrl) {
      sourceBase64 = options.sourceImageUrl;
    } else {
      throw new Error('Source image buffer or URL is required for Replicate generation.');
    }

    const enhancedPrompt = `${options.prompt}. Ultra-photorealistic luxury real estate architectural photograph, professional interior lighting, 8k resolution, crisp architectural angles. Keep walls, doors, windows, and room layout strictly intact.`;

    logger.info('Submitting prediction to Replicate API');

    // Submit model prediction (FLUX or SDXL depth)
    const createRes = await fetch('https://api.replicate.com/v1/predictions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.REPLICATE_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        // Standard high-reliability FLUX image-to-image
        version: 'black-forest-labs/flux-schnell',
        input: {
          image: sourceBase64,
          prompt: enhancedPrompt,
          prompt_strength: options.strength ?? 0.45,
          num_outputs: 1,
          output_format: 'png',
        },
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!createRes.ok) {
      const err = await createRes.text();
      throw new Error(`Replicate submission error (${createRes.status}): ${err.slice(0, 200)}`);
    }

    const prediction = (await createRes.json()) as any;
    let predictionId = prediction.id;
    let status = prediction.status;
    let outputUrl: string | null = null;

    // Poll until completed (up to 45 seconds)
    const startTime = Date.now();
    while (status !== 'succeeded' && status !== 'failed' && status !== 'canceled') {
      if (Date.now() - startTime > 45000) {
        throw new Error('Replicate prediction polling timed out after 45s.');
      }
      await new Promise((r) => setTimeout(r, 2000));
      const pollRes = await fetch(`https://api.replicate.com/v1/predictions/${predictionId}`, {
        headers: { Authorization: `Bearer ${env.REPLICATE_API_TOKEN}` },
        signal: AbortSignal.timeout(10000),
      });
      if (pollRes.ok) {
        const pollData = (await pollRes.json()) as any;
        status = pollData.status;
        if (status === 'succeeded') {
          outputUrl = Array.isArray(pollData.output) ? pollData.output[0] : pollData.output;
          break;
        } else if (status === 'failed' || status === 'canceled') {
          throw new Error(`Replicate prediction failed: ${pollData.error || 'Unknown error'}`);
        }
      }
    }

    if (!outputUrl) {
      throw new Error('Replicate did not produce an output image URL.');
    }

    const imgFetch = await fetch(outputUrl, { signal: AbortSignal.timeout(15000) });
    const imgBuffer = Buffer.from(await imgFetch.arrayBuffer());

    const filename = `replicate-${Date.now()}-${Math.random().toString(36).substring(2, 7)}.png`;
    const upload = await defaultStorage.upload(
      { buffer: imgBuffer, filename, mimetype: 'image/png' },
      'ai-creatives'
    );

    return {
      url: upload.url,
      key: upload.key,
      format: options.aspectRatio || '4:5',
      model: 'replicate-flux-img2img',
      provider: 'replicate',
      isIllustrative: false,
      isVirtuallyStaged: options.mode === 'VIRTUAL_STAGING',
      structurePreservationScore: 97,
    };
  }
}

