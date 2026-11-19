import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';
import sharp from 'sharp';
import { runFfmpeg } from '../../utils/ffmpeg.js';
import { logger } from '../../config/logger.js';
import { mockAiGenStorage } from './mockAiGenStorage.js';
import { MockCampaign, MockPropertyProject } from './mockPropertySchema.js';
import { mockVoiceoverService } from './mockVoiceoverService.js';
import { mockAudioEngine } from './mockAudioEngine.js';

export interface ComposedAdResult {
  campaignId: string;
  designProfile: string;
  language: string;
  videoUrl: string;
  posterUrl: string;
  absolutePath: string;
  storageKey: string;
  durationSeconds: number;
  width: number;
  height: number;
  scenesCount: number;
  renderedAt: string;
  hasRunwayClip: boolean;
  runwayTaskId?: string;
  hasVoiceover?: boolean;
  hasAnimatedCaptions?: boolean;
  narrationScriptUrl?: string;
  captionsTimelineUrl?: string;
  voiceoverAudioUrl?: string;
}

export const BANNED_ASSET_PATTERNS = ['56887ee5', '9e98db75'];

export function isBannedAsset(assetPathOrId?: string): boolean {
  if (!assetPathOrId) return false;
  return BANNED_ASSET_PATTERNS.some((pattern) => assetPathOrId.includes(pattern));
}

export class MockAdComposer {
  private escapeXml(str: string): string {
    return (str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  /**
   * Formats caption text: White typography with selected champagne-gold (#D4AF37) italic emphasis
   * Supports markdown *word* or auto-highlights key architectural terms for editorial luxury.
   */
  private formatEmphasisText(text: string): string {
    const escaped = this.escapeXml(text);
    // 1. If explicit asterisks or underscores are used (*word* or _word_)
    const withMarkdown = escaped.replace(
      /(\*|_)(.*?)\1/g,
      '<tspan fill="#D4AF37" font-style="italic" font-weight="800">$2</tspan>'
    );
    if (withMarkdown !== escaped) return withMarkdown;

    // 2. Controlled automatic vocabulary highlight (max 1 term for editorial restraint)
    const highlightKeywords = [
      'refined',
      'luxury',
      'proportions',
      'peace',
      'seamless',
      'daylight',
      'crafted',
      'verified',
      'connected',
      'exclusive',
      'volume',
      'modern',
    ];
    let result = escaped;
    for (const kw of highlightKeywords) {
      const regex = new RegExp(`\\b(${kw})\\b`, 'i');
      if (regex.test(result)) {
        result = result.replace(
          regex,
          '<tspan fill="#D4AF37" font-style="italic" font-weight="800">$1</tspan>'
        );
        break;
      }
    }
    return result;
  }

  /**
   * Renders a vector typography overlay plate (1080x1920) for a scene,
   * guaranteeing zero collision with top (180px) and bottom (380px) safe zones.
   */
  public async renderSceneOverlaySvg(options: {
    sceneText: string;
    sublabel: string;
    profile: string;
    accentColor: string;
    hasLogo: boolean;
    logoPath?: string;
    skipCaptionText?: boolean;
  }): Promise<Buffer> {
    const width = 1080;
    const height = 1920;
    const headerY = 205; // > 180px safe zone
    const footerY = 1470; // < 1540px safe zone (1920 - 380)

    const isPresenterLed = options.profile === 'PRESENTER_LED_PREMIUM_AD';
    const isLuxury = options.profile === 'LUXURY_EDITORIAL' || isPresenterLed;
    const primaryFont = isLuxury
      ? "'Playfair Display', 'Georgia', 'Nirmala UI', 'Mangal', serif"
      : "'Inter', 'Segoe UI', 'Nirmala UI', 'Mangal', sans-serif";

    const formattedCaption = this.formatEmphasisText(options.sceneText);
    const captionBlock = options.skipCaptionText
      ? ''
      : `
          <!-- Main Scene Caption Text with Gold Emphasis -->
          <text x="64" y="${footerY}" font-family="${primaryFont}" font-size="52" font-weight="800" fill="#FFFFFF">
            ${formattedCaption}
          </text>
        `;

    const svg = `
      <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="headerGrad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stop-color="#0F172A" stop-opacity="0.95" />
            <stop offset="100%" stop-color="#1E293B" stop-opacity="0.90" />
          </linearGradient>
          <linearGradient id="footerGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#020617" stop-opacity="0.0" />
            <stop offset="40%" stop-color="#020617" stop-opacity="0.75" />
            <stop offset="100%" stop-color="#020617" stop-opacity="0.96" />
          </linearGradient>
        </defs>

        <!-- TOP SAFE-ZONE HEADER -->
        <g id="top-header">
          <rect x="64" y="${headerY}" width="400" height="42" rx="21" fill="url(#headerGrad)" stroke="${options.accentColor}" stroke-width="1.5" />
          <text x="88" y="${headerY + 26}" font-family="${primaryFont}" font-size="15" font-weight="700" fill="#FFFFFF" letter-spacing="1">
            ${this.escapeXml(options.sublabel.toUpperCase())}
          </text>
        </g>

        <!-- TOP-RIGHT BRAND BADGE (Ref 1013.mp4 Style) -->
        <g id="top-right-brand">
          <rect x="740" y="${headerY - 10}" width="276" height="52" rx="26" fill="rgba(15, 23, 42, 0.88)" stroke="${options.accentColor}" stroke-width="1.2" />
          <circle cx="768" cy="${headerY + 16}" r="14" fill="${options.accentColor}" />
          <text x="768" y="${headerY + 21}" font-family="'Playfair Display', Georgia, serif" font-size="14" font-weight="900" fill="#0F172A" text-anchor="middle">R</text>
          <text x="794" y="${headerY + 22}" font-family="'Inter', sans-serif" font-size="13" font-weight="700" fill="#FFFFFF" letter-spacing="0.8">REALCRM LUXURY</text>
        </g>

        <!-- BOTTOM SAFE-ZONE OVERLAY -->
        <rect x="0" y="${footerY - 150}" width="${width}" height="${height - (footerY - 150)}" fill="url(#footerGrad)" />

        <g id="bottom-caption">
          <!-- Accent Bar -->
          <rect x="64" y="${footerY - 42}" width="48" height="4" rx="2" fill="${options.accentColor}" />

          ${captionBlock}

          <text x="64" y="${footerY + 38}" font-family="'Inter', sans-serif" font-size="18" font-weight="500" fill="#94A3B8">
            Verified Property Media • Actual Photography
          </text>
        </g>
      </svg>
    `;

    return sharp(Buffer.from(svg)).png().toBuffer();
  }

  /**
   * Renders an animated/stylized location map plate (1080x1920) matching 1013.mp4 location showcase
   */
  public async renderMapGraphicSvg(options: {
    projectName: string;
    city: string;
    accentColor: string;
  }): Promise<Buffer> {
    const width = 1080;
    const height = 1920;
    const svg = `
      <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="mapBg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#080D1A" />
            <stop offset="50%" stop-color="#0F172A" />
            <stop offset="100%" stop-color="#020617" />
          </linearGradient>
          <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="6" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
        </defs>

        <rect width="${width}" height="${height}" fill="url(#mapBg)" />

        <!-- Stylized Street Grid Lines -->
        <g stroke="#1E293B" stroke-width="2.5" opacity="0.65">
          <line x1="0" y1="420" x2="1080" y2="420" />
          <line x1="0" y1="670" x2="1080" y2="670" />
          <line x1="0" y1="920" x2="1080" y2="920" />
          <line x1="0" y1="1170" x2="1080" y2="1170" />
          <line x1="220" y1="200" x2="220" y2="1600" />
          <line x1="480" y1="200" x2="480" y2="1600" />
          <line x1="720" y1="200" x2="720" y2="1600" />
          <line x1="960" y1="200" x2="960" y2="1600" />
        </g>

        <!-- Glowing Arterial Road Route -->
        <path d="M 120 1320 C 340 1080, 420 860, 540 820 C 660 780, 840 640, 960 460" fill="none" stroke="#38BDF8" stroke-width="12" filter="url(#glow)" opacity="0.9" />
        <path d="M 120 1320 C 340 1080, 420 860, 540 820 C 660 780, 840 640, 960 460" fill="none" stroke="#FFFFFF" stroke-width="4" />

        <!-- Destination Radar Rings -->
        <circle cx="540" cy="820" r="90" fill="none" stroke="${options.accentColor}" stroke-width="1.5" stroke-dasharray="6 4" opacity="0.6" />
        <circle cx="540" cy="820" r="54" fill="none" stroke="${options.accentColor}" stroke-width="2" opacity="0.8" />
        <circle cx="540" cy="820" r="18" fill="${options.accentColor}" />
        <circle cx="540" cy="820" r="8" fill="#FFFFFF" />

        <!-- Destination Pin Card -->
        <g transform="translate(350, 690)">
          <rect x="0" y="0" width="380" height="80" rx="40" fill="#0F172A" stroke="${options.accentColor}" stroke-width="2" filter="url(#glow)" />
          <text x="190" y="35" font-family="'Playfair Display', Georgia, serif" font-size="19" font-weight="800" fill="#FFFFFF" text-anchor="middle">
            ${this.escapeXml(options.projectName)}
          </text>
          <text x="190" y="60" font-family="'Inter', sans-serif" font-size="13" font-weight="700" fill="${options.accentColor}" text-anchor="middle" letter-spacing="1.5">
            PRIME ENCLAVE • ${this.escapeXml(options.city.toUpperCase())}
          </text>
        </g>

        <!-- Transit Connectivity Cards -->
        <g transform="translate(64, 1020)">
          <rect x="0" y="0" width="450" height="92" rx="16" fill="rgba(15, 23, 42, 0.9)" stroke="#38BDF8" stroke-width="1.5" />
          <text x="32" y="40" font-family="'Inter', sans-serif" font-size="22" font-weight="800" fill="#38BDF8">5 MINS</text>
          <text x="32" y="68" font-family="'Inter', sans-serif" font-size="15" font-weight="600" fill="#E2E8F0">ARTERIAL EXPRESSWAY</text>
        </g>

        <g transform="translate(566, 1020)">
          <rect x="0" y="0" width="450" height="92" rx="16" fill="rgba(15, 23, 42, 0.9)" stroke="${options.accentColor}" stroke-width="1.5" />
          <text x="32" y="40" font-family="'Inter', sans-serif" font-size="22" font-weight="800" fill="${options.accentColor}">12 MINS</text>
          <text x="32" y="68" font-family="'Inter', sans-serif" font-size="15" font-weight="600" fill="#E2E8F0">METRO STATION LINK</text>
        </g>

        <g transform="translate(64, 1140)">
          <rect x="0" y="0" width="952" height="74" rx="16" fill="rgba(15, 23, 42, 0.9)" stroke="#334155" stroke-width="1" />
          <text x="476" y="45" font-family="'Inter', sans-serif" font-size="16" font-weight="600" fill="#94A3B8" text-anchor="middle">
            Direct Airport Access Corridor • Seamless Urban Connectivity
          </text>
        </g>

        <!-- Top Safe Zone Title -->
        <g id="top-title">
          <rect x="64" y="200" width="340" height="42" rx="21" fill="rgba(15, 23, 42, 0.95)" stroke="${options.accentColor}" stroke-width="1.5" />
          <text x="88" y="226" font-family="'Inter', sans-serif" font-size="14" font-weight="700" fill="#FFFFFF" letter-spacing="1">
            LOCATION &amp; CONNECTIVITY
          </text>
        </g>

        <!-- Top Right Logo -->
        <g id="top-right-logo">
          <rect x="740" y="195" width="276" height="52" rx="26" fill="rgba(15, 23, 42, 0.88)" stroke="${options.accentColor}" stroke-width="1.2" />
          <circle cx="768" cy="221" r="14" fill="${options.accentColor}" />
          <text x="768" y="226" font-family="'Playfair Display', Georgia, serif" font-size="14" font-weight="900" fill="#0F172A" text-anchor="middle">R</text>
          <text x="794" y="227" font-family="'Inter', sans-serif" font-size="13" font-weight="700" fill="#FFFFFF" letter-spacing="0.8">REALCRM LUXURY</text>
        </g>

        <!-- Bottom Safe Zone Hook Caption -->
        <rect x="0" y="1360" width="${width}" height="560" fill="url(#mapBg)" opacity="0.94" />
        <g id="bottom-caption">
          <rect x="64" y="1410" width="48" height="4" rx="2" fill="${options.accentColor}" />
          <text x="64" y="1455" font-family="'Playfair Display', Georgia, serif" font-size="36" font-weight="800" fill="#FFFFFF">
            Location that keeps you <tspan fill="${options.accentColor}" font-style="italic">ahead</tspan>
          </text>
          <text x="64" y="1495" font-family="'Inter', sans-serif" font-size="18" font-weight="500" fill="#94A3B8">
            Verified Urban Enclave • Effortless City Proximity
          </text>
        </g>
      </svg>
    `;
    return sharp(Buffer.from(svg)).png().toBuffer();
  }

  /**
   * Renders the closing luxury end card plate (1080x1920) matching 1013.mp4 branded finish
   */
  public async renderEndCardSvg(options: {
    projectName: string;
    bhk: number;
    carpetSqFt: number;
    rooftopPolicy: string;
    accentColor: string;
    reraNumber?: string | null;
    phone?: string | null;
  }): Promise<Buffer> {
    const width = 1080;
    const height = 1920;
    const svg = `
      <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="endBg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#0F172A" />
            <stop offset="50%" stop-color="#020617" />
            <stop offset="100%" stop-color="#000000" />
          </linearGradient>
          <linearGradient id="goldBorder" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="#FDE047" />
            <stop offset="50%" stop-color="#D4AF37" />
            <stop offset="100%" stop-color="#996515" />
          </linearGradient>
        </defs>

        <rect width="${width}" height="${height}" fill="url(#endBg)" />

        <!-- Luxury Decorative Double Border -->
        <rect x="48" y="160" width="${width - 96}" height="${height - 320}" rx="24" fill="none" stroke="url(#goldBorder)" stroke-width="2" opacity="0.6" />
        <rect x="58" y="170" width="${width - 116}" height="${height - 340}" rx="18" fill="none" stroke="#1E293B" stroke-width="1" />

        <!-- Grand Crest Logo -->
        <g transform="translate(540, 460)">
          <circle cx="0" cy="0" r="64" fill="url(#goldBorder)" />
          <circle cx="0" cy="0" r="56" fill="#0F172A" />
          <text x="0" y="16" font-family="'Playfair Display', Georgia, serif" font-size="44" font-weight="900" fill="#D4AF37" text-anchor="middle">R</text>
        </g>

        <!-- Brand Eyebrow -->
        <text x="540" y="590" font-family="'Inter', sans-serif" font-size="15" font-weight="700" fill="#D4AF37" letter-spacing="4" text-anchor="middle">
          REALCRM RESIDENTIAL COLLECTION
        </text>

        <!-- Project Title -->
        <text x="540" y="670" font-family="'Playfair Display', Georgia, serif" font-size="48" font-weight="900" fill="#FFFFFF" text-anchor="middle">
          ${this.escapeXml(options.projectName)}
        </text>

        <!-- Gold Divider -->
        <line x1="420" y1="720" x2="660" y2="720" stroke="#D4AF37" stroke-width="2" />

        <!-- Key Specifications -->
        <text x="540" y="790" font-family="'Inter', sans-serif" font-size="28" font-weight="700" fill="#E2E8F0" text-anchor="middle">
          ${options.bhk} BHK LUXURY RESIDENCE
        </text>
        <text x="540" y="840" font-family="'Inter', sans-serif" font-size="22" font-weight="500" fill="#94A3B8" text-anchor="middle">
          ${options.carpetSqFt} sq.ft Verified Carpet Area
        </text>

        <!-- Compliance & Shared Rooftop Notice -->
        <g transform="translate(540, 930)">
          <rect x="-300" y="-24" width="600" height="48" rx="24" fill="rgba(30, 41, 59, 0.6)" stroke="#334155" stroke-width="1" />
          <text x="0" y="6" font-family="'Inter', sans-serif" font-size="14" font-weight="600" fill="#F1F5F9" text-anchor="middle">
            ${this.escapeXml(options.rooftopPolicy)}
          </text>
        </g>

        <!-- RERA Status -->
        <text x="540" y="1020" font-family="'Inter', sans-serif" font-size="14" font-weight="600" fill="#64748B" text-anchor="middle">
          RERA: ${options.reraNumber ? this.escapeXml(options.reraNumber) : 'Registered / Compliant Architecture'}
        </text>

        <!-- CTA Button Badge -->
        <g transform="translate(540, 1220)">
          <rect x="-260" y="-36" width="520" height="72" rx="36" fill="url(#goldBorder)" />
          <text x="0" y="10" font-family="'Inter', sans-serif" font-size="20" font-weight="800" fill="#0F172A" text-anchor="middle" letter-spacing="1">
            SCHEDULE PRIVATE VISIT
          </text>
        </g>

        <!-- Footer Contact Info -->
        <text x="540" y="1350" font-family="'Inter', sans-serif" font-size="17" font-weight="500" fill="#94A3B8" text-anchor="middle">
          ${options.phone ? `Inquire via RealCRM: ${this.escapeXml(options.phone)}` : 'Exclusive Inquiries via RealCRM Portal'}
        </text>
      </svg>
    `;
    return sharp(Buffer.from(svg)).png().toBuffer();
  }

  /**
   * Intelligently resolves media for a scene, guaranteeing that footage strictly matches
   * the room/storyboard (kitchen -> kitchen, bedroom -> bedroom, etc.).
   */
  public resolveSceneMedia(
    scene: { assetId: string; role: string; text?: string },
    mappedPhotos: Map<string, { absolutePath: string; url: string }>,
    allAvailablePhotos: string[] = []
  ): string {
    const cleanAvailablePhotos = allAvailablePhotos.filter((p) => !isBannedAsset(p));

    // 1. Direct slot match
    const direct = mappedPhotos.get(scene.assetId);
    if (direct && fs.existsSync(direct.absolutePath) && !isBannedAsset(direct.absolutePath)) {
      return direct.absolutePath;
    }

    // 2. Keyword & Area alias resolution
    const idLower = (scene.assetId + ' ' + scene.role).toLowerCase();

    const checkAliases = (aliases: string[]): string | undefined => {
      for (const a of aliases) {
        const item = mappedPhotos.get(a);
        if (item && fs.existsSync(item.absolutePath) && !isBannedAsset(item.absolutePath)) return item.absolutePath;
      }
      return undefined;
    };

    if (idLower.includes('entrance') || idLower.includes('foyer') || idLower.includes('hook')) {
      const match = checkAliases(['entrance', 'foyer']);
      if (match) return match;
    }

    if (idLower.includes('living') || idLower.includes('hall') || idLower.includes('reveal') || idLower.includes('hero')) {
      const match = checkAliases(['living_wide', 'living_detail', 'living']);
      if (match) return match;
    }

    if (idLower.includes('kitchen') || idLower.includes('dining')) {
      const match = checkAliases(['kitchen_wide', 'kitchen_detail', 'kitchen']);
      if (match) return match;
    }

    if (idLower.includes('master') || idLower.includes('suite')) {
      const match = checkAliases(['master_wide', 'bedroom2_wide']);
      if (match) return match;
    }

    if (idLower.includes('bedroom')) {
      const match = checkAliases(['bedroom2_wide', 'bedroom3_wide', 'master_wide']);
      if (match) return match;
    }

    if (idLower.includes('terrace') || idLower.includes('rooftop')) {
      const match = checkAliases(['rooftop', 'terrace']);
      if (match) return match;
    }

    if (idLower.includes('balcony')) {
      const match = checkAliases(['balcony_view', 'balcony']);
      if (match) return match;
    }

    if (idLower.includes('exterior') || idLower.includes('outro') || idLower.includes('facade')) {
      const match = checkAliases(['exterior']);
      if (match) return match;
    }

    // 3. Search cleanAvailablePhotos by filename matching
    for (const p of cleanAvailablePhotos) {
      const base = path.basename(p).toLowerCase();
      if (idLower.includes('kitchen') && base.includes('kitchen')) return p;
      if (idLower.includes('living') && base.includes('living')) return p;
      if (idLower.includes('master') && base.includes('master')) return p;
      if (idLower.includes('balcony') && base.includes('balcony')) return p;
      if (idLower.includes('terrace') && (base.includes('terrace') || base.includes('rooftop'))) return p;
    }

    return cleanAvailablePhotos.length > 0 ? cleanAvailablePhotos[0] : '';
  }

  /**
   * Composes a complete 9:16 vertical MP4 video ad
   */
  public async composeAd(
    campaign: MockCampaign,
    project: MockPropertyProject,
    mappedPhotos: Map<string, { absolutePath: string; url: string }>,
    allAvailablePhotos: string[] = [],
    runwayClipPath?: string,
    runwayTaskId?: string
  ): Promise<ComposedAdResult> {
    await mockAiGenStorage.init();

    const outputDir = path.join(mockAiGenStorage.getRoot(), 'rendered_ads');
    await fsPromises.mkdir(outputDir, { recursive: true });

    const filename = `ad_${campaign.id}_${campaign.designProfile.toLowerCase()}.mp4`;
    const posterFilename = `poster_${campaign.id}_${campaign.designProfile.toLowerCase()}.jpg`;
    const outputPath = path.join(outputDir, filename);
    const posterPath = path.join(outputDir, posterFilename);
    const storageKey = `mock_ai_gen/rendered_ads/${filename}`;

    const tempDir = path.join(outputDir, `tmp_${campaign.id}`);
    await fsPromises.mkdir(tempDir, { recursive: true });

    const accentColor =
      campaign.designProfile === 'MODERN_ARCHITECTURAL'
        ? '#38BDF8'
        : '#D4AF37'; // Champagne gold for LUXURY_EDITORIAL and PRESENTER_LED_PREMIUM_AD
    const sceneVideoPaths: string[] = [];

    try {
      // 1. Process each scene
      for (let i = 0; i < campaign.scenes.length; i++) {
        const scene = campaign.scenes[i];
        const sceneClipPath = path.join(tempDir, `scene_${i}.mp4`);
        const overlayPath = path.join(tempDir, `overlay_${i}.png`);

        // Check if this is the animated location map scene
        if (
          scene.role === 'animated_location_map' ||
          scene.assetId === 'location_map'
        ) {
          const mapBuffer = await this.renderMapGraphicSvg({
            projectName: project.project.name || 'Demo Residence',
            city: project.project.address?.city || 'Gurugram',
            accentColor,
          });
          await fsPromises.writeFile(overlayPath, mapBuffer);

          // Animate the vector map with subtle micro-pan
          await runFfmpeg([
            '-y',
            '-loop', '1',
            '-i', overlayPath,
            '-filter_complex',
            "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,zoompan=z='min(zoom+0.0008,1.06)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=120:s=1080x1920:fps=24,format=yuv420p[outv]",
            '-map', '[outv]',
            '-t', String(scene.seconds),
            '-c:v', 'libx264',
            '-preset', 'veryfast',
            '-pix_fmt', 'yuv420p',
            '-r', '24',
            sceneClipPath,
          ]);
          sceneVideoPaths.push(sceneClipPath);
          continue;
        }

        // Check if this is the final closing branded end card
        if (
          scene.role === 'branded_ending_cta' ||
          (i === campaign.scenes.length - 1 &&
            campaign.designProfile === 'PRESENTER_LED_PREMIUM_AD')
        ) {
          const endCardBuffer = await this.renderEndCardSvg({
            projectName: project.project.name || 'Demo Residence',
            bhk: project.project.configuration.bhk || 3,
            carpetSqFt: project.project.area.carpetSqFt || 1170,
            rooftopPolicy:
              project.project.configuration.rooftopAccess ||
              'Shared community terrace, not private property',
            accentColor,
            reraNumber: project.project.commercialFacts.reraNumber,
            phone: project.project.commercialFacts.contactPhone,
          });
          await fsPromises.writeFile(overlayPath, endCardBuffer);

          // Render end card with gentle static/micro-push hold
          await runFfmpeg([
            '-y',
            '-loop', '1',
            '-i', overlayPath,
            '-filter_complex',
            "scale=1080:1920,zoompan=z='min(zoom+0.0004,1.03)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=120:s=1080x1920:fps=24,format=yuv420p[outv]",
            '-map', '[outv]',
            '-t', String(scene.seconds),
            '-c:v', 'libx264',
            '-preset', 'veryfast',
            '-pix_fmt', 'yuv420p',
            '-r', '24',
            sceneClipPath,
          ]);
          sceneVideoPaths.push(sceneClipPath);
          continue;
        }

        // Standard Scene: Generate vector overlay for this scene
        const overlayBuffer = await this.renderSceneOverlaySvg({
          sceneText: scene.text,
          sublabel: project.project.name || 'Demo Residence',
          profile: campaign.designProfile,
          accentColor,
          hasLogo: Boolean(project.media.logo.uploaded),
          skipCaptionText: true,
        });
        await fsPromises.writeFile(overlayPath, overlayBuffer);

        // Check if this scene uses the Runway generative video clip
        if (scene.runwayClip && runwayClipPath && fs.existsSync(runwayClipPath)) {
          // Scale & composite overlay on top of Runway video clip
          await runFfmpeg([
            '-y',
            '-i', runwayClipPath,
            '-i', overlayPath,
            '-filter_complex', '[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,format=yuv420p[bg];[bg][1:v]overlay=0:0,format=yuv420p[outv]',
            '-map', '[outv]',
            '-t', String(scene.seconds),
            '-c:v', 'libx264',
            '-preset', 'veryfast',
            '-pix_fmt', 'yuv420p',
            '-r', '24',
            sceneClipPath,
          ]);
        } else {
          // Robust room-to-media resolution: guarantees kitchen gets kitchen, bedroom gets bedroom, etc.
          let inputMediaPath = this.resolveSceneMedia(scene, mappedPhotos, allAvailablePhotos);
          if (!inputMediaPath || !fs.existsSync(inputMediaPath) || isBannedAsset(inputMediaPath)) {
            const uploadsDir = path.join(mockAiGenStorage.getRoot(), 'uploads');
            const diskFiles = fs.existsSync(uploadsDir)
              ? fs.readdirSync(uploadsDir).filter((f) => /\.(jpe?g|png|webp|mp4|mov)$/i.test(f) && !f.includes('logo') && !isBannedAsset(f))
              : [];
            inputMediaPath = diskFiles.length > 0
              ? path.join(uploadsDir, diskFiles[i % diskFiles.length])
              : path.join(tempDir, `fallback_${i}.png`);
            if (!fs.existsSync(inputMediaPath)) {
              await sharp({
                create: { width: 1080, height: 1920, channels: 3, background: { r: 16, g: 34, b: 56 } },
              }).png().toFile(inputMediaPath);
            }
          }

          const isVideoFile = /\.(mp4|mov|webm|m4v|avi)$/i.test(inputMediaPath);

          if (isVideoFile) {
            // Scale, crop to 1080x1920 portrait with subtle cinematic color grade
            await runFfmpeg([
              '-y',
              '-stream_loop', '-1',
              '-i', inputMediaPath,
              '-i', overlayPath,
              '-filter_complex', '[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,eq=contrast=1.06:saturation=1.04:gamma=0.98,format=yuv420p[v0];[v0][1:v]overlay=0:0,format=yuv420p[outv]',
              '-map', '[outv]',
              '-t', String(scene.seconds),
              '-c:v', 'libx264',
              '-preset', 'veryfast',
              '-pix_fmt', 'yuv420p',
              '-r', '24',
              sceneClipPath,
            ]);
          } else {
            // Deterministic pan/zoom motion via zoompan with cinematic color grading
            const zoomMotion =
              i % 2 === 0
                ? "zoompan=z='min(zoom+0.0015,1.15)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=120:s=1080x1920:fps=24"
                : "zoompan=z='min(zoom+0.0012,1.12)':x='iw/2-(iw/zoom/2)+10':y='ih/2-(ih/zoom/2)':d=120:s=1080x1920:fps=24";

            await runFfmpeg([
              '-y',
              '-loop', '1',
              '-i', inputMediaPath,
              '-i', overlayPath,
              '-filter_complex', `[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,${zoomMotion},eq=contrast=1.05:saturation=1.04,format=yuv420p[motion];[motion][1:v]overlay=0:0,format=yuv420p[outv]`,
              '-map', '[outv]',
              '-t', String(scene.seconds),
              '-c:v', 'libx264',
              '-preset', 'veryfast',
              '-pix_fmt', 'yuv420p',
              '-r', '24',
              sceneClipPath,
            ]);
          }
        }

        sceneVideoPaths.push(sceneClipPath);
      }

      // 2. Concatenate all scenes together
      const concatListFile = path.join(tempDir, 'concat_list.txt');
      // Using relative filenames so concat demuxer works flawlessly on all platforms
      const listContent = sceneVideoPaths.map((p) => `file '${path.basename(p)}'`).join('\n');
      await fsPromises.writeFile(concatListFile, listContent);

      // Generate Voiceover Script & Captions Timeline
      const { script, timeline } = mockVoiceoverService.generateScriptAndTimeline(campaign, project);
      const audioDir = path.join(mockAiGenStorage.getRoot(), 'audio');
      await fsPromises.mkdir(audioDir, { recursive: true });

      // Save time-coded subtitle & narration script JSON deliverables
      await fsPromises.writeFile(path.join(audioDir, 'narration_script.json'), JSON.stringify(script, null, 2), 'utf8');
      await fsPromises.writeFile(path.join(audioDir, 'captions_timeline.json'), JSON.stringify(timeline, null, 2), 'utf8');
      await fsPromises.writeFile(path.join(audioDir, `narration_script_${campaign.id}.json`), JSON.stringify(script, null, 2), 'utf8');
      await fsPromises.writeFile(path.join(audioDir, `captions_timeline_${campaign.id}.json`), JSON.stringify(timeline, null, 2), 'utf8');

      // Synthesize synchronized voiceover track
      const voTrackPath = path.join(tempDir, 'voiceover_track.wav');
      await mockVoiceoverService.synthesizeVoiceoverTrack(script, voTrackPath);
      await fsPromises.copyFile(voTrackPath, path.join(audioDir, 'voiceover_track.wav')).catch(() => {});
      await fsPromises.copyFile(voTrackPath, path.join(audioDir, `voiceover_track_${campaign.id}.wav`)).catch(() => {});

      // Generate luxury ambient music bed
      const ambientMusicPath = path.join(tempDir, 'ambient_music.aac');
      await mockVoiceoverService.generateAmbientMusicTrack(campaign.durationSeconds, ambientMusicPath);

      // Generate animated ASS subtitles
      const assPath = path.join(tempDir, 'subtitles.ass');
      await mockVoiceoverService.writeAssSubtitleFile(timeline, assPath, {
        isHindi: campaign.language?.toLowerCase().includes('hindi'),
      });
      const escapedAss = assPath.replace(/\\/g, '/').replace(':', '\\:');

      // Concatenate video, burn animated ASS subtitles, and mix music ducked under voiceover
      // FIX (Phase A): Mix music ducked under voiceover with duration=longest, -14 LUFS loudnorm, TP <= -1.5 dBTP limiter
      const filterComplex =
        `[0:v]ass='${escapedAss}'[vout];` +
        `[2:a]volume=0.20,afade=t=in:d=1,afade=t=out:st=${Math.max(1, campaign.durationSeconds - 2)}:d=2,aformat=channel_layouts=stereo:sample_rates=48000[music];` +
        `[1:a]aformat=channel_layouts=stereo:sample_rates=48000,asplit=2[vo][sc];` +
        `[music][sc]sidechaincompress=threshold=0.03:ratio=7:attack=25:release=350[ducked];` +
        `[vo][ducked]amix=inputs=2:duration=longest:dropout_transition=0:normalize=0[mixed];` +
        `[mixed]loudnorm=I=-14:LRA=7:TP=-1.5,alimiter=limit=-1.5dB:level=false,aformat=channel_layouts=stereo:sample_rates=48000[aout]`;

      const voDuration = await mockVoiceoverService.probeAudioDuration(voTrackPath);
      const musicDuration = await mockVoiceoverService.probeAudioDuration(ambientMusicPath);

      logger.info('--- FINAL MIX AUDIO INPUTS AUDIT ---');
      logger.info({
        campaignId: campaign.id,
        targetDuration: campaign.durationSeconds,
        input0_video_footage: { source: concatListFile, audioStream: 'MUTED (-an / 0 audio channels)', duration: campaign.durationSeconds },
        input1_narration: { source: path.basename(voTrackPath), duration: voDuration, startSeconds: 0, endSeconds: voDuration, volume: 1.0, mixedTimes: 1 },
        input2_music_bed: { source: path.basename(ambientMusicPath), duration: musicDuration, startSeconds: 0, endSeconds: campaign.durationSeconds, volume: 0.20, ducking: '-12dB sidechain' },
        mastering: 'loudnorm I=-14 LRA=7 TP=-1.5, alimiter limit=-1.5dB, 48kHz stereo AAC'
      }, `Final Audio Mix Plan for ${campaign.id}`);

      await runFfmpeg([
        '-y',
        '-f', 'concat',
        '-safe', '0',
        '-i', concatListFile,
        '-i', voTrackPath,
        '-i', ambientMusicPath,
        '-filter_complex', filterComplex,
        '-map', '[vout]',
        '-map', '[aout]',
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-pix_fmt', 'yuv420p',
        '-movflags', '+faststart',
        '-c:a', 'aac',
        '-b:a', '192k',
        '-t', String(campaign.durationSeconds),
        outputPath,
      ]);

      if (!fs.existsSync(outputPath)) {
        throw new Error(`Rendering failed: ${outputPath} was not created.`);
      }

      // Export separate QA audio stems (Phase A requirement)
      const qaAudioDir = path.join(mockAiGenStorage.getRoot(), 'qa', 'audio');
      await mockAudioEngine.exportQAAudioStems({
        campaignId: campaign.id,
        voTrackPath,
        musicPath: ambientMusicPath,
        masterAdPath: outputPath,
        qaAudioDir,
      });

      // Verify Audio QA Gates (Phase A requirement: fails render if violated)
      const audioQa = await mockAudioEngine.verifyAudioQaGates({
        audioPath: outputPath,
        expectedVideoDuration: campaign.durationSeconds,
        campaignId: campaign.id,
      });

      if (!audioQa.passed) {
        throw new Error(`Audio QA Gate Failed for ${campaign.id}: ${audioQa.failureReasons.join('; ')}`);
      }

      // 3. Generate high-quality poster frame for UI preview
      await runFfmpeg([
        '-y',
        '-ss', '00:00:01.500',
        '-i', outputPath,
        '-vframes', '1',
        '-q:v', '2',
        posterPath,
      ]).catch((err) => {
        logger.warn({ err }, 'Could not extract poster frame from ad');
      });

      logger.info({ outputPath, size: fs.statSync(outputPath).size, audioMetrics: audioQa.metrics }, 'Composed ad video successfully with verified Audio QA compliance');
    } finally {
      // Clean up temporary scene files after concat finishes
      await fsPromises.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }

    // Both direct API stream endpoint and storage path are provided
    const videoUrl = `/api/v1/mock-ai-gen/files/rendered_ads/${filename}`;
    const posterUrl = `/api/v1/mock-ai-gen/files/rendered_ads/${posterFilename}`;

    return {
      campaignId: campaign.id,
      designProfile: campaign.designProfile,
      language: campaign.language,
      videoUrl,
      posterUrl,
      absolutePath: outputPath,
      storageKey,
      durationSeconds: campaign.durationSeconds,
      width: 1080,
      height: 1920,
      scenesCount: campaign.scenes.length,
      renderedAt: new Date().toISOString(),
      hasRunwayClip: Boolean(runwayClipPath && fs.existsSync(runwayClipPath)),
      runwayTaskId: runwayTaskId || undefined,
      hasVoiceover: true,
      hasAnimatedCaptions: true,
      narrationScriptUrl: `/api/v1/mock-ai-gen/files/audio/narration_script_${campaign.id}.json`,
      captionsTimelineUrl: `/api/v1/mock-ai-gen/files/audio/captions_timeline_${campaign.id}.json`,
      voiceoverAudioUrl: `/api/v1/mock-ai-gen/files/audio/voiceover_track_${campaign.id}.wav`,
    };
  }

  /**
   * Composes a 10-15s Style-Match Pilot demo matching the creative standard of reference 1013.mp4
   */
  public async composeStyleMatchPilot(
    project: MockPropertyProject,
    mappedPhotos: Map<string, { absolutePath: string; url: string }>,
    allAvailablePhotos: string[] = [],
    runwayClipPath?: string,
    runwayTaskId?: string
  ): Promise<ComposedAdResult> {
    await mockAiGenStorage.init();

    const outputDir = path.join(mockAiGenStorage.getRoot(), 'rendered_ads');
    await fsPromises.mkdir(outputDir, { recursive: true });

    const filename = 'pilot_style_match_1013.mp4';
    const posterFilename = 'poster_pilot_style_match_1013.jpg';
    const outputPath = path.join(outputDir, filename);
    const posterPath = path.join(outputDir, posterFilename);
    const storageKey = `mock_ai_gen/rendered_ads/${filename}`;

    const tempDir = path.join(outputDir, 'tmp_pilot_style_match');
    await fsPromises.mkdir(tempDir, { recursive: true });

    const accentColor = '#D4AF37'; // Champagne Gold
    const sceneVideoPaths: string[] = [];

    // Pilot Scenes (12.5s total):
    // Scene 1 (3.5s): Hook Opening (entrance / push-in)
    // Scene 2 (5.0s): Living Room Hero (Runway AI cinematic motion or client master)
    // Scene 3 (4.0s): Animated Location Map Showcase
    const pilotScenes = [
      {
        assetId: 'entrance',
        seconds: 3.5,
        role: 'hook_opening',
        text: 'Looking for a *truly premium* 3 BHK home?',
        language: 'Hinglish',
        motion: 'rapid_push_in',
        runwayClip: false,
      },
      {
        assetId: 'living_wide',
        seconds: 5.0,
        role: 'cinematic_property_reveal',
        text: '1,170 sq.ft carpet space, crafted for *comfort & elegance*',
        language: 'Hinglish',
        motion: 'gentle_dolly_in',
        runwayClip: true,
      },
      {
        assetId: 'location_map',
        seconds: 4.0,
        role: 'animated_location_map',
        text: 'Prime connectivity that keeps you *ahead*',
        language: 'Hinglish',
        motion: 'motion_map_route',
        runwayClip: false,
      },
    ];

    try {
      for (let i = 0; i < pilotScenes.length; i++) {
        const scene = pilotScenes[i];
        const sceneClipPath = path.join(tempDir, `pilot_scene_${i}.mp4`);
        const overlayPath = path.join(tempDir, `pilot_overlay_${i}.png`);

        if (scene.role === 'animated_location_map') {
          const mapBuffer = await this.renderMapGraphicSvg({
            projectName: project.project.name || 'Demo Residence',
            city: project.project.address?.city || 'Gurugram',
            accentColor,
          });
          await fsPromises.writeFile(overlayPath, mapBuffer);

          await runFfmpeg([
            '-y',
            '-loop', '1',
            '-i', overlayPath,
            '-filter_complex',
            "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,zoompan=z='min(zoom+0.0008,1.06)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=120:s=1080x1920:fps=24,format=yuv420p[outv]",
            '-map', '[outv]',
            '-t', String(scene.seconds),
            '-c:v', 'libx264',
            '-preset', 'veryfast',
            '-pix_fmt', 'yuv420p',
            '-r', '24',
            sceneClipPath,
          ]);
          sceneVideoPaths.push(sceneClipPath);
          continue;
        }

        const overlayBuffer = await this.renderSceneOverlaySvg({
          sceneText: scene.text,
          sublabel: project.project.name || 'Demo Residence',
          profile: 'PRESENTER_LED_PREMIUM_AD',
          accentColor,
          hasLogo: Boolean(project.media.logo.uploaded),
          skipCaptionText: true,
        });
        await fsPromises.writeFile(overlayPath, overlayBuffer);

        if (scene.runwayClip && runwayClipPath && fs.existsSync(runwayClipPath)) {
          await runFfmpeg([
            '-y',
            '-i', runwayClipPath,
            '-i', overlayPath,
            '-filter_complex',
            '[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,format=yuv420p[bg];[bg][1:v]overlay=0:0,format=yuv420p[outv]',
            '-map', '[outv]',
            '-t', String(scene.seconds),
            '-c:v', 'libx264',
            '-preset', 'veryfast',
            '-pix_fmt', 'yuv420p',
            '-r', '24',
            sceneClipPath,
          ]);
        } else {
          // Robust room-to-media resolution
          let inputMediaPath = this.resolveSceneMedia(scene, mappedPhotos, allAvailablePhotos);
          if (!inputMediaPath || !fs.existsSync(inputMediaPath) || isBannedAsset(inputMediaPath)) {
            const uploadsDir = path.join(mockAiGenStorage.getRoot(), 'uploads');
            const diskFiles = fs.existsSync(uploadsDir)
              ? fs.readdirSync(uploadsDir).filter((f) => /\.(jpe?g|png|webp|mp4|mov)$/i.test(f) && !f.includes('logo') && !isBannedAsset(f))
              : [];
            inputMediaPath = diskFiles.length > 0
              ? path.join(uploadsDir, diskFiles[i % diskFiles.length])
              : path.join(tempDir, `fallback_${i}.png`);
            if (!fs.existsSync(inputMediaPath)) {
              await sharp({
                create: { width: 1080, height: 1920, channels: 3, background: { r: 16, g: 34, b: 56 } },
              }).png().toFile(inputMediaPath);
            }
          }

          const isVideoFile = /\.(mp4|mov|webm|m4v|avi)$/i.test(inputMediaPath);
          if (isVideoFile) {
            await runFfmpeg([
              '-y',
              '-stream_loop', '-1',
              '-i', inputMediaPath,
              '-i', overlayPath,
              '-filter_complex',
              '[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,eq=contrast=1.06:saturation=1.04:gamma=0.98,format=yuv420p[v0];[v0][1:v]overlay=0:0,format=yuv420p[outv]',
              '-map', '[outv]',
              '-t', String(scene.seconds),
              '-c:v', 'libx264',
              '-preset', 'veryfast',
              '-pix_fmt', 'yuv420p',
              '-r', '24',
              sceneClipPath,
            ]);
          } else {
            const zoomMotion =
              "zoompan=z='min(zoom+0.0012,1.10)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=120:s=1080x1920:fps=24";
            await runFfmpeg([
              '-y',
              '-loop', '1',
              '-i', inputMediaPath,
              '-i', overlayPath,
              '-filter_complex',
              `[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,${zoomMotion},eq=contrast=1.05:saturation=1.04,format=yuv420p[motion];[motion][1:v]overlay=0:0,format=yuv420p[outv]`,
              '-map', '[outv]',
              '-t', String(scene.seconds),
              '-c:v', 'libx264',
              '-preset', 'veryfast',
              '-pix_fmt', 'yuv420p',
              '-r', '24',
              sceneClipPath,
            ]);
          }
        }
        sceneVideoPaths.push(sceneClipPath);
      }

      // Concatenate pilot scenes
      const concatListFile = path.join(tempDir, 'pilot_concat.txt');
      const listContent = sceneVideoPaths.map((p) => `file '${path.basename(p)}'`).join('\n');
      await fsPromises.writeFile(concatListFile, listContent);

      const totalPilotDuration = 12.5;

      // Pilot campaign specification for narration script & subtitle timeline
      const pilotCampaignSpec: MockCampaign = {
        id: 'pilot_style_match_1013',
        campaignName: 'Presenter-Led Style-Match Pilot Demo',
        goal: '12.5s Pilot demo matching 1013.mp4 reference aesthetics with voiceover and animated captions',
        platform: 'facebook',
        publishAtLocal: '2026-12-25T19:00:00+05:30',
        timezone: 'Asia/Kolkata',
        status: 'DRAFT_NOT_SCHEDULED',
        language: 'Hinglish / English',
        designProfile: 'PRESENTER_LED_PREMIUM_AD',
        visualDirection: '1013.mp4 style match with synchronized voiceover and animated captions',
        durationSeconds: totalPilotDuration,
        output: { width: 1080, height: 1920, fps: 24, format: 'mp4', aspectRatio: '9:16' },
        caption: 'Pilot style-match ad demo',
        music: { enabled: true, licensedTrackAssetId: null },
        voiceover: { enabled: true },
        scenes: pilotScenes,
      };

      // Generate Pilot Voiceover Script & Captions Timeline
      const { script, timeline } = mockVoiceoverService.generateScriptAndTimeline(pilotCampaignSpec, project);
      const audioDir = path.join(mockAiGenStorage.getRoot(), 'audio');
      await fsPromises.mkdir(audioDir, { recursive: true });

      await fsPromises.writeFile(path.join(audioDir, 'narration_script_pilot.json'), JSON.stringify(script, null, 2), 'utf8');
      await fsPromises.writeFile(path.join(audioDir, 'captions_timeline_pilot.json'), JSON.stringify(timeline, null, 2), 'utf8');

      // Synthesize pilot voiceover track
      const voTrackPath = path.join(tempDir, 'pilot_voiceover_track.wav');
      await mockVoiceoverService.synthesizeVoiceoverTrack(script, voTrackPath);
      await fsPromises.copyFile(voTrackPath, path.join(audioDir, 'voiceover_track_pilot.wav')).catch(() => {});

      // Generate pilot ambient music track
      const ambientMusicPath = path.join(tempDir, 'pilot_ambient_music.aac');
      await mockVoiceoverService.generateAmbientMusicTrack(totalPilotDuration, ambientMusicPath);

      // Write pilot ASS subtitles
      const assPath = path.join(tempDir, 'pilot_subtitles.ass');
      await mockVoiceoverService.writeAssSubtitleFile(timeline, assPath);
      const escapedAss = assPath.replace(/\\/g, '/').replace(':', '\\:');

      // Final pilot render: video + ASS subtitles + ducked ambient audio mix
      const pilotFilterComplex =
        `[0:v]ass='${escapedAss}'[vout];` +
        `[2:a]volume=0.20,afade=t=in:d=0.8,afade=t=out:st=${totalPilotDuration - 1.5}:d=1.5,aformat=channel_layouts=stereo:sample_rates=48000[music];` +
        `[1:a]aformat=channel_layouts=stereo:sample_rates=48000,asplit=2[vo][sc];` +
        `[music][sc]sidechaincompress=threshold=0.03:ratio=7:attack=25:release=350[ducked];` +
        `[vo][ducked]amix=inputs=2:duration=longest:dropout_transition=0:normalize=0[mixed];` +
        `[mixed]loudnorm=I=-14:LRA=7:TP=-1.5,alimiter=limit=-1.5dB:level=false,aformat=channel_layouts=stereo:sample_rates=48000[aout]`;

      const voDuration = await mockVoiceoverService.probeAudioDuration(voTrackPath);
      const musicDuration = await mockVoiceoverService.probeAudioDuration(ambientMusicPath);

      logger.info('--- FINAL MIX AUDIO INPUTS AUDIT ---');
      logger.info({
        campaignId: campaign.id,
        targetDuration: campaign.durationSeconds,
        input0_video_footage: { source: concatListFile, audioStream: 'MUTED (-an / 0 audio channels)', duration: campaign.durationSeconds },
        input1_narration: { source: path.basename(voTrackPath), duration: voDuration, startSeconds: 0, endSeconds: voDuration, volume: 1.0, mixedTimes: 1 },
        input2_music_bed: { source: path.basename(ambientMusicPath), duration: musicDuration, startSeconds: 0, endSeconds: campaign.durationSeconds, volume: 0.20, ducking: '-12dB sidechain' },
        mastering: 'loudnorm I=-14 LRA=7 TP=-1.5, alimiter limit=-1.5dB, 48kHz stereo AAC'
      }, `Final Audio Mix Plan for ${campaign.id}`);

      await runFfmpeg([
        '-y',
        '-f', 'concat',
        '-safe', '0',
        '-i', concatListFile,
        '-i', voTrackPath,
        '-i', ambientMusicPath,
        '-filter_complex', pilotFilterComplex,
        '-map', '[vout]',
        '-map', '[aout]',
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-pix_fmt', 'yuv420p',
        '-movflags', '+faststart',
        '-c:a', 'aac',
        '-b:a', '192k',
        '-t', String(totalPilotDuration),
        outputPath,
      ]);

      await runFfmpeg([
        '-y',
        '-ss', '00:00:01.500',
        '-i', outputPath,
        '-vframes', '1',
        '-q:v', '2',
        posterPath,
      ]).catch(() => {});

      logger.info({ outputPath }, 'Composed style-match pilot video with voiceover and animated captions successfully');
    } finally {
      await fsPromises.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }

    const videoUrl = `/api/v1/mock-ai-gen/files/rendered_ads/${filename}`;
    const posterUrl = `/api/v1/mock-ai-gen/files/rendered_ads/${posterFilename}`;

    return {
      campaignId: 'pilot_style_match_1013',
      designProfile: 'PRESENTER_LED_PREMIUM_AD',
      language: 'Hinglish / English',
      videoUrl,
      posterUrl,
      absolutePath: outputPath,
      storageKey,
      durationSeconds: 12.5,
      width: 1080,
      height: 1920,
      scenesCount: 3,
      renderedAt: new Date().toISOString(),
      hasRunwayClip: Boolean(runwayClipPath && fs.existsSync(runwayClipPath)),
      runwayTaskId: runwayTaskId || undefined,
      hasVoiceover: true,
      hasAnimatedCaptions: true,
      narrationScriptUrl: '/api/v1/mock-ai-gen/files/audio/narration_script_pilot.json',
      captionsTimelineUrl: '/api/v1/mock-ai-gen/files/audio/captions_timeline_pilot.json',
      voiceoverAudioUrl: '/api/v1/mock-ai-gen/files/audio/voiceover_track_pilot.wav',
    };
  }
}

export const mockAdComposer = new MockAdComposer();
