import sharp from 'sharp';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { Types } from 'mongoose';
import { IMediaAsset } from '../../models/MediaAsset.js';
import { IProject } from '../../models/Project.js';
import { IPropertyUnit } from '../../models/PropertyUnit.js';
import { IBrandProfile } from '../../models/BrandProfile.js';
import { IOrganization } from '../../models/Organization.js';
import { defaultStorage } from '../../storage/localStorage.adapter.js';

export interface ShowcasePosterData {
  category: string;
  projectName: string;
  city?: string;
  state?: string;
  unitType?: string;
  propertyType?: string;
  areaSqFt?: number | string;
  priceDisplay?: string;
  priceNote?: string;
  hasPrice: boolean;
  bedrooms?: string;
  possession?: string;
  phone?: string;
  website?: string;
  salesLabel?: string;
  reraNumber?: string;
  isAllActualPhotos: boolean;
  orgName: string;
  brandPrimaryColor?: string;
  stylePreset?: 'HERITAGE_LUXURY' | 'HIGH_GROWTH_ROI';
}

export interface SelectedPosterPhotos {
  hero: { asset: IMediaAsset; tag: string };
  thumbs: Array<{ asset: IMediaAsset; tag: string }>;
  isAllActual: boolean;
}

/**
 * Selects up to 4 distinct, approved, rights-consented photos for the Showcase poster.
 * Hero: unit/project cover, or tagged living room/hall.
 * Thumbs: kitchen, bedroom, bathroom by tag; fallback to next best distinct by sortOrder.
 * Never repeats a photo; never uses media of another unit.
 */
export function selectShowcasePhotos(
  allMedia: IMediaAsset[],
  options?: {
    unitId?: Types.ObjectId | string;
    heroAssetId?: Types.ObjectId | string;
  }
): SelectedPosterPhotos {
  const targetUnitId = options?.unitId ? options.unitId.toString() : undefined;
  const targetHeroId = options?.heroAssetId ? options.heroAssetId.toString() : undefined;

  // Filter approved, rights-consented image assets belonging to project or target unit
  const eligible = allMedia.filter((m) => {
    if (m.type !== 'IMAGE') return false;
    const isConsentConfirmed = m.rightsConsent?.confirmed === true;
    const isApproved = m.isApproved === true || m.approvalStatus === 'APPROVED';
    if (!isConsentConfirmed || !isApproved) return false;

    // Unit filtering: if targetUnitId is specified, media must either belong to this unit OR be project-level (no unitId)
    if (targetUnitId && m.unitId) {
      if (m.unitId.toString() !== targetUnitId) return false;
    }
    return true;
  });

  if (eligible.length === 0) {
    throw new Error('needs photos: No approved image assets available for poster generation');
  }

  // Deduplicate by storageKey or url or _id
  const seenKeys = new Set<string>();
  const distinctMedia: IMediaAsset[] = [];
  for (const m of eligible) {
    const key = m.storageKey || m.url || m._id.toString();
    if (!seenKeys.has(key)) {
      seenKeys.add(key);
      distinctMedia.push(m);
    }
  }

  if (distinctMedia.length === 0) {
    throw new Error('needs photos: No approved image assets available for poster generation');
  }

  // Helper to test if an asset matches room/tag query
  const matchesTag = (m: IMediaAsset, re: RegExp): boolean => {
    const roomStr = [m.room, m.roomType, m.category, ...(m.tags || []), m.filename].filter(Boolean).join(' ');
    return re.test(roomStr);
  };

  // Helper to determine display tag
  const getDisplayTag = (m: IMediaAsset, fallback: string): string => {
    if (m.room && m.room.trim()) return m.room.trim().toUpperCase();
    if (m.roomType && m.roomType.trim()) return m.roomType.trim().toUpperCase();
    if (m.category && m.category !== 'OTHER' && m.category.trim()) return m.category.replace(/_/g, ' ').toUpperCase();
    if (m.tags && m.tags.length > 0) {
      const roomTag = m.tags.find((t) => !/actual|illustrative|hero|cover/i.test(t));
      if (roomTag && roomTag.trim()) return roomTag.trim().toUpperCase();
    }
    return fallback.toUpperCase();
  };

  // 1. Resolve Hero
  let heroAsset: IMediaAsset | undefined;
  if (targetHeroId) {
    heroAsset = distinctMedia.find((m) => m._id.toString() === targetHeroId);
  }
  if (!heroAsset) {
    heroAsset = distinctMedia.find((m) => m.isCover);
  }
  if (!heroAsset) {
    heroAsset = distinctMedia.find((m) => matchesTag(m, /living|hall|drawing|lounge/i));
  }
  if (!heroAsset) {
    // Sort by sortOrder ascending
    const sorted = [...distinctMedia].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    heroAsset = sorted[0];
  }

  const heroTag = getDisplayTag(heroAsset, 'LIVING AREA');

  // 2. Resolve Thumbs from remaining distinct photos
  const remaining = distinctMedia.filter((m) => m._id.toString() !== heroAsset!._id.toString());
  const selectedThumbs: Array<{ asset: IMediaAsset; tag: string }> = [];
  const usedThumbIds = new Set<string>();

  const findBestThumb = (re: RegExp, fallbackTag: string): { asset: IMediaAsset; tag: string } | null => {
    const candidate = remaining.find((m) => !usedThumbIds.has(m._id.toString()) && matchesTag(m, re));
    if (candidate) {
      usedThumbIds.add(candidate._id.toString());
      return { asset: candidate, tag: getDisplayTag(candidate, fallbackTag) };
    }
    return null;
  };

  // Try Kitchen, Bedroom, Bathroom
  const kitchen = findBestThumb(/kitchen/i, 'KITCHEN');
  if (kitchen) selectedThumbs.push(kitchen);

  const bedroom = findBestThumb(/bed|master/i, 'BEDROOM');
  if (bedroom) selectedThumbs.push(bedroom);

  const bathroom = findBestThumb(/bath|toilet/i, 'BATHROOM');
  if (bathroom) selectedThumbs.push(bathroom);

  // Fill up to 3 from remaining by sortOrder
  if (selectedThumbs.length < 3) {
    const leftover = remaining
      .filter((m) => !usedThumbIds.has(m._id.toString()))
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

    for (const m of leftover) {
      if (selectedThumbs.length >= 3) break;
      usedThumbIds.add(m._id.toString());
      selectedThumbs.push({ asset: m, tag: getDisplayTag(m, 'INTERIOR') });
    }
  }

  const allSelectedAssets = [heroAsset, ...selectedThumbs.map((t) => t.asset)];
  const isAllActual = allSelectedAssets.every(
    (a) => a.actualOrIllustrative === 'ACTUAL' || (a.tags && a.tags.some((t) => /actual/i.test(t)))
  );

  return {
    hero: { asset: heroAsset, tag: heroTag },
    thumbs: selectedThumbs,
    isAllActual,
  };
}

/**
 * Builds verified factual data mapping from project, unit, organization and brand profile.
 * Never invents claims or details.
 */
export function buildShowcaseFacts(params: {
  project: IProject;
  unit?: IPropertyUnit | null;
  organization?: IOrganization | null;
  brand?: IBrandProfile | null;
  isAllActualPhotos: boolean;
  stylePreset?: 'HERITAGE_LUXURY' | 'HIGH_GROWTH_ROI';
}): ShowcasePosterData {
  const { project, unit, organization, brand, isAllActualPhotos, stylePreset = 'HERITAGE_LUXURY' } = params;

  const category = (project.category || 'RESIDENTIAL').toUpperCase();

  // Price formatting: Indian style ("₹ 2.45 Cr", "₹ 85 Lac")
  let priceDisplay = '';
  let hasPrice = false;

  const rawPrice = unit?.price || (project.priceRange?.min ? project.priceRange.min : 0);
  const rawPriceDisplay = unit?.priceDisplay || project.priceRange?.display || '';
  const isRequestOrEmpty = !rawPriceDisplay || /on request|call for price|price on request/i.test(rawPriceDisplay.trim());

  if (!isRequestOrEmpty && rawPriceDisplay.trim()) {
    priceDisplay = rawPriceDisplay.trim();
    hasPrice = true;
  } else if (rawPrice && rawPrice > 0) {
    if (rawPrice >= 10000000) {
      const cr = rawPrice / 10000000;
      priceDisplay = `₹ ${cr % 1 === 0 ? cr.toFixed(0) : cr.toFixed(2)} Cr`;
    } else if (rawPrice >= 100000) {
      const lac = rawPrice / 100000;
      priceDisplay = `₹ ${lac % 1 === 0 ? lac.toFixed(0) : lac.toFixed(2)} Lac`;
    } else {
      priceDisplay = `₹ ${rawPrice.toLocaleString('en-IN')}`;
    }
    hasPrice = true;
  }

  // Price note & terms asterisk
  const details = (project.details || {}) as Record<string, any>;
  const hasTermsNote = !!(
    details.termsNote ||
    details.terms ||
    details.conditions ||
    (project as any).termsNote ||
    (unit as any)?.termsNote
  );

  if (hasPrice) {
    if (hasTermsNote) {
      if (!priceDisplay.endsWith('*')) priceDisplay += '*';
    } else {
      priceDisplay = priceDisplay.replace(/\*+$/, '').trim();
    }
  }

  let priceNote = '';
  const isAllInclusive = details.allInclusive === true || details.pricingType === 'ALL_INCLUSIVE';
  const isRent =
    project.subtype?.toLowerCase().includes('rent') ||
    (category === 'COMMERCIAL' && (details.forRent || details.rent));

  if (isRent) {
    priceNote = '/ month';
  } else if (isAllInclusive) {
    priceNote = 'All-Inclusive Onwards';
  }

  // Subtitle components
  const city = project.location?.city?.trim();
  const state = project.location?.state?.trim();

  // Unit type like "4 BHK" (never show the category word as the unit type)
  let unitType = unit?.unitType?.trim() || '';
  if (
    unitType.toUpperCase() === category ||
    unitType.toLowerCase() === 'residential' ||
    unitType.toLowerCase() === 'commercial' ||
    unitType.toLowerCase() === 'industrial'
  ) {
    unitType = '';
  }

  const propertyType = project.subtype?.trim() || '';
  const areaSqFt =
    unit?.carpetAreaSqFt ||
    unit?.superBuiltUpAreaSqFt ||
    (details.carpetAreaSqFt as number) ||
    (details.areaSqFt as number);

  // Bedrooms chip
  let bedrooms = '';
  if (unitType && /bhk|studio|room/i.test(unitType)) {
    bedrooms = unitType.toUpperCase();
  } else if (details.bhk) {
    bedrooms = `${details.bhk} BHK`.toUpperCase();
  }

  // Possession chip
  let possession = '';
  if (details.possessionStatus) {
    possession = String(details.possessionStatus).toUpperCase();
  } else if (details.possessionDate) {
    possession = `POSSESSION ${String(details.possessionDate).toUpperCase()}`;
  } else if (project.status === 'READY') {
    possession = 'READY TO MOVE';
  }

  // Contact info
  const phone = project.ownerContacts?.[0]?.phone?.trim();
  const website = (details.website as string)?.trim() || (organization?.settings as any)?.website || '';
  const salesLabel = project.ownerContacts?.[0]?.name ? `${project.ownerContacts[0].name}` : 'Sales Office';

  // Organization name for footer (never "AI Real Estate CRM Demo")
  let orgName = organization?.name || 'REAL ESTATE DEVELOPERS';
  if (orgName.includes('AI Real Estate CRM Demo') || orgName.includes('Demo')) {
    orgName = project.name ? `${project.name} GROUP` : 'PREMIUM DEVELOPERS';
  }

  // Brand primary color (use brand primary if custom, else fallback teal #0D9488)
  let brandPrimaryColor = '#0D9488';
  if (brand?.primaryColor && brand.primaryColor !== '#000000' && /^#[0-9A-Fa-f]{6}$/.test(brand.primaryColor)) {
    brandPrimaryColor = brand.primaryColor;
  }

  return {
    category,
    projectName: project.name || 'Luxury Residences',
    city,
    state,
    unitType,
    propertyType,
    areaSqFt,
    priceDisplay,
    priceNote,
    hasPrice,
    bedrooms,
    possession,
    phone,
    website,
    salesLabel,
    reraNumber: project.reraNumber?.trim(),
    isAllActualPhotos,
    orgName,
    brandPrimaryColor,
    stylePreset,
  };
}

/**
 * Loads a media asset as a Buffer
 */
export async function loadAssetBuffer(asset: IMediaAsset): Promise<Buffer> {
  if (asset.storageKey) {
    try {
      const localPath = defaultStorage.getAbsolutePath(asset.storageKey);
      if (fsSync.existsSync(localPath)) {
        return await fs.readFile(localPath);
      }
    } catch {
      // Fall through
    }
  }

  if (asset.url && asset.url.startsWith('http')) {
    try {
      const resp = await fetch(asset.url, { signal: AbortSignal.timeout(8000) });
      if (resp.ok) {
        const arrayBuf = await resp.arrayBuffer();
        return Buffer.from(arrayBuf);
      }
    } catch {
      // Fall through
    }
  }

  // Fallback architectural gradient canvas
  return sharp({
    create: {
      width: 1080,
      height: 1080,
      channels: 4,
      background: { r: 19, g: 78, b: 74, alpha: 1 },
    },
  })
    .png()
    .toBuffer();
}

/**
 * Creates rounded mask buffer for sharp compositing
 */
function createRoundedMask(width: number, height: number, rx = 16): Buffer {
  return Buffer.from(`
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="${width}" height="${height}" rx="${rx}" ry="${rx}" fill="#000000"/>
    </svg>
  `);
}

/**
 * Wraps title text into 1 or 2 lines cleanly without overflow, reducing font size as needed
 */
function wrapTitle(title: string, maxCharsPerLine = 24): { lines: string[]; fontSize: number } {
  const cleanTitle = title.replace(/\s+/g, ' ').trim();
  if (cleanTitle.length <= maxCharsPerLine) {
    return { lines: [cleanTitle], fontSize: 40 };
  }

  const words = cleanTitle.split(' ');
  const line1: string[] = [];
  const line2: string[] = [];
  let currentLen = 0;

  for (const word of words) {
    if (currentLen + word.length <= maxCharsPerLine || line1.length === 0) {
      line1.push(word);
      currentLen += word.length + 1;
    } else {
      line2.push(word);
    }
  }

  let l2 = line2.join(' ');
  if (l2.length > maxCharsPerLine + 6) {
    l2 = l2.slice(0, maxCharsPerLine + 3) + '...';
  }

  const l1 = line1.join(' ');
  const maxLineLen = Math.max(l1.length, l2.length);
  const fontSize = Math.max(22, Math.min(36, Math.floor(750 / maxLineLen)));
  return { lines: [l1, l2], fontSize };
}

/**
 * Generates the background SVG based on style preset
 * - HERITAGE_LUXURY (GDPL Mohali style): Elegant warm ivory/slate gradient with gold frame
 * - HIGH_GROWTH_ROI (ACE INFRA style): Sleek deep midnight slate with electric cyan glow and frame
 */
export function buildShowcaseBackgroundSvg(
  width: number,
  height: number,
  outerPadding: number,
  stylePreset: 'HERITAGE_LUXURY' | 'HIGH_GROWTH_ROI' = 'HERITAGE_LUXURY'
): string {
  if (stylePreset === 'HIGH_GROWTH_ROI') {
    return `
      <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="bgGradRoi" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="#070B14"/>
            <stop offset="50%" stop-color="#0B1325"/>
            <stop offset="100%" stop-color="#030712"/>
          </linearGradient>
          <radialGradient id="cyanGlow" cx="50%" cy="100%" r="65%">
            <stop offset="0%" stop-color="#06B6D4" stop-opacity="0.18"/>
            <stop offset="100%" stop-color="#06B6D4" stop-opacity="0"/>
          </radialGradient>
        </defs>
        <rect width="${width}" height="${height}" fill="url(#bgGradRoi)"/>
        <rect width="${width}" height="${height}" fill="url(#cyanGlow)"/>
        <rect x="${outerPadding}" y="${outerPadding}" width="${width - outerPadding * 2}" height="${height - outerPadding * 2}" rx="20" fill="none" stroke="#06B6D4" stroke-opacity="0.35" stroke-width="1.5"/>
      </svg>
    `;
  }

  // Default: HERITAGE_LUXURY (GDPL Mohali Style)
  return `
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bgGradLuxury" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#FAF8F5"/>
          <stop offset="50%" stop-color="#F8FAFC"/>
          <stop offset="100%" stop-color="#F1F5F9"/>
        </linearGradient>
      </defs>
      <rect width="${width}" height="${height}" fill="url(#bgGradLuxury)"/>
      <rect x="${outerPadding}" y="${outerPadding}" width="${width - outerPadding * 2}" height="${height - outerPadding * 2}" rx="20" fill="none" stroke="#D97706" stroke-opacity="0.3" stroke-width="1.5"/>
    </svg>
  `;
}

/**
 * Generates the vector foreground SVG overlay for the Showcase template (transparent canvas)
 */
export function buildShowcaseForegroundSvg(params: {
  width: number;
  height: number;
  ratio: '1:1' | '4:5' | '9:16';
  data: ShowcasePosterData;
  heroTag: string;
  thumbTags: string[];
  heroBox: { x: number; y: number; w: number; h: number };
  thumbBoxes: Array<{ x: number; y: number; w: number; h: number }>;
}): string {
  const { width, height, ratio, data, heroTag, thumbTags, heroBox, thumbBoxes } = params;
  const isRoiMode = data.stylePreset === 'HIGH_GROWTH_ROI';

  const escapeXml = (s?: string) =>
    (s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

  // Style Tokens based on preset
  const brandPrimary = isRoiMode ? '#06B6D4' : (data.brandPrimaryColor && data.brandPrimaryColor !== '#0D9488' ? data.brandPrimaryColor : '#D97706');
  const accentGold = '#D97706';
  const electricCyan = '#06B6D4';

  const pillBorder = isRoiMode ? '#06B6D4' : '#D97706';
  const pillBg = isRoiMode ? '#08172E' : '#FFFFFF';
  const pillDot = isRoiMode ? '#22D3EE' : '#D97706';
  const pillText = isRoiMode ? '#38BDF8' : '#B45309';

  const titleColor = isRoiMode ? '#FFFFFF' : '#0F172A';
  const underlineColor = isRoiMode ? '#06B6D4' : '#D97706';
  const subtitleColor = isRoiMode ? '#94A3B8' : '#64748B';
  const bracketLinesColor = isRoiMode ? '#083344' : '#FDE68A';

  const chipBg = isRoiMode ? '#04172B' : '#0F172A';
  const chipDot = isRoiMode ? '#06B6D4' : '#F59E0B';

  const cardBg = isRoiMode ? '#0B1325' : '#FFFFFF';
  const cardBorder = isRoiMode ? '#1E293B' : '#F1F5F9';
  const cardShadowOpacity = isRoiMode ? '0.35' : '0.07';
  const cardShadowColor = isRoiMode ? '#000000' : '#0F172A';

  const priceColor = isRoiMode ? '#F59E0B' : '#0F172A';
  const priceLabelColor = isRoiMode ? '#38BDF8' : '#64748B';

  const infoChipBg = isRoiMode ? '#082542' : '#FFFBEB';
  const infoChipBorder = isRoiMode ? '#0284C7' : '#FDE68A';
  const infoChipText = isRoiMode ? '#38BDF8' : '#B45309';

  const cta1Bg = isRoiMode ? '#082542' : '#FFFBEB';
  const cta1Border = isRoiMode ? '#06B6D4' : '#D97706';
  const cta1Text = isRoiMode ? '#38BDF8' : '#B45309';

  const cta2Bg = isRoiMode ? '#06B6D4' : '#0F172A';
  const cta2Text = isRoiMode ? '#021827' : '#FFFFFF';

  const contactTextColor = isRoiMode ? '#F1F5F9' : '#0F172A';
  const legalTextColor = isRoiMode ? '#64748B' : '#94A3B8';
  const footerTextColor = isRoiMode ? '#475569' : '#64748B';

  const outerPadding = ratio === '1:1' ? 20 : 24;
  const contentW = width - 96;
  const cx = width / 2;

  // 1. Header Geometry
  const headerStartY = ratio === '9:16' ? 175 : ratio === '1:1' ? 36 : 48;
  const catPillY = headerStartY;
  const catPillW = Math.max(140, data.category.length * 10 + 44);

  const { lines: titleLines, fontSize: titleFontSize } = wrapTitle(data.projectName, ratio === '1:1' ? 22 : 26);
  const titleLineHeight = titleFontSize + 6;
  const titleStartY = catPillY + 28 + (titleLines.length === 1 ? 30 : 22);

  const titleBottomY = titleStartY + (titleLines.length - 1) * titleLineHeight;
  const underlineY = titleBottomY + 10;
  const subtitleY = underlineY + 24;

  // Subtitle line construction
  const locPart = [data.city, data.state].filter(Boolean).join(', ');
  const unitPart = [data.unitType, data.propertyType].filter(Boolean).join(' ');
  const areaPart = data.areaSqFt ? `${Number(data.areaSqFt).toLocaleString('en-IN')} Sq. Ft.` : '';
  const subtitleText = [locPart, unitPart, areaPart].filter(Boolean).join(' • ');

  // 2. Info Card Geometry
  const cardX = 48;
  const cardW = contentW;
  const hasThumbs = thumbBoxes.length > 0;
  const lastImgBox = hasThumbs ? thumbBoxes[thumbBoxes.length - 1] : heroBox;
  const cardY = lastImgBox.y + lastImgBox.h + (ratio === '1:1' ? 12 : 14);

  const footerY = height - (ratio === '1:1' ? 24 : outerPadding) - 10;
  const maxCardH = footerY - cardY - 20;
  const cardH = ratio === '1:1' ? Math.min(380, maxCardH) : Math.min(380, maxCardH);

  // Chips assembly for right side of card
  const chips: string[] = [];
  if (data.bedrooms) chips.push(data.bedrooms);
  if (areaPart) chips.push(areaPart.toUpperCase());
  if (data.possession) chips.push(data.possession);

  // Legal Line assembly
  const legalParts: string[] = [];
  if (data.reraNumber) {
    legalParts.push(`RERA Registered (RERA No. ${escapeXml(data.reraNumber)})`);
  }
  if (data.isAllActualPhotos) {
    legalParts.push('Verified Authentic On-Site Photography');
  }
  legalParts.push('Subject to availability');
  const legalLine = legalParts.join(' • ');

  // Contact line assembly
  const contactParts: string[] = [];
  if (data.salesLabel) contactParts.push(data.salesLabel);
  if (data.phone) contactParts.push(data.phone);
  if (data.website) contactParts.push(data.website);
  const contactLine = contactParts.join(' • ');

  // Inside Card coordinates
  const cardInnerTop = cardY + 22;
  const dividerY = cardY + (ratio === '1:1' ? 76 : 84);
  const ctaRowY = dividerY + (ratio === '1:1' ? 14 : 18);
  const ctaButtonH = ratio === '1:1' ? 40 : 44;
  const contactY = ctaRowY + ctaButtonH + (ratio === '1:1' ? 24 : 26);
  const legalTextY = contactY + (ratio === '1:1' ? 20 : 22);

  // Chip measurement to avoid overlaps
  const chipItems = chips.slice(0, 3).map((text) => ({
    text,
    w: Math.max(86, text.length * 8.5 + 24),
    h: 28,
  }));

  const totalChipsW = chipItems.reduce((acc, c) => acc + c.w, 0) + Math.max(0, chipItems.length - 1) * 8;
  const chipsStartX = data.hasPrice ? cardX + cardW - 32 - totalChipsW : cardX + 32;

  let currentChipX = chipsStartX;
  const chipSvgElements: string[] = [];
  for (const chip of chipItems) {
    chipSvgElements.push(`
      <g transform="translate(${currentChipX}, ${cardInnerTop + 10})">
        <rect x="0" y="0" width="${chip.w}" height="${chip.h}" rx="6" fill="${infoChipBg}" stroke="${infoChipBorder}" stroke-width="1"/>
        <text x="${chip.w / 2}" y="18.5" font-family="Inter, -apple-system, sans-serif" font-size="11" font-weight="700" fill="${infoChipText}" text-anchor="middle" letter-spacing="0.8">${escapeXml(chip.text)}</text>
      </g>
    `);
    currentChipX += chip.w + 8;
  }

  return `
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <!-- Card Drop Shadow -->
        <filter id="cardShadow" x="-5%" y="-5%" width="110%" height="120%">
          <feDropShadow dx="0" dy="6" stdDeviation="16" flood-color="${cardShadowColor}" flood-opacity="${cardShadowOpacity}"/>
        </filter>
      </defs>

      <!-- ================= HEADER SECTION ================= -->
      <!-- Decorative Vertical End-Lines -->
      <line x1="48" y1="${catPillY + 4}" x2="48" y2="${subtitleY + 4}" stroke="${bracketLinesColor}" stroke-width="2" stroke-linecap="round"/>
      <line x1="${width - 48}" y1="${catPillY + 4}" x2="${width - 48}" y2="${subtitleY + 4}" stroke="${bracketLinesColor}" stroke-width="2" stroke-linecap="round"/>

      <!-- Outlined Category Pill -->
      <g transform="translate(${cx}, ${catPillY})">
        <rect x="-${catPillW / 2}" y="0" width="${catPillW}" height="26" rx="13" fill="${pillBg}" stroke="${pillBorder}" stroke-width="1.2"/>
        <circle cx="-${catPillW / 2 - 14}" cy="13" r="3.2" fill="${pillDot}"/>
        <text x="6" y="17.5" font-family="Inter, -apple-system, sans-serif" font-size="11" font-weight="700" fill="${pillText}" text-anchor="middle" letter-spacing="1.5">${escapeXml(data.category)}</text>
      </g>

      <!-- Project Title -->
      ${titleLines
        .map(
          (line, idx) =>
            `<text x="${cx}" y="${titleStartY + idx * titleLineHeight}" font-family="Inter, -apple-system, sans-serif" font-size="${titleFontSize}" font-weight="800" fill="${titleColor}" text-anchor="middle">${escapeXml(line)}</text>`
        )
        .join('')}

      <!-- Short Underline Bar -->
      <rect x="${cx - 24}" y="${underlineY}" width="48" height="3.5" rx="1.75" fill="${underlineColor}"/>

      <!-- Subtitle -->
      ${
        subtitleText
          ? `<text x="${cx}" y="${subtitleY}" font-family="Inter, -apple-system, sans-serif" font-size="${ratio === '1:1' ? 13.5 : 15}" font-weight="500" fill="${subtitleColor}" text-anchor="middle">${escapeXml(subtitleText)}</text>`
          : ''
      }

      <!-- ================= PHOTO LABEL CHIPS ================= -->
      <!-- Hero Chip -->
      <g transform="translate(${heroBox.x + 16}, ${heroBox.y + heroBox.h - (ratio === '1:1' ? 36 : 42)})">
        <rect x="0" y="0" width="${Math.max(110, heroTag.length * 8.5 + 36)}" height="28" rx="6" fill="${chipBg}" opacity="0.94"/>
        <circle cx="14" cy="14" r="3" fill="${chipDot}"/>
        <text x="25" y="18.5" font-family="Inter, -apple-system, sans-serif" font-size="11.5" font-weight="700" fill="#FFFFFF" letter-spacing="1">${escapeXml(heroTag)}</text>
      </g>

      <!-- Thumbnail Chips -->
      ${thumbBoxes
        .map((tBox, idx) => {
          const tag = thumbTags[idx] || 'INTERIOR';
          const chipW = Math.max(86, tag.length * 7.5 + 28);
          return `
            <g transform="translate(${tBox.x + 10}, ${tBox.y + tBox.h - 32})">
              <rect x="0" y="0" width="${chipW}" height="22" rx="5" fill="${chipBg}" opacity="0.94"/>
              <circle cx="10" cy="11" r="2.5" fill="${chipDot}"/>
              <text x="18" y="15" font-family="Inter, -apple-system, sans-serif" font-size="9.5" font-weight="700" fill="#FFFFFF" letter-spacing="0.8">${escapeXml(tag)}</text>
            </g>
          `;
        })
        .join('')}

      <!-- ================= INFO CARD ================= -->
      <g>
        <rect x="${cardX}" y="${cardY}" width="${cardW}" height="${cardH}" rx="16" fill="${cardBg}" filter="url(#cardShadow)"/>
        <rect x="${cardX}" y="${cardY}" width="${cardW}" height="${cardH}" rx="16" fill="none" stroke="${cardBorder}" stroke-width="1.2"/>

        <!-- Left: Investment / Price Block (only if price exists) -->
        ${
          data.hasPrice
            ? `
              <g transform="translate(${cardX + 32}, ${cardInnerTop})">
                <text x="0" y="12" font-family="Inter, -apple-system, sans-serif" font-size="11" font-weight="700" fill="${priceLabelColor}" letter-spacing="1.5">INVESTMENT</text>
                <text x="0" y="44" font-family="Inter, -apple-system, sans-serif" font-size="${ratio === '1:1' ? 28 : 34}" font-weight="800" fill="${priceColor}">${escapeXml(data.priceDisplay)}</text>
                ${
                  data.priceNote
                    ? `<text x="${(data.priceDisplay || '').length * (ratio === '1:1' ? 16 : 19) + 12}" y="40" font-family="Inter, -apple-system, sans-serif" font-size="13" font-weight="500" fill="${subtitleColor}">${escapeXml(data.priceNote)}</text>`
                    : ''
                }
              </g>
            `
            : ''
        }

        <!-- Right: Info Chips Row -->
        <g>
          ${chipSvgElements.join('')}
        </g>

        <!-- Card Divider -->
        <line x1="${cardX + 28}" y1="${dividerY}" x2="${cardX + cardW - 28}" y2="${dividerY}" stroke="${cardBorder}" stroke-width="1.5"/>

        <!-- Two CTA Buttons Side by Side (Visual Only) -->
        <g transform="translate(${cx}, ${ctaRowY})">
          <!-- Button 1: Outlined Request Details -->
          <g transform="translate(-214, 0)">
            <rect x="0" y="0" width="206" height="${ctaButtonH}" rx="22" fill="${cta1Bg}" stroke="${cta1Border}" stroke-width="1.5"/>
            <text x="103" y="${ratio === '1:1' ? 25 : 27}" font-family="Inter, -apple-system, sans-serif" font-size="13.5" font-weight="700" fill="${cta1Text}" text-anchor="middle">Request Details</text>
          </g>

          <!-- Button 2: Filled Book a Visit -->
          <g transform="translate(8, 0)">
            <rect x="0" y="0" width="206" height="${ctaButtonH}" rx="22" fill="${cta2Bg}"/>
            <text x="103" y="${ratio === '1:1' ? 25 : 27}" font-family="Inter, -apple-system, sans-serif" font-size="13.5" font-weight="700" fill="${cta2Text}" text-anchor="middle">Book a Visit →</text>
          </g>
        </g>

        <!-- Contact Line (Centered) -->
        ${
          contactLine
            ? `<text x="${cx}" y="${contactY}" font-family="Inter, -apple-system, sans-serif" font-size="${ratio === '1:1' ? 12 : 13.5}" font-weight="600" fill="${contactTextColor}" text-anchor="middle">${escapeXml(contactLine)}</text>`
            : ''
        }

        <!-- Legal Line (Centered, Muted) -->
        <text x="${cx}" y="${legalTextY}" font-family="Inter, -apple-system, sans-serif" font-size="${ratio === '1:1' ? 9.5 : 10.5}" font-weight="400" fill="${legalTextColor}" text-anchor="middle">${escapeXml(legalLine)}</text>
      </g>

      <!-- ================= FOOTER SECTION ================= -->
      <text x="${cx}" y="${footerY}" font-family="Inter, -apple-system, sans-serif" font-size="12" font-weight="700" fill="${footerTextColor}" text-anchor="middle" letter-spacing="2">${escapeXml(data.orgName)}</text>
    </svg>
  `;
}

/**
 * Calculates geometry for Hero and Thumbnails based on aspect ratio and available photos
 */
export function calculatePosterGeometry(
  width: number,
  height: number,
  ratio: '1:1' | '4:5' | '9:16',
  thumbCount: number
) {
  const contentW = width - 96;
  const contentX = 48;

  // Header height offset
  const headerHeight = ratio === '9:16' ? 350 : ratio === '1:1' ? 175 : 240;
  const heroY = headerHeight;

  let heroHeight: number;
  let thumbHeight: number;

  if (ratio === '1:1') {
    heroHeight = thumbCount > 0 ? 320 : 450;
    thumbHeight = 115;
  } else if (ratio === '9:16') {
    heroHeight = thumbCount > 0 ? 670 : 880;
    thumbHeight = 200;
  } else {
    // 4:5 Master layout (~38% of 1350 is 513)
    heroHeight = thumbCount > 0 ? 490 : 620;
    thumbHeight = 150;
  }

  const heroBox = {
    x: contentX,
    y: heroY,
    w: contentW,
    h: heroHeight,
  };

  const thumbBoxes: Array<{ x: number; y: number; w: number; h: number }> = [];
  if (thumbCount > 0) {
    const thumbY = heroY + heroHeight + 12;
    const gap = 12;

    if (thumbCount === 3) {
      const thumbW = Math.floor((contentW - gap * 2) / 3);
      thumbBoxes.push(
        { x: contentX, y: thumbY, w: thumbW, h: thumbHeight },
        { x: contentX + thumbW + gap, y: thumbY, w: thumbW, h: thumbHeight },
        { x: contentX + (thumbW + gap) * 2, y: thumbY, w: thumbW, h: thumbHeight }
      );
    } else if (thumbCount === 2) {
      const thumbW = Math.floor((contentW - gap) / 2);
      thumbBoxes.push(
        { x: contentX, y: thumbY, w: thumbW, h: thumbHeight },
        { x: contentX + thumbW + gap, y: thumbY, w: thumbW, h: thumbHeight }
      );
    } else {
      // 1 thumb stretched to full width
      thumbBoxes.push({ x: contentX, y: thumbY, w: contentW, h: thumbHeight });
    }
  }

  return { heroBox, thumbBoxes };
}

/**
 * Synthesizes the complete Showcase poster for a given aspect ratio
 */
export async function renderShowcasePoster(params: {
  ratio: '1:1' | '4:5' | '9:16';
  width: number;
  height: number;
  data: ShowcasePosterData;
  selectedPhotos: SelectedPosterPhotos;
}): Promise<{ pngBuffer: Buffer; jpegBuffer: Buffer }> {
  const { ratio, width, height, data, selectedPhotos } = params;

  const outerPadding = ratio === '1:1' ? 20 : 24;

  // 1. Calculate layout geometry
  const thumbCount = selectedPhotos.thumbs.length;
  const { heroBox, thumbBoxes } = calculatePosterGeometry(width, height, ratio, thumbCount);

  // 2. Load and crop Hero photo with rounded corners
  const heroBufferRaw = await loadAssetBuffer(selectedPhotos.hero.asset);
  const heroRounded = await sharp(heroBufferRaw)
    .resize(heroBox.w, heroBox.h, { fit: 'cover', position: 'center' })
    .composite([
      {
        input: createRoundedMask(heroBox.w, heroBox.h, 16),
        blend: 'dest-in',
      },
    ])
    .png()
    .toBuffer();

  // 3. Load and crop Thumbnail photos with rounded corners
  const thumbLayers: Array<{ input: Buffer; top: number; left: number }> = [];
  for (let i = 0; i < selectedPhotos.thumbs.length; i++) {
    const tBox = thumbBoxes[i];
    const tAsset = selectedPhotos.thumbs[i].asset;
    const tBufRaw = await loadAssetBuffer(tAsset);
    const tRounded = await sharp(tBufRaw)
      .resize(tBox.w, tBox.h, { fit: 'cover', position: 'center' })
      .composite([
        {
          input: createRoundedMask(tBox.w, tBox.h, 12),
          blend: 'dest-in',
        },
      ])
      .png()
      .toBuffer();

    thumbLayers.push({
      input: tRounded,
      top: tBox.y,
      left: tBox.x,
    });
  }

  // 4. Generate Background SVG and Foreground SVG
  const bgSvg = buildShowcaseBackgroundSvg(width, height, outerPadding, data.stylePreset);
  const fgSvg = buildShowcaseForegroundSvg({
    width,
    height,
    ratio,
    data,
    heroTag: selectedPhotos.hero.tag,
    thumbTags: selectedPhotos.thumbs.map((t) => t.tag),
    heroBox,
    thumbBoxes,
  });

  // 5. Composite background, photos, and foreground in single sharp pipeline
  const baseCanvas = await sharp(Buffer.from(bgSvg)).png().toBuffer();

  const compositeLayers = [
    { input: heroRounded, top: heroBox.y, left: heroBox.x },
    ...thumbLayers,
    { input: Buffer.from(fgSvg), top: 0, left: 0 },
  ];

  const finalPng = await sharp(baseCanvas)
    .composite(compositeLayers)
    .png({ quality: 90 })
    .toBuffer();

  const jpegBuffer = await sharp(finalPng).jpeg({ quality: 85 }).toBuffer();

  return { pngBuffer: finalPng, jpegBuffer };
}
