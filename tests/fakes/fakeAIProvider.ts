import {
  IAIProvider,
  CaptionPromptData,
  GeneratedCaptionResult,
  GenerateImageOptions,
  GeneratedImageResult,
  ImageToVideoOptions,
  GeneratedVideoResult,
  GenerateJsonOptions,
} from '../../src/modules/ai/providers/provider.interface.js';
import fs from 'fs/promises';
import path from 'path';
import { defaultStorage } from '../../src/storage/localStorage.adapter.js';
import { runFfmpeg } from '../../src/utils/ffmpeg.js';

/** Test-only fake. Never used by the running app. */
export class MockAIProvider implements IAIProvider {
  public readonly name = 'mock';

  public isConfigured(): boolean {
    return true;
  }

  /** Returns well-formed JSON for each AI feature so tests exercise the real parsing code paths. */
  public async generateJson<T = unknown>(prompt: string, options: GenerateJsonOptions = {}): Promise<T> {
    const feature = options.feature || '';
    const project = prompt.match(/Project name: (.+)/)?.[1]?.trim() || 'Test Project';

    if (feature === 'AI photo analysis') {
      const count = options.images?.length || Number(prompt.match(/given (\d+) photo/)?.[1] || 1);
      const categories = ['Living Room', 'Bedroom', 'Kitchen', 'Bathroom', 'Balcony / Terrace', 'Exterior / Facade'];
      return {
        photos: Array.from({ length: count }, (_, i) => ({
          photoNumber: i + 1,
          category: categories[i % categories.length],
          visibleFeatures: [`Test feature ${i + 1}A`, `Test feature ${i + 1}B`],
          lighting: 'Natural daylight',
          perspective: 'Eye-level wide shot',
        })),
        architecturalStyle: 'Contemporary',
        dominantColors: ['White', 'Grey'],
        lightingProfile: 'Natural daylight',
        roomLayouts: ['Open living and dining'],
        summary: 'Test analysis summary.',
      } as T;
    }
    if (feature === 'AI caption writing') {
      return {
        variants: ['HERITAGE_LUXURY', 'HIGH_GROWTH_ROI', 'SHORT_REEL'].map((style) => ({
          title: `${style} caption`,
          style,
          hook: `[TEST] Hook for ${project}`,
          body: `[TEST] Body for ${project}`,
          cta: '[TEST] Book a visit',
          legalAndHashtags: `#${project.replace(/\s+/g, '')}`,
        })),
      } as T;
    }
    if (feature === 'AI presenter script') {
      const rooms = ['EXTERIOR', 'LIVING', 'BEDROOM', 'BALCONY'];
      return {
        headline: `[TEST] Walkthrough of ${project}`,
        caption: `[TEST] Caption for ${project}`,
        hashtags: ['#Test'],
        acts: rooms.map((room, i) => ({
          actNumber: i + 1,
          actTitle: `Act ${i + 1}`,
          targetRoom: room,
          speech: `[TEST] Narration for act ${i + 1} of ${project}.`,
          lowerThird: { headline: project, subline: room },
        })),
      } as T;
    }
    // Generic copy (AI copywriting)
    return {
      hooks: [`[TEST] Hook 1 for ${project}`, `[TEST] Hook 2`, `[TEST] Hook 3`],
      shortCaption: `[TEST] Short caption for ${project}.`,
      longCaption: `[TEST] Long caption for ${project}.`,
      hashtags: ['#Test'],
    } as T;
  }

  public async generateCaption(data: CaptionPromptData): Promise<GeneratedCaptionResult> {
    const lang = data.language || 'English';
    const projectName = data.projectName || 'Luxury Residences';
    const location = data.micromarket || data.city || 'Prime City Location';
    const bhkText = data.bhkConfigs && data.bhkConfigs.length > 0
      ? data.bhkConfigs.join(', ')
      : '2, 3 & 4 BHK';
    const priceText = data.priceDisplay ? `starting from ${data.priceDisplay}` : 'with bespoke developer pricing';
    const reraText = data.reraNumber ? `RERA: ${data.reraNumber}` : 'RERA Approved Project';
    const cleanTag = projectName.replace(/[^a-zA-Z0-9]/g, '');

    if (lang === 'Hindi') {
      return {
        headline: `[MOCK] ${projectName} - भव्य और अद्वितीय जीवनशैली का नया प्रतीक`,
        caption: `[MOCK] ${location} में स्थित ${projectName} आपके लिए प्रस्तुत करता है विश्वस्तरीय सुख-सुविधाएं। ${bhkText} प्रीमियम आवास ${data.priceDisplay ? 'कीमत: ' + data.priceDisplay + ' से शुरू।' : 'उचित मूल्य पर उपलब्ध।'} ${reraText}। आज ही अपनी व्यक्तिगत साइट विजिट बुक करें।`,
        hashtags: ['#लग्जरीहोम्स', '#सपनोंकाघर', '#रियलएस्टेट', `#${cleanTag}`, '#रेराप्रमाणित'],
        language: 'Hindi',
        model: 'mock-caption-engine-v1',
      };
    }

    if (lang === 'Hinglish') {
      return {
        headline: `[MOCK] ${projectName} - Luxury living ka ultimate destination!`,
        caption: `[MOCK] ${location} ke sabse prime location pe situated, ${projectName} offers unprecedented elegance. ${bhkText} premium residences ab open hain booking ke liye, ${data.priceDisplay ? data.priceDisplay + ' se shuru.' : 'attractive pricing ke saath.'} ${reraText}. Call us today exclusive site tour ke liye!`,
        hashtags: ['#LuxuryLiving', '#DreamHome', `#${cleanTag}`, '#MumbaiHomes', '#RERAVerified'],
        language: 'Hinglish',
        model: 'mock-caption-engine-v1',
      };
    }

    return {
      headline: `[MOCK] Experience Architectural Distinction at ${projectName}`,
      caption: `[MOCK] Rising above ${location}, ${projectName} redefines metropolitan sophistication with ${bhkText} bespoke residences, ${priceText}. Enjoy world-class clubhouse amenities, panoramic vistas, and seamless connectivity. ${reraText}. Contact our sales advisory team to schedule your private tour.`,
      hashtags: [
        '#LuxuryRealEstate',
        '#ArchitecturalExcellence',
        `#${cleanTag}`,
        '#LuxuryLiving',
        '#RERAVerified',
      ],
      language: 'English',
      model: 'mock-caption-engine-v1',
    };
  }

  public async generateImage(options: GenerateImageOptions): Promise<GeneratedImageResult> {
    const aspectRatio = options.aspectRatio || '4:5';
    const projectName = options.projectName || 'Luxury Development';
    const width = 1080;
    const height = aspectRatio === '9:16' ? 1920 : aspectRatio === '4:5' ? 1350 : 1080;

    const svg = `
      <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="mockGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" style="stop-color:#0d0d0d;stop-opacity:1" />
            <stop offset="100%" style="stop-color:#1e1e1e;stop-opacity:1" />
          </linearGradient>
        </defs>
        <rect width="${width}" height="${height}" fill="url(#mockGrad)" />
        <rect x="36" y="36" width="${width - 72}" height="${height - 72}" fill="none" stroke="#D4AF37" stroke-width="2" opacity="0.7" />
        <text x="${width / 2}" y="${height / 2 - 40}" font-family="system-ui, sans-serif" font-size="34" font-weight="700" fill="#FFFFFF" text-anchor="middle" letter-spacing="4">
          [MOCK] ${projectName.toUpperCase()}
        </text>
        <text x="${width / 2}" y="${height / 2 + 15}" font-family="system-ui, sans-serif" font-size="18" fill="#D4AF37" text-anchor="middle" letter-spacing="3">
          [MOCK] ARCHITECTURAL MASTERPIECE &bull; ${aspectRatio}
        </text>
        <text x="${width / 2}" y="${height / 2 + 65}" font-family="system-ui, sans-serif" font-size="14" fill="#A3A3A3" text-anchor="middle">
          ${options.prompt.slice(0, 65)}
        </text>
        <text x="${width / 2}" y="${height - 60}" font-family="monospace" font-size="12" fill="#737373" text-anchor="middle">
          [MOCK] DETERMINISTIC AI ENGINE &bull; RERA VERIFIED
        </text>
      </svg>
    `.trim();

    const buffer = Buffer.from(svg, 'utf-8');
    const upload = await defaultStorage.upload(
      {
        buffer,
        filename: `mock-render-${Date.now()}-${aspectRatio.replace(':', 'x')}.svg`,
        mimetype: 'image/svg+xml',
      },
      'ai-creatives'
    );

    return {
      url: upload.url,
      key: upload.key,
      format: aspectRatio,
      model: 'mock-image-engine-v1',
      isIllustrative: true,
    };
  }

  /** Writes a real (tiny) test clip with ffmpeg so the code that stitches clips has an actual file to use. */
  public async imageToVideo(options: ImageToVideoOptions): Promise<GeneratedVideoResult> {
    const format = options.aspectRatio || '9:16';
    const durationSeconds = options.durationSeconds || 15;
    const storageKey = `ai-videos/test-clip-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.mp4`;
    const outPath = defaultStorage.getAbsolutePath(storageKey);
    await fs.mkdir(path.dirname(outPath), { recursive: true });
    await runFfmpeg([
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', `testsrc2=s=540x960:r=24:d=${durationSeconds}`,
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-an',
      outPath,
    ]);

    return {
      videoUrl: defaultStorage.getUrl(storageKey),
      storageKey,
      durationSeconds,
      format,
      model: 'test-video-engine',
      isIllustrative: true,
    };
  }
}
