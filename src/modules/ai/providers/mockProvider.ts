import {
  IAIProvider,
  CaptionPromptData,
  GeneratedCaptionResult,
  GenerateImageOptions,
  GeneratedImageResult,
  ImageToVideoOptions,
  GeneratedVideoResult,
} from './provider.interface.js';
import { defaultStorage } from '../../../storage/localStorage.adapter.js';

export class MockAIProvider implements IAIProvider {
  public readonly name = 'mock';

  public isConfigured(): boolean {
    return true;
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

  public async imageToVideo(options: ImageToVideoOptions): Promise<GeneratedVideoResult> {
    const format = options.aspectRatio || '9:16';
    const durationSeconds = options.durationSeconds || 15;

    return {
      videoUrl: `/api/v1/media/mock-video-reel-${format.replace(':', 'x')}.mp4`,
      storageKey: `mock-video-${Date.now()}.mp4`,
      durationSeconds,
      format,
      model: 'mock-video-engine-v1',
      isIllustrative: true,
    };
  }
}
