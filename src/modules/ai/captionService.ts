import { getAIProvider } from './providers/index.js';
import { logger } from '../../config/logger.js';

export interface GenerateCaptionsParams {
  projectName: string;
  category?: string;
  subtype?: string;
  city?: string;
  state?: string;
  sectorOrLocation?: string;
  bhk?: string;
  areaSqFt?: number | string;
  priceDisplay?: string;
  amenities?: string[];
  reraNumber?: string;
  salesPhone?: string;
  salesOfficeName?: string;
  stylePreset?: 'HERITAGE_LUXURY' | 'HIGH_GROWTH_ROI';
}

export interface CaptionVariant {
  title: string;
  style: 'HERITAGE_LUXURY' | 'HIGH_GROWTH_ROI' | 'SHORT_REEL';
  hook: string;
  body: string;
  cta: string;
  legalAndHashtags: string;
  fullCopy: string;
}

export interface CaptionGenerationResult {
  projectName: string;
  variants: CaptionVariant[];
}

export class CaptionService {
  /**
   * Generates 3 platform-ready caption variants using the 5-Step winning real estate formula
   */
  public async generateCaptions(params: GenerateCaptionsParams): Promise<CaptionGenerationResult> {
    const {
      projectName,
      category = 'Residential',
      subtype = 'Apartment',
      city = 'Mohali',
      state = 'Punjab',
      sectorOrLocation = 'Sector 66 / Airport Road',
      bhk = '3 & 4 BHK',
      areaSqFt = '1850 - 2450',
      priceDisplay = '₹ 1.25 Cr Onwards',
      amenities = ['Exclusive Clubhouse', 'Infinity Swimming Pool', '24/7 Multi-Tier Security', '100% Power Backup'],
      reraNumber = '',
      salesPhone = '+91 77103-80077',
      salesOfficeName = 'Experience Centre',
      stylePreset = 'HERITAGE_LUXURY',
    } = params;

    const provider = getAIProvider();

    // If Gemini provider is active and configured, we can ask Gemini
    if (provider.name === 'gemini' && provider.isConfigured()) {
      try {
        const prompt = `You are a premier real estate copywriter in Punjab / Chandigarh Tricity. Write 3 distinct social media ad captions for Facebook & Instagram for this property:
Project: ${projectName} (${category} ${subtype})
Location: ${sectorOrLocation}, ${city}, ${state}
Specs: ${bhk}, ${areaSqFt} Sq.Ft.
Price: ${priceDisplay}
Amenities: ${amenities.slice(0, 5).join(', ')}
RERA: ${reraNumber || 'RERA Approved'}
Contact: ${salesPhone} (${salesOfficeName})

Strict 5-Step Formula for each:
1. Emotional Hook
2. Location & Connectivity
3. Configuration & Space Facts
4. Direct Urgency CTA
5. Punjab RERA Compliance & Localized Hashtags (#MohaliRealEstate, #${projectName.replace(/\s+/g, '')}, #ChandigarhProperty, etc.)

Variant 1: Heritage Luxury (Aspirational family comfort, calm elegance, GDPL style)
Variant 2: High-Growth Investment (High ROI corridor, Airport Road connectivity, ACE Infra style)
Variant 3: Short & Punchy Reel Caption (Fast-reading, 3-second hook for Instagram Reels)

Output strict JSON:
{
  "variants": [
    {
      "title": "Heritage Luxury Story",
      "style": "HERITAGE_LUXURY",
      "hook": "...",
      "body": "...",
      "cta": "...",
      "legalAndHashtags": "...",
      "fullCopy": "..."
    },
    {
      "title": "High-Growth Investment Focus",
      "style": "HIGH_GROWTH_ROI",
      "hook": "...",
      "body": "...",
      "cta": "...",
      "legalAndHashtags": "...",
      "fullCopy": "..."
    },
    {
      "title": "Short Reel Caption",
      "style": "SHORT_REEL",
      "hook": "...",
      "body": "...",
      "cta": "...",
      "legalAndHashtags": "...",
      "fullCopy": "..."
    }
  ]
}`;

        const raw = typeof (provider as any).generateText === 'function' ? await (provider as any).generateText(prompt) : '';
        const jsonMatch = raw ? raw.match(/\{[\s\S]*\}/) : null;
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          if (Array.isArray(parsed.variants) && parsed.variants.length > 0) {
            return {
              projectName,
              variants: parsed.variants,
            };
          }
        }
      } catch (err) {
        logger.warn({ err }, 'Gemini caption generation fell back to high-performing agency templates');
      }
    }

    // High-performing deterministic agency templates based on GDPL & ACE INFRA analysis
    const amenityBullets = amenities.slice(0, 4).map((a) => `✨ ${a}`).join('\n');
    const reraLine = reraNumber ? `🏛️ Punjab RERA Reg. No: ${reraNumber}` : '🏛️ Punjab RERA Approved Project';
    const tagBase = `#${projectName.replace(/[^a-zA-Z0-9]/g, '')}`;

    // Variant 1: Heritage Luxury (GDPL Mohali style)
    const luxuryHook = `👑 When luxury meets address: Welcome to ${projectName}.`;
    const luxuryBody = `Nestled in the prestigious enclave of ${sectorOrLocation}, ${city}, this signature development redefines royal comfort for families who accept nothing less than the best.

🏡 Living Experience:
• Configurations: ${bhk} Ultra-Luxury Residences
• Expansive Spaces: ${areaSqFt} Sq.Ft. Carpet & Super Area
• Thoughtfully planned floor-to-ceiling ventilation & panoramic private balconies
• Investment: ${priceDisplay}

World-Class Amenities at Your Doorstep:
${amenityBullets}`;
    const luxuryCta = `📞 Schedule your private walkthrough today:
Contact: ${salesPhone} | ${salesOfficeName}
Direct WhatsApp: Send "VISIT" to ${salesPhone}`;
    const luxuryLegal = `${reraLine}
*Terms & conditions apply. Subject to availability.

${tagBase} #GDPLMohali #LuxuryLivingMohali #MohaliRealEstate #ChandigarhHomes #PunjabRealEstate #LuxurySkyVillas`;

    const variant1: CaptionVariant = {
      title: 'Heritage Luxury Signature (GDPL Style)',
      style: 'HERITAGE_LUXURY',
      hook: luxuryHook,
      body: luxuryBody,
      cta: luxuryCta,
      legalAndHashtags: luxuryLegal,
      fullCopy: `${luxuryHook}\n\n${luxuryBody}\n\n${luxuryCta}\n\n${luxuryLegal}`,
    };

    // Variant 2: High-Growth Investment (ACE INFRA style)
    const roiHook = `🚀 HIGH ROI CORRIDOR: ${projectName} on Airport Road / ${sectorOrLocation}!`;
    const roiBody = `Looking for solid capital appreciation and assured rental yield in Tricity's fastest-growing corridor?

📍 Strategic Location Advantage:
• Prime frontage with seamless connectivity to Chandigarh International Airport
• Rapid infrastructure velocity & high commercial footfall
• Premium ${category.toUpperCase()} opportunity: ${bhk} (${areaSqFt} Sq.Ft.)
• Attractive pricing starting at ${priceDisplay}

Key Project Highlights:
${amenityBullets}`;
    const roiCta = `🔥 High demand inventory with limited release units.
👉 Claim early investor benefits now:
Call Investment Desk: ${salesPhone}
Visit: ${salesOfficeName}`;
    const roiLegal = `${reraLine}
*Assured returns & appreciation subject to market conditions.

${tagBase} #ACEInfra #AirportRoadMohali #PR7Mohali #HighYieldInvestment #CommercialMohali #TricityRealEstate`;

    const variant2: CaptionVariant = {
      title: 'High-Growth ROI & Connectivity (ACE Infra Style)',
      style: 'HIGH_GROWTH_ROI',
      hook: roiHook,
      body: roiBody,
      cta: roiCta,
      legalAndHashtags: roiLegal,
      fullCopy: `${roiHook}\n\n${roiBody}\n\n${roiCta}\n\n${roiLegal}`,
    };

    // Variant 3: Short & Punchy Reel Caption
    const reelHook = `Looking for the perfect home in ${city}? Check this out! 👇`;
    const reelBody = `📍 ${projectName} - ${sectorOrLocation}
✨ ${bhk} | ${areaSqFt} Sq.Ft.
💰 ${priceDisplay}
${amenityBullets}`;
    const reelCta = `📲 DM "DETAILS" or Call ${salesPhone} to book your on-site experience!`;
    const reelLegal = `${reraLine}
${tagBase} #ReelsRealEstate #MohaliProperty #ChandigarhLuxuryHomes #DreamHome`;

    const variant3: CaptionVariant = {
      title: 'Short & Punchy Reel Copy',
      style: 'SHORT_REEL',
      hook: reelHook,
      body: reelBody,
      cta: reelCta,
      legalAndHashtags: reelLegal,
      fullCopy: `${reelHook}\n\n${reelBody}\n\n${reelCta}\n\n${reelLegal}`,
    };

    return {
      projectName,
      variants: [variant1, variant2, variant3],
    };
  }
}

export const captionService = new CaptionService();
