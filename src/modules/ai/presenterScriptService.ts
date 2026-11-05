import { getAIProvider } from './providers/index.js';
import { AppError } from '../../utils/AppError.js';
import { buildFactsBlock, NO_INVENTION_RULES } from './captionService.js';

export interface PresenterScriptAct {
  actNumber: number;
  actTitle: string;
  targetRoom: 'EXTERIOR' | 'LIVING' | 'BEDROOM' | 'KITCHEN' | 'BALCONY' | 'AMENITY';
  speech: string;
  lowerThird: {
    headline: string;
    subline: string;
  };
}

export interface PresenterScriptResult {
  headline: string;
  caption: string;
  hashtags: string[];
  fullScript: string;
  acts: PresenterScriptAct[];
  stylePreset: 'HERITAGE_LUXURY' | 'HIGH_GROWTH_ROI';
}

export interface GeneratePresenterScriptParams {
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
  language?: 'English' | 'Hindi' | 'Hinglish';
  stylePreset?: 'HERITAGE_LUXURY' | 'HIGH_GROWTH_ROI';
}

const ROOMS: PresenterScriptAct['targetRoom'][] = ['EXTERIOR', 'LIVING', 'BEDROOM', 'KITCHEN', 'BALCONY', 'AMENITY'];
const DEFAULT_ROOMS: PresenterScriptAct['targetRoom'][] = ['EXTERIOR', 'LIVING', 'BEDROOM', 'BALCONY'];

export class PresenterScriptService {
  /**
   * Generates a 4-act presenter walkthrough script with Gemini.
   * Throws a clear AI error if Gemini is unavailable; never returns a template script.
   */
  public async generateScript(params: GeneratePresenterScriptParams): Promise<PresenterScriptResult> {
    const stylePreset = params.stylePreset || 'HERITAGE_LUXURY';
    const language = params.language || 'Hinglish';
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

    const tone =
      stylePreset === 'HIGH_GROWTH_ROI'
        ? 'high energy, investment focused'
        : 'warm, aspirational, family comfort';

    const prompt = `You are an Indian real estate video director. Write a 45-second presenter walkthrough script in ${language}, tone: ${tone}.

Facts:
${facts}

${NO_INVENTION_RULES}
- Describe rooms only in general terms; don't claim specific materials or fittings that aren't listed.

Structure: 4 acts.
Act 1 EXTERIOR: hook + project name and location.
Act 2 LIVING: living area walkthrough.
Act 3 BEDROOM (or KITCHEN): private spaces.
Act 4 BALCONY (or AMENITY): closing call to action (price and phone only if listed).
Each act's lowerThird is a short on-screen title + subline built only from the facts.

Return JSON: {"headline": string, "caption": string, "hashtags": [string], "acts": [{"actNumber": 1-4, "actTitle": string, "targetRoom": "EXTERIOR"|"LIVING"|"BEDROOM"|"KITCHEN"|"BALCONY"|"AMENITY", "speech": string, "lowerThird": {"headline": string, "subline": string}}]}`;

    const parsed = await getAIProvider().generateJson<{
      headline?: unknown;
      caption?: unknown;
      hashtags?: unknown;
      acts?: Array<Partial<PresenterScriptAct>>;
    }>(prompt, { feature: 'AI presenter script' });

    const acts: PresenterScriptAct[] = (parsed.acts || [])
      .filter((a) => a && a.speech)
      .slice(0, 4)
      .map((a, i) => ({
        actNumber: i + 1,
        actTitle: a.actTitle ? String(a.actTitle) : `Act ${i + 1}`,
        targetRoom: ROOMS.includes(a.targetRoom as PresenterScriptAct['targetRoom'])
          ? (a.targetRoom as PresenterScriptAct['targetRoom'])
          : DEFAULT_ROOMS[i],
        speech: String(a.speech),
        lowerThird: {
          headline: a.lowerThird?.headline ? String(a.lowerThird.headline) : '',
          subline: a.lowerThird?.subline ? String(a.lowerThird.subline) : '',
        },
      }));

    if (acts.length < 4 || !parsed.headline || !parsed.caption) {
      throw new AppError(
        502,
        'AI_FAILED',
        'AI presenter script failed: Gemini returned an incomplete script. Please try again.'
      );
    }

    return {
      headline: String(parsed.headline),
      caption: String(parsed.caption),
      hashtags: Array.isArray(parsed.hashtags) ? parsed.hashtags.map(String) : [],
      fullScript: acts.map((a) => a.speech).join(' '),
      acts,
      stylePreset,
    };
  }
}

export const presenterScriptService = new PresenterScriptService();
