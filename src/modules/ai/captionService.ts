import { getAIProvider } from './providers/index.js';
import { AppError } from '../../utils/AppError.js';

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

const VARIANT_STYLES: CaptionVariant['style'][] = ['HERITAGE_LUXURY', 'HIGH_GROWTH_ROI', 'SHORT_REEL'];

/** Builds a "facts" block from only the values that were actually provided. */
export function buildFactsBlock(facts: Record<string, string | number | string[] | undefined | null>): string {
  return Object.entries(facts)
    .filter(([, v]) => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0))
    .map(([k, v]) => `- ${k}: ${Array.isArray(v) ? v.join(', ') : v}`)
    .join('\n');
}

export const NO_INVENTION_RULES = `Rules:
- Use ONLY the facts listed above. Never invent prices, sizes, amenities, materials, views, distances, offers, phone numbers or RERA details.
- If a fact is not listed, leave it out. Do not write placeholders like "[price]".
- Only include a RERA number if one is listed. Do not claim the project is "RERA approved" otherwise.`;

export class CaptionService {
  /**
   * Generates 3 caption variants with Gemini using the 5-step real estate formula.
   * Throws a clear AI error if Gemini is unavailable; never returns template copy.
   */
  public async generateCaptions(params: GenerateCaptionsParams): Promise<CaptionGenerationResult> {
    const facts = buildFactsBlock({
      'Project name': params.projectName,
      Category: [params.category, params.subtype].filter(Boolean).join(' ') || undefined,
      Location: [params.sectorOrLocation, params.city, params.state].filter(Boolean).join(', ') || undefined,
      Configuration: params.bhk,
      'Area (sq.ft.)': params.areaSqFt,
      Price: params.priceDisplay,
      Amenities: params.amenities,
      'RERA number': params.reraNumber,
      'Sales phone / WhatsApp': params.salesPhone,
      'Sales office': params.salesOfficeName,
    });

    const prompt = `You are a real estate social media copywriter in India. Write 3 Facebook/Instagram captions for this property.

Facts:
${facts}

${NO_INVENTION_RULES}

Each caption follows 5 steps: 1) emotional hook, 2) location, 3) configuration and space, 4) urgency + call to action (use the phone only if listed), 5) RERA line (only if listed) and hashtags based on the project name and city.

Variant 1 "HERITAGE_LUXURY": warm, family comfort, calm elegance.
Variant 2 "HIGH_GROWTH_ROI": investor focus, growth and connectivity (only from listed facts).
Variant 3 "SHORT_REEL": short and punchy for Instagram Reels.

Return JSON: {"variants": [{"title": string, "style": "HERITAGE_LUXURY"|"HIGH_GROWTH_ROI"|"SHORT_REEL", "hook": string, "body": string, "cta": string, "legalAndHashtags": string}]}`;

    const parsed = await getAIProvider().generateJson<{ variants?: Array<Partial<CaptionVariant>> }>(prompt, {
      feature: 'AI caption writing',
    });

    const variants = (parsed.variants || [])
      .filter((v) => v && v.hook && v.body)
      .map((v, i): CaptionVariant => {
        const hook = String(v.hook);
        const body = String(v.body);
        const cta = v.cta ? String(v.cta) : '';
        const legal = v.legalAndHashtags ? String(v.legalAndHashtags) : '';
        return {
          title: v.title ? String(v.title) : `Variant ${i + 1}`,
          style: VARIANT_STYLES.includes(v.style as CaptionVariant['style'])
            ? (v.style as CaptionVariant['style'])
            : VARIANT_STYLES[i % VARIANT_STYLES.length],
          hook,
          body,
          cta,
          legalAndHashtags: legal,
          fullCopy: [hook, body, cta, legal].filter(Boolean).join('\n\n'),
        };
      });

    if (variants.length === 0) {
      throw new AppError(502, 'AI_FAILED', 'AI caption writing failed: Gemini returned no usable captions. Please try again.');
    }

    return { projectName: params.projectName, variants };
  }
}

export const captionService = new CaptionService();
