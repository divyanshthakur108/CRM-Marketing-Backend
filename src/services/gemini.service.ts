import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { defaultStorage } from '../storage/localStorage.adapter.js';

export interface GenerateImageOptions {
  aspectRatio?: '1:1' | '4:5' | '9:16';
  style?: string;
  projectName?: string;
}

export interface GeneratedImageResult {
  url: string;
  key: string;
  prompt: string;
  model: string;
  isMockFallback: boolean;
}

export interface GenerateCopyOptions {
  projectName: string;
  category: string;
  location?: string;
  tone?: string;
  language?: 'English' | 'Hindi' | 'Hinglish';
  priceDisplay?: string;
}

export interface GeneratedCopyResult {
  hooks: string[];
  captions: {
    short: string;
    long: string;
  };
  hashtags: string[];
  language: string;
  model: string;
}

export class GeminiService {
  private apiKey: string;

  constructor() {
    this.apiKey = env.GEMINI_API_KEY;
  }

  /**
   * Generates a luxury real estate marketing image using Gemini AI,
   * with automatic fallback if the free tier quota is exhausted.
   */
  public async generateImage(
    prompt: string,
    options: GenerateImageOptions = {}
  ): Promise<GeneratedImageResult> {
    const aspectRatio = options.aspectRatio || '4:5';

    if (this.apiKey && env.NODE_ENV !== 'test') {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${this.apiKey}`;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 12000);

        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  {
                    text: `Render a photorealistic, ultra-high-resolution architectural photograph for a luxury property: ${prompt}. Aspect ratio ${aspectRatio}. Golden hour architectural lighting, ultra luxury residential finish.`,
                  },
                ],
              },
            ],
          }),
        });

        clearTimeout(timeout);

        if (response.ok) {
          const data = (await response.json()) as {
            candidates?: Array<{
              content?: {
                parts?: Array<{
                  inlineData?: { data: string; mimeType: string };
                  text?: string;
                }>;
              };
            }>;
          };

          const inlineData = data.candidates?.[0]?.content?.parts?.find(
            (p) => p.inlineData?.data
          )?.inlineData;

          if (inlineData?.data) {
            const buffer = Buffer.from(inlineData.data, 'base64');
            const upload = await defaultStorage.upload(
              {
                buffer,
                filename: `gemini-ai-${Date.now()}.png`,
                mimetype: inlineData.mimeType || 'image/png',
              },
              'ai-creatives'
            );

            logger.info({ prompt }, 'Successfully generated image with Gemini AI API');
            return {
              url: upload.url,
              key: upload.key,
              prompt,
              model: 'gemini-2.5-flash-image',
              isMockFallback: false,
            };
          }
        } else {
          const errData = await response.text();
          logger.warn(
            { status: response.status, errData: errData.slice(0, 150) },
            'Gemini Image API returned non-200. Using deterministic real estate generator fallback.'
          );
        }
      } catch (err) {
        logger.warn({ err }, 'Gemini Image API request error. Using local fallback generator.');
      }
    }

    // High-quality deterministic luxury render fallback
    return this.generateDeterministicFallbackImage(prompt, aspectRatio, options.projectName);
  }

  /**
   * Generates marketing hooks, captions, and hashtags.
   */
  public async generateCopy(options: GenerateCopyOptions): Promise<GeneratedCopyResult> {
    const lang = options.language || 'English';
    const tone = options.tone || 'Ultra Luxury, Sophisticated';

    if (this.apiKey && env.NODE_ENV !== 'test') {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${this.apiKey}`;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);

        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  {
                    text: `You are an elite real estate marketing copywriter. Generate marketing copy for:
Project: ${options.projectName}
Category: ${options.category}
Location: ${options.location || 'Prime Metropolitan'}
Tone: ${tone}
Language: ${lang}

Output in pure JSON format with keys:
"hooks": array of 3 captivating 1-sentence headline hooks,
"shortCaption": punchy 2-sentence Instagram caption with CTA,
"longCaption": detailed 4-sentence narrative description highlighting architecture and exclusivity,
"hashtags": array of 8 trending luxury real estate hashtags`,
                  },
                ],
              },
            ],
          }),
        });

        clearTimeout(timeout);

        if (response.ok) {
          const data = (await response.json()) as {
            candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
          };
          const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;

          if (rawText) {
            const cleanJson = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
            const parsed = JSON.parse(cleanJson);
            return {
              hooks: parsed.hooks || [],
              captions: {
                short: parsed.shortCaption || '',
                long: parsed.longCaption || '',
              },
              hashtags: parsed.hashtags || [],
              language: lang,
              model: 'gemini-3.8-flash',
            };
          }
        }
      } catch (err) {
        logger.warn({ err }, 'Gemini Copy API request failed. Using deterministic luxury copy.');
      }
    }

    // Deterministic offline fallback
    return this.getDeterministicCopy(options);
  }

  /**
   * Deterministic local fallback generating a high-contrast luxury render placeholder.
   */
  private async generateDeterministicFallbackImage(
    prompt: string,
    aspectRatio: string,
    projectName = 'Luxury Real Estate Development'
  ): Promise<GeneratedImageResult> {
    const width = 1080;
    const height = aspectRatio === '9:16' ? 1920 : aspectRatio === '4:5' ? 1350 : 1080;

    // Crisp high-contrast monochrome SVG poster
    const svg = `
      <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" style="stop-color:#0a0a0a;stop-opacity:1" />
            <stop offset="100%" style="stop-color:#1c1c1c;stop-opacity:1" />
          </linearGradient>
        </defs>
        <rect width="${width}" height="${height}" fill="url(#grad)" />
        <rect x="40" y="40" width="${width - 80}" height="${height - 80}" fill="none" stroke="#D4AF37" stroke-width="2" opacity="0.6" />
        <text x="${width / 2}" y="${height / 2 - 60}" font-family="sans-serif" font-size="32" font-weight="bold" fill="#FFFFFF" text-anchor="middle" letter-spacing="4">
          ${projectName.toUpperCase()}
        </text>
        <text x="${width / 2}" y="${height / 2}" font-family="sans-serif" font-size="18" fill="#D4AF37" text-anchor="middle" letter-spacing="2">
          CURATED ARCHITECTURAL MASTERPIECE
        </text>
        <text x="${width / 2}" y="${height / 2 + 50}" font-family="sans-serif" font-size="14" fill="#A3A3A3" text-anchor="middle">
          ${prompt.slice(0, 70)}
        </text>
        <text x="${width / 2}" y="${height - 80}" font-family="monospace" font-size="12" fill="#737373" text-anchor="middle">
          GEMINI AI ENGINE &bull; ${aspectRatio} &bull; RERA VERIFIED
        </text>
      </svg>
    `.trim();

    const buffer = Buffer.from(svg, 'utf-8');
    const upload = await defaultStorage.upload(
      {
        buffer,
        filename: `render-${Date.now()}-${aspectRatio.replace(':', 'x')}.svg`,
        mimetype: 'image/svg+xml',
      },
      'ai-creatives'
    );

    return {
      url: upload.url,
      key: upload.key,
      prompt,
      model: 'gemini-real-estate-engine-v1',
      isMockFallback: true,
    };
  }

  private getDeterministicCopy(options: GenerateCopyOptions): GeneratedCopyResult {
    const { projectName, category, location, language = 'English' } = options;

    if (language === 'Hinglish') {
      return {
        hooks: [
          `Yeh hai ${projectName} - aapka dream luxury address!`,
          `Worli sea face pe luxury ka naya benchmark.`,
          `Investment jo generations tak yaad rakhi jayegi.`,
        ],
        captions: {
          short: `${projectName} me exclusive sea-facing residences ab booking ke liye open hain. Site visit book karne ke liye DM karein.`,
          long: `${location || 'Prime location'} ke heart me located, ${projectName} offers unprecedented luxury. Har residence me private balcony, world-class amenities aur breathtaking sea views milte hain. RERA verified project with verified price specs.`,
        },
        hashtags: ['#LuxuryRealEstate', '#DreamHome', '#MumbaiHomes', '#UltraLuxury', '#RERAVerified'],
        language: 'Hinglish',
        model: 'gemini-copy-offline',
      };
    }

    return {
      hooks: [
        `Welcome to ${projectName}: The Pinnacle of Coastal Living.`,
        `Uncompromising architectural craftsmanship at ${location || 'Prime City Center'}.`,
        `Where bespoke luxury meets breathtaking horizon panoramas.`,
      ],
      captions: {
        short: `Discover limited-edition ${category.toLowerCase()} residences at ${projectName}. Private viewings available by appointment.`,
        long: `Rising above ${location || 'the city skyline'}, ${projectName} redefines urban luxury with expansive living spaces, soaring ceilings, and panoramic sea vistas. Featuring an Olympic infinity pool, 24/7 white-glove concierge, and bespoke Italian marble finishes throughout. Verified RERA credentials and direct developer pricing.`,
      },
      hashtags: [
        '#LuxuryLiving',
        '#UltraLuxuryHomes',
        '#PenthouseLiving',
        '#ArchitecturalExcellence',
        '#RealEstateInvestment',
      ],
      language,
      model: 'gemini-copy-offline',
    };
  }
}

export const geminiService = new GeminiService();
