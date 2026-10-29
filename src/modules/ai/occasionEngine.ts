import sharp from 'sharp';
import path from 'path';
import fs from 'fs/promises';
import { defaultStorage } from '../../storage/localStorage.adapter.js';
import { logger } from '../../config/logger.js';
import { ShowcasePosterData, SelectedPosterPhotos, loadAssetBuffer } from './showcasePosterRenderer.js';

export interface OccasionConfig {
  key: string;
  name: string;
  badge: string;
  greetingHeadline: string;
  subGreeting: string;
  tagline: string;
  accentColors: [string, string, string]; // [primaryAccent, secondaryAccent, darkTone]
  backgroundColors: [string, string, string]; // [top, mid, bottom]
  badgeBackground: string;
  badgeBorder: string;
  badgeTextColor: string;
  defaultOffer: string;
  lowerThirdText: string;
  iconSvgSymbol: string;
}

export const OCCASIONS: Record<string, OccasionConfig> = {
  diwali: {
    key: 'diwali',
    name: 'Diwali Festival of Lights',
    badge: '🪔 DIWALI FESTIVE PRIVILEGE',
    greetingHeadline: 'Illuminate Your Life in a Royal Abode',
    subGreeting: 'Warmest Diwali Wishes from the GDPL Family',
    tagline: 'This Auspicious Season, Own the Landmark You Deserve',
    accentColors: ['#D97706', '#F59E0B', '#78350F'],
    backgroundColors: ['#FFFBEB', '#FEF3C7', '#F8FAFC'],
    badgeBackground: '#FEF3C7',
    badgeBorder: '#F59E0B',
    badgeTextColor: '#92400E',
    defaultOffer: '*Festive Diwali Offer: Zero Stamp Duty & Gold Coin on Spot Booking',
    lowerThirdText: 'Warm Diwali Wishes · Celebrate in Luxury · Sector 91 Mohali',
    iconSvgSymbol: '🪔',
  },
  holi: {
    key: 'holi',
    name: 'Holi Festival of Colors',
    badge: '🎨 HOLI FESTIVAL SPECIAL',
    greetingHeadline: 'Add Vibrant Colors of Prosperity to Your Future',
    subGreeting: 'Wishing You and Your Loved Ones a Joyous Holi',
    tagline: 'Step Into a Harmonious Community Surrounded by Greenery',
    accentColors: ['#059669', '#10B981', '#047857'],
    backgroundColors: ['#ECFDF5', '#D1FAE5', '#F8FAFC'],
    badgeBackground: '#D1FAE5',
    badgeBorder: '#10B981',
    badgeTextColor: '#065F46',
    defaultOffer: '*Spring Festival Benefit: Zero Documentation Charges on Spot Booking',
    lowerThirdText: 'Happy Holi · Vibrant Luxury Living · Book Site Visit Today',
    iconSvgSymbol: '🎨',
  },
  independence_day: {
    key: 'independence_day',
    name: 'Independence Day Privilege',
    badge: '🇮🇳 INDEPENDENCE DAY PRIVILEGE',
    greetingHeadline: 'Celebrate the True Freedom of Expansive Luxury',
    subGreeting: 'Pride, Heritage and Regal Architecture',
    tagline: 'Generous Balconies, Expansive Green Podiums & Open Vistas',
    accentColors: ['#EA580C', '#1E3A8A', '#16A34A'],
    backgroundColors: ['#FFF7ED', '#EFF6FF', '#F8FAFC'],
    badgeBackground: '#EFF6FF',
    badgeBorder: '#3B82F6',
    badgeTextColor: '#1E40AF',
    defaultOffer: '*Freedom Subvention Scheme: Pay 20% Now, Rest on Handover',
    lowerThirdText: 'Proudly Celebrating Freedom · Regal Living in Mohali',
    iconSvgSymbol: '🇮🇳',
  },
  new_year: {
    key: 'new_year',
    name: 'New Year & New Milestones',
    badge: '✨ NEW YEAR, NEW ADDRESS',
    greetingHeadline: 'Step Into a Grand Lifestyle This Year',
    subGreeting: 'Start Your New Chapter in Exceptional Comfort',
    tagline: 'World-Class Amenities, Private Balconies & Iconic Towers',
    accentColors: ['#D97706', '#E2BA52', '#0F172A'],
    backgroundColors: ['#F8FAFC', '#F1F5F9', '#E2E8F0'],
    badgeBackground: '#FEF3C7',
    badgeBorder: '#D97706',
    badgeTextColor: '#78350F',
    defaultOffer: '*New Year Privilege: Imported Modular Kitchen Package Included',
    lowerThirdText: 'A New Milestone in Luxury · Schedule Private Tour',
    iconSvgSymbol: '✨',
  },
  monsoon: {
    key: 'monsoon',
    name: 'Monsoon Serenity & Balcony Living',
    badge: '🌧️ MONSOON LIVING SPECIAL',
    greetingHeadline: 'Wake Up to Rain-Washed Panoramic Balcony Views',
    subGreeting: 'Breathe Fresh Nature Across Landscaped Podium Parks',
    tagline: 'Expansive Deck Balconies Overlooking Sector 91 & 114 Mohali',
    accentColors: ['#0D9488', '#0284C7', '#0369A1'],
    backgroundColors: ['#F0FDFA', '#E0F2FE', '#F8FAFC'],
    badgeBackground: '#CCFBF1',
    badgeBorder: '#14B8A6',
    badgeTextColor: '#115E59',
    defaultOffer: '*Monsoon Special: Priority High-Floor Inventory Allocation',
    lowerThirdText: 'Lush Balcony Living · Rain-Washed Green Views · Book Visit',
    iconSvgSymbol: '🌧️',
  },
  promotional_offer: {
    key: 'promotional_offer',
    name: 'Festive Privilege Booking Offer',
    badge: '🔥 LIMITED TIME FESTIVE PRIVILEGE',
    greetingHeadline: 'A Rare Opportunity to Own an Iconic Landmark Residence',
    subGreeting: 'Exclusive Limited-Inventory Booking Scheme',
    tagline: 'Immediate Possession Available on Select Towers & Configurations',
    accentColors: ['#DC2626', '#EA580C', '#7F1D1D'],
    backgroundColors: ['#FEF2F2', '#FEE2E2', '#F8FAFC'],
    badgeBackground: '#FEE2E2',
    badgeBorder: '#EF4444',
    badgeTextColor: '#991B1B',
    defaultOffer: '*Festive Privilege: Guaranteed Inaugural Price Lock on First 10 Bookings',
    lowerThirdText: 'Exclusive Festive Pricing · Verified RERA Credentials · Call Now',
    iconSvgSymbol: '🔥',
  },
};

export function getOccasionConfig(key?: string): OccasionConfig {
  if (!key) return OCCASIONS.diwali;
  const normalized = key.toLowerCase().trim();
  return OCCASIONS[normalized] || OCCASIONS.diwali;
}

/**
 * Escapes characters for safe SVG insertion
 */
function escapeXml(unsafe?: string): string {
  if (!unsafe) return '';
  return String(unsafe)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Render Occasion-Themed Poster across 4:5, 1:1, or 9:16
 */
export async function renderOccasionPoster(params: {
  ratio: '4:5' | '1:1' | '9:16';
  width: number;
  height: number;
  data: ShowcasePosterData;
  selectedPhotos: SelectedPosterPhotos;
  occasionKey?: string;
  customOffer?: string;
}): Promise<{ pngBuffer: Buffer; jpegBuffer: Buffer }> {
  const { ratio, width, height, data, selectedPhotos, occasionKey, customOffer } = params;
  const occasion = getOccasionConfig(occasionKey);

  const outerPadding = 24;
  const cornerRadius = 20;

  // Layout bounds
  const contentWidth = width - outerPadding * 2;
  const contentHeight = height - outerPadding * 2;

  // Proportions
  const headerHeight = Math.round(height * 0.14);
  const heroHeight = Math.round(height * 0.38);
  const thumbsHeight = Math.round(height * 0.12);
  const gap = 12;

  // Hero bounds
  const heroY = outerPadding + headerHeight + gap;

  // Thumbs bounds
  const thumbsY = heroY + heroHeight + gap;

  // Info Card bounds
  const infoCardY = thumbsY + thumbsHeight + gap;
  const infoCardHeight = outerPadding + contentHeight - infoCardY;

  // Process Photos via Sharp
  const heroRaw = await loadAssetBuffer(selectedPhotos.hero.asset);
  const heroBuffer = await sharp(heroRaw)
    .resize(contentWidth, heroHeight, { fit: 'cover', position: 'center' })
    .png()
    .toBuffer();

  // Round hero corners
  const heroRoundedMask = Buffer.from(`
    <svg width="${contentWidth}" height="${heroHeight}">
      <rect x="0" y="0" width="${contentWidth}" height="${heroHeight}" rx="14" ry="14" fill="#FFFFFF"/>
    </svg>
  `);

  const maskedHero = await sharp(heroBuffer)
    .composite([{ input: heroRoundedMask, blend: 'dest-in' }])
    .png()
    .toBuffer();

  // Process Thumbnails (up to 3)
  const thumbCount = Math.min(3, Math.max(1, selectedPhotos.thumbs.length));
  const thumbGap = 10;
  const thumbWidth = Math.floor((contentWidth - (thumbCount - 1) * thumbGap) / thumbCount);

  const thumbComposites: Array<{ input: Buffer; left: number; top: number }> = [];

  for (let i = 0; i < thumbCount; i++) {
    const thumbItem = selectedPhotos.thumbs[i];
    if (!thumbItem) break;

    const thumbX = outerPadding + i * (thumbWidth + thumbGap);
    const rawThumbAsset = await loadAssetBuffer(thumbItem.asset);
    const rawThumb = await sharp(rawThumbAsset)
      .resize(thumbWidth, thumbsHeight, { fit: 'cover', position: 'center' })
      .png()
      .toBuffer();

    const thumbMask = Buffer.from(`
      <svg width="${thumbWidth}" height="${thumbsHeight}">
        <rect x="0" y="0" width="${thumbWidth}" height="${thumbsHeight}" rx="10" ry="10" fill="#FFFFFF"/>
      </svg>
    `);

    const maskedThumb = await sharp(rawThumb)
      .composite([{ input: thumbMask, blend: 'dest-in' }])
      .png()
      .toBuffer();

    thumbComposites.push({
      input: maskedThumb,
      left: thumbX,
      top: thumbsY,
    });
  }

  // Build SVG background & overlays
  const [bgTop, bgMid, bgBottom] = occasion.backgroundColors;
  const [accent1, accent2, darkTone] = occasion.accentColors;

  const offerText = customOffer || occasion.defaultOffer;

  const bgSvg = `
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="occasionBg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${bgTop}" />
          <stop offset="50%" stop-color="${bgMid}" />
          <stop offset="100%" stop-color="${bgBottom}" />
        </linearGradient>
        <linearGradient id="festiveBar" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stop-color="${accent1}" />
          <stop offset="50%" stop-color="${accent2}" />
          <stop offset="100%" stop-color="${accent1}" />
        </linearGradient>
        <filter id="softCardShadow" x="-10%" y="-10%" width="120%" height="120%">
          <feDropShadow dx="0" dy="4" stdDeviation="8" flood-color="#0F172A" flood-opacity="0.08" />
        </filter>
      </defs>

      <!-- Background with Rounded Outer Border -->
      <rect x="${outerPadding}" y="${outerPadding}" width="${contentWidth}" height="${contentHeight}" rx="${cornerRadius}" ry="${cornerRadius}" fill="url(#occasionBg)" stroke="#E2E8F0" stroke-width="1.5" />

      <!-- HEADER AREA -->
      <g transform="translate(${outerPadding}, ${outerPadding + 14})">
        <!-- Festive Badge Pill -->
        <rect x="${(contentWidth - 280) / 2}" y="0" width="280" height="28" rx="14" ry="14" fill="${occasion.badgeBackground}" stroke="${occasion.badgeBorder}" stroke-width="1.5" />
        <text x="${contentWidth / 2}" y="19" font-family="'Inter', -apple-system, sans-serif" font-size="11" font-weight="700" fill="${occasion.badgeTextColor}" text-anchor="middle" letter-spacing="1">
          ${escapeXml(occasion.badge)}
        </text>

        <!-- Project Title -->
        <text x="${contentWidth / 2}" y="56" font-family="'Inter', -apple-system, sans-serif" font-size="28" font-weight="800" fill="#0F172A" text-anchor="middle" letter-spacing="-0.5">
          ${escapeXml(data.projectName)}
        </text>

        <!-- Festive Underline Bar -->
        <rect x="${(contentWidth - 100) / 2}" y="66" width="100" height="3" rx="1.5" ry="1.5" fill="url(#festiveBar)" />

        <!-- Festive Subtitle & Occasion Greeting -->
        <text x="${contentWidth / 2}" y="88" font-family="'Inter', -apple-system, sans-serif" font-size="13" font-weight="600" fill="${accent1}" text-anchor="middle">
          ${escapeXml(occasion.greetingHeadline)}
        </text>
        <text x="${contentWidth / 2}" y="104" font-family="'Inter', -apple-system, sans-serif" font-size="12" font-weight="500" fill="#64748B" text-anchor="middle">
          ${escapeXml(data.city || 'Mohali')}, ${escapeXml(data.state || 'Punjab')} • ${escapeXml(data.unitType || 'Luxury')} ${escapeXml(data.category || 'RESIDENTIAL')} • ${data.areaSqFt ? escapeXml(String(data.areaSqFt)) + ' Sq. Ft.' : 'Spacious Layout'}
        </text>
      </g>
    </svg>
  `;

  // Foregrounds SVG (Info Card, Price block, Festive offer, Buttons, RERA disclaimer)
  const fgSvg = `
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="btnGrad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stop-color="${accent1}" />
          <stop offset="100%" stop-color="${accent2}" />
        </linearGradient>
      </defs>

      <!-- INFO CARD -->
      <g transform="translate(${outerPadding + 10}, ${infoCardY})">
        <!-- Card Backdrop -->
        <rect x="0" y="0" width="${contentWidth - 20}" height="${infoCardHeight - 20}" rx="14" ry="14" fill="#FFFFFF" stroke="#E2E8F0" stroke-width="1" />

        <!-- Price & Investment Banner -->
        <rect x="16" y="16" width="${contentWidth - 52}" height="48" rx="8" ry="8" fill="${occasion.badgeBackground}" stroke="${occasion.badgeBorder}" stroke-width="1" />
        <text x="28" y="34" font-family="'Inter', -apple-system, sans-serif" font-size="11" font-weight="700" fill="${occasion.badgeTextColor}" letter-spacing="0.8">
          STARTING INVESTMENT
        </text>
        <text x="28" y="53" font-family="'Inter', -apple-system, sans-serif" font-size="18" font-weight="800" fill="#0F172A">
          ${escapeXml(data.priceDisplay || 'Price on Request')}
        </text>
        <text x="${contentWidth - 68}" y="44" font-family="'Inter', -apple-system, sans-serif" font-size="11" font-weight="600" fill="${occasion.badgeTextColor}" text-anchor="end">
          *RERA Terms Apply
        </text>

        <!-- Festive Promotional Offer Note -->
        <rect x="16" y="72" width="${contentWidth - 52}" height="32" rx="6" ry="6" fill="#F8FAFC" stroke="#E2E8F0" stroke-width="1" />
        <text x="28" y="92" font-family="'Inter', -apple-system, sans-serif" font-size="11" font-weight="600" fill="${accent1}">
          ${escapeXml(offerText)}
        </text>

        <!-- Metadata Chips -->
        <g transform="translate(16, 114)">
          <rect x="0" y="0" width="160" height="26" rx="6" ry="6" fill="#F1F5F9" />
          <text x="80" y="17" font-family="'Inter', -apple-system, sans-serif" font-size="11" font-weight="600" fill="#334155" text-anchor="middle">
            Configuration: ${escapeXml(data.unitType || 'Premium')}
          </text>

          <rect x="170" y="0" width="160" height="26" rx="6" ry="6" fill="#F1F5F9" />
          <text x="250" y="17" font-family="'Inter', -apple-system, sans-serif" font-size="11" font-weight="600" fill="#334155" text-anchor="middle">
            Super Area: ${data.areaSqFt ? escapeXml(String(data.areaSqFt)) + ' Sq. Ft.' : 'Spacious Layout'}
          </text>
        </g>

        <!-- Action CTA Buttons -->
        <g transform="translate(16, ${infoCardHeight - 96})">
          <!-- Request Details -->
          <rect x="0" y="0" width="${(contentWidth - 62) / 2}" height="38" rx="8" ry="8" fill="#F1F5F9" stroke="#CBD5E1" stroke-width="1" />
          <text x="${(contentWidth - 62) / 4}" y="24" font-family="'Inter', -apple-system, sans-serif" font-size="13" font-weight="600" fill="#0F172A" text-anchor="middle">
            Enquire &amp; Details
          </text>

          <!-- Book Festive Visit -->
          <rect x="${(contentWidth - 62) / 2 + 10}" y="0" width="${(contentWidth - 62) / 2}" height="38" rx="8" ry="8" fill="url(#btnGrad)" />
          <text x="${(contentWidth - 62) / 2 + 10 + (contentWidth - 62) / 4}" y="24" font-family="'Inter', -apple-system, sans-serif" font-size="13" font-weight="700" fill="#FFFFFF" text-anchor="middle">
            Book Site Visit →
          </text>
        </g>

        <!-- Official Contact & RERA Footer -->
        <text x="${(contentWidth - 20) / 2}" y="${infoCardHeight - 44}" font-family="'Inter', -apple-system, sans-serif" font-size="11" font-weight="600" fill="#0F172A" text-anchor="middle">
          Official Sales Gallery: ${escapeXml(data.phone || '+91 98765 43210')} • ${escapeXml(data.orgName || 'GDPL')}
        </text>
        <text x="${(contentWidth - 20) / 2}" y="${infoCardHeight - 30}" font-family="'Inter', -apple-system, sans-serif" font-size="10" font-weight="500" fill="#64748B" text-anchor="middle">
          RERA Registered: ${escapeXml(data.reraNumber || 'PBRERA-SAS81-PR0123')} • 100% Verified Authentic On-Site Photography
        </text>
      </g>
    </svg>
  `;

  // Composite Everything
  const baseImg = await sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    },
  })
    .composite([
      { input: Buffer.from(bgSvg), top: 0, left: 0 },
      { input: maskedHero, top: heroY, left: outerPadding },
      ...thumbComposites,
      { input: Buffer.from(fgSvg), top: 0, left: 0 },
    ])
    .png()
    .toBuffer();

  const jpegBuffer = await sharp(baseImg).jpeg({ quality: 92 }).toBuffer();

  return { pngBuffer: baseImg, jpegBuffer };
}
