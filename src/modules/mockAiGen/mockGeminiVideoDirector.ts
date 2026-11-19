import fsPromises from 'fs/promises';
import path from 'path';
import { GoogleGenAI } from '@google/genai';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';

export interface GeminiSceneAnalysis {
  assetId: string;
  originalName: string;
  predictedCategory: string;
  subCategory?: string;
  classification: 'ACTUAL' | 'ILLUSTRATIVE';
  confidence: number;
  presenterDetected: boolean;
  presenterDescription?: string;
  architecturalDetails: string[];
  cameraMotion: 'static' | 'pan_horizontal' | 'tilt_vertical' | 'push_in' | 'pull_out' | 'handheld_walkthrough';
  lightingQuality: 'bright_natural' | 'warm_interior' | 'harsh' | 'dim_underexposed' | 'poor_low_light';
  reviewFlag: 'APPROVED' | 'NEEDS_REVIEW' | 'REJECT_LOW_QUALITY';
  reviewReason?: string;
  highlightSegments: Array<{
    start: number;
    end: number;
    duration: number;
    score: number;
    description: string;
  }>;
  summary: string;
  tokensUsed: { input: number; output: number; total: number };
  estimatedCostUsd: number;
}

export class MockGeminiVideoDirector {
  private client: GoogleGenAI | null = null;
  private cumulativeSpendUsd = 0;

  constructor() {
    if (env.GEMINI_API_KEY && env.GEMINI_API_KEY.trim().length > 0) {
      this.client = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
    }
  }

  public getCumulativeSpendUsd(): number {
    return this.cumulativeSpendUsd;
  }

  /**
   * Analyzes an aspect-ratio-preserved video proxy with Gemini multimodal video understanding.
   */
  public async analyzeVideoClip(
    proxyPath: string,
    assetId: string,
    originalName: string,
    durationSeconds: number
  ): Promise<GeminiSceneAnalysis> {
    if (!this.client) {
      throw new Error('Gemini API client is not configured. Please check GEMINI_API_KEY in environment.');
    }

    // Budget Cap Enforcement
    const budgetCap = env.AI_DIRECTOR_BUDGET_CAP_USD || 2.0;
    if (this.cumulativeSpendUsd >= budgetCap) {
      throw new Error(`Budget cap exceeded! Cumulative spend ($${this.cumulativeSpendUsd.toFixed(4)}) >= Cap ($${budgetCap.toFixed(2)})`);
    }

    const videoBuffer = await fsPromises.readFile(proxyPath);
    let model = env.GEMINI_ANALYSIS_MODEL || 'gemini-3.8-flash';
    if (model === 'gemini-2.5-flash') {
      model = 'gemini-3.8-flash';
    }

    const systemInstruction = `You are an Autonomous AI Video Director specializing in luxury and modern real estate commercial video production.
Analyze the provided property video clip strictly based on physical visual and audio evidence.
Never guess rooms from filenames or slot positions.

You must categorize the footage into one of:
- "exterior" (building facade, elevations, front gate, compound walls, outdoor architecture)
- "outdoor_presenter" (a person/agent/speaker outdoors presenting the property or visible on camera)
- "gate_signage" (entrance gate, project nameboard, community security cabin)
- "living" (living room, family lounge, main hall, chandelier area)
- "bedroom" (master bedroom, guest bedroom, vanity/dressing area, wardrobe)
- "kitchen" (modular kitchen, countertops, cabinets, appliances, pantry)
- "bathroom" (powder room, master bath, vanity sink, marble shower)
- "balcony_terrace" (balcony, terrace deck, open sky lounge)
- "staircase" (stairs, railings, duplex internal steps)
- "poor_quality_detail" (uninformative closeups, out-of-focus walls, underexposed darkness, discarded materials)

Classification rules:
- ACTUAL: Authentic property visuals representing usable architectural spaces.
- ILLUSTRATIVE: Obscured, abstract, construction mess, or non-usable shots.

Review Flag:
- APPROVED: Steady, well-lit, architectural shot ready for ad composition.
- NEEDS_REVIEW: Marginally usable, poor lighting, or requires human check.
- REJECT_LOW_QUALITY: Blurry, underexposed, uninformative closeup of door handles/unfinished walls with no spatial context.`;

    const prompt = `Analyze this video clip (${durationSeconds}s duration).
Return a strict JSON object with this exact structure:
{
  "predictedCategory": "exterior | outdoor_presenter | gate_signage | living | bedroom | kitchen | bathroom | balcony_terrace | staircase | poor_quality_detail",
  "subCategory": "short specific label, e.g. 'chandelier detail' or 'facade balconies'",
  "classification": "ACTUAL" or "ILLUSTRATIVE",
  "confidence": 0.0 to 1.0,
  "presenterDetected": true or false,
  "presenterDescription": "description of person if detected",
  "architecturalDetails": ["list of key visual features observed"],
  "cameraMotion": "static | pan_horizontal | tilt_vertical | push_in | pull_out | handheld_walkthrough",
  "lightingQuality": "bright_natural | warm_interior | harsh | dim_underexposed | poor_low_light",
  "reviewFlag": "APPROVED | NEEDS_REVIEW | REJECT_LOW_QUALITY",
  "reviewReason": "reason for flag if NEEDS_REVIEW or REJECT_LOW_QUALITY",
  "highlightSegments": [
    {
      "start": 0.0,
      "end": 3.0,
      "duration": 3.0,
      "score": 8.5,
      "description": "description of the best cinematic 2-4 second segment"
    }
  ],
  "summary": "1-2 sentence concise factual description of what is physically shown"
}`;

    const response = await this.client.models.generateContent({
      model,
      contents: [
        {
          role: 'user',
          parts: [
            {
              inlineData: {
                data: videoBuffer.toString('base64'),
                mimeType: 'video/mp4',
              },
            },
            {
              text: prompt,
            },
          ],
        },
      ],
      config: {
        systemInstruction,
        responseMimeType: 'application/json',
        temperature: 0.2,
      },
    });

    const text = response.text || '{}';
    let parsed: any;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      logger.error({ text }, 'Failed to parse Gemini JSON output');
      throw new Error(`Invalid JSON from Gemini: ${text.slice(0, 100)}`);
    }

    const usage = response.usageMetadata || { promptTokenCount: 0, candidatesTokenCount: 0, totalTokenCount: 0 };
    const inputTokens = usage.promptTokenCount || 0;
    const outputTokens = usage.candidatesTokenCount || 0;
    const totalTokens = usage.totalTokenCount || (inputTokens + outputTokens);

    // Cost calculation based on official gemini-2.5-flash pricing:
    // Input: $0.15 per 1,000,000 tokens
    // Output: $0.60 per 1,000,000 tokens
    const costUsd = (inputTokens / 1_000_000) * 0.15 + (outputTokens / 1_000_000) * 0.60;
    this.cumulativeSpendUsd += costUsd;

    return {
      assetId,
      originalName,
      predictedCategory: parsed.predictedCategory || 'unknown',
      subCategory: parsed.subCategory,
      classification: parsed.classification || 'ACTUAL',
      confidence: Math.round((Number(parsed.confidence) || 0.8) * 100) / 100,
      presenterDetected: Boolean(parsed.presenterDetected),
      presenterDescription: parsed.presenterDescription,
      architecturalDetails: Array.isArray(parsed.architecturalDetails) ? parsed.architecturalDetails : [],
      cameraMotion: parsed.cameraMotion || 'static',
      lightingQuality: parsed.lightingQuality || 'bright_natural',
      reviewFlag: parsed.reviewFlag || 'APPROVED',
      reviewReason: parsed.reviewReason,
      highlightSegments: Array.isArray(parsed.highlightSegments) ? parsed.highlightSegments : [],
      summary: parsed.summary || 'Property footage',
      tokensUsed: {
        input: inputTokens,
        output: outputTokens,
        total: totalTokens,
      },
      estimatedCostUsd: Math.round(costUsd * 10000) / 10000,
    };
  }
}

export const mockGeminiVideoDirector = new MockGeminiVideoDirector();
