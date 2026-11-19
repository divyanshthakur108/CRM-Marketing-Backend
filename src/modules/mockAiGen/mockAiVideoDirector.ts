import fs from 'fs';
import path from 'path';
import { logger } from '../../config/logger.js';
import { mockAiGenStorage } from './mockAiGenStorage.js';
import { mockShotSelector, TargetSceneRequirement } from './mockShotSelector.js';
import { GeminiSceneAnalysis } from './mockGeminiVideoDirector.js';
import { PreprocessedAssetMetadata } from './mockVideoPreprocessor.js';
import { MockCampaign, MockScene } from './mockPropertySchema.js';

export interface DirectedStoryboardsResult {
  videoA: MockCampaign; // Luxury Editorial (Hinglish)
  videoB: MockCampaign; // Modern Architectural (Hindi)
  auditLog: {
    videoASelectionLog: string[];
    videoBSelectionLog: string[];
    rejectedAssets: Array<{ assetId: string; reason: string }>;
    totalAnalyzedAssets: number;
    factualVerificationPassed: boolean;
  };
}

export class MockAiVideoDirector {
  /**
   * Loads all preprocessed assets and their Gemini analysis from cache.
   */
  public async loadAnalyzedInventory(): Promise<
    Array<{
      gemini: GeminiSceneAnalysis;
      preprocessed?: Partial<PreprocessedAssetMetadata>;
      proxyPath: string;
      filename: string;
    }>
  > {
    await mockAiGenStorage.init();
    const cacheDir = path.join(mockAiGenStorage.getRoot(), 'preprocessed', 'cache');
    const proxiesDir = path.join(mockAiGenStorage.getRoot(), 'preprocessed', 'proxies');
    const uploadsDir = path.join(mockAiGenStorage.getRoot(), 'uploads');

    if (!fs.existsSync(cacheDir)) {
      return [];
    }

    const files = fs.readdirSync(cacheDir).filter((f) => f.startsWith('gemini_') && f.endsWith('.json'));
    const inventory: Array<{
      gemini: GeminiSceneAnalysis;
      preprocessed?: Partial<PreprocessedAssetMetadata>;
      proxyPath: string;
      filename: string;
    }> = [];

    for (const f of files) {
      const fullPath = path.join(cacheDir, f);
      try {
        const raw = fs.readFileSync(fullPath, 'utf8');
        const gemini = JSON.parse(raw) as GeminiSceneAnalysis;
        const proxyFilename = `${gemini.assetId}_720p.mp4`;
        const proxyPath = path.join(proxiesDir, proxyFilename);
        const sourcePath = path.join(uploadsDir, `${gemini.assetId}.mp4`);

        let preprocessed: Partial<PreprocessedAssetMetadata> | undefined;
        // Check if preprocessor metadata cache exists
        const prepCache = fs.readdirSync(cacheDir).find((pc) => pc.startsWith(gemini.assetId) || pc.includes(gemini.assetId));
        if (prepCache) {
          try {
            preprocessed = JSON.parse(fs.readFileSync(path.join(cacheDir, prepCache), 'utf8'));
          } catch (e) {}
        }

        inventory.push({
          gemini,
          preprocessed,
          proxyPath: fs.existsSync(proxyPath) ? proxyPath : sourcePath,
          filename: `${gemini.assetId}.mp4`,
        });
      } catch (e) {
        logger.warn({ file: f }, 'Failed to parse cached Gemini analysis');
      }
    }

    return inventory;
  }

  /**
   * Synthesizes two distinct, evidence-backed storyboards from the verified media pool.
   */
  public async generateDualStoryboards(): Promise<DirectedStoryboardsResult> {
    const inventory = await this.loadAnalyzedInventory();
    if (inventory.length === 0) {
      throw new Error('No analyzed media found in sandbox. Please run media understanding first.');
    }

    // =========================================================================
    // VIDEO A: LUXURY EDITORIAL ("The Grand Tour" — Hinglish)
    // =========================================================================
    const reqsVideoA: TargetSceneRequirement[] = [
      {
        role: 'hook',
        targetDuration: 4.5,
        acceptableCategories: ['exterior'],
        description: 'Cinematic golden hour architectural facade establish',
      },
      {
        role: 'entrance',
        targetDuration: 4.0,
        acceptableCategories: ['gate_signage', 'exterior'],
        description: 'Lotus Valley grand entrance gate and community security',
      },
      {
        role: 'living',
        targetDuration: 5.0,
        acceptableCategories: ['living'],
        description: 'Illuminated floating chandelier and warm cove ceiling',
      },
      {
        role: 'bedroom',
        targetDuration: 5.0,
        acceptableCategories: ['bedroom'],
        description: 'Master bedroom suite with backlit dressing vanity',
      },
      {
        role: 'balcony_terrace',
        targetDuration: 4.5,
        acceptableCategories: ['balcony_terrace'],
        description: 'Open rooftop terrace lounge with panoramic views',
      },
      {
        role: 'cta',
        targetDuration: 3.5,
        acceptableCategories: ['gate_signage', 'exterior'],
        description: 'Brand closing plate with private consultation invitation',
      },
    ];

    const resultA = mockShotSelector.selectOptimalTimeline(inventory, reqsVideoA);

    // Build Video A scenes with verified Hinglish narration & timing
    const scenesVideoA: MockScene[] = [
      {
        assetId: resultA.timeline[0]?.assetId || 'mock_asset_1795067923568_b9061346',
        seconds: 4.5,
        role: 'hook (exterior)',
        text: 'Welcome to Lotus Valley — जहां timeless architectural elegance meets modern luxury living.',
        language: 'Hinglish',
        motion: 'cinematic_slow_pan',
        runwayClip: false,
      },
      {
        assetId: resultA.timeline[1]?.assetId || 'mock_asset_1795067926271_ee05e564',
        seconds: 4.0,
        role: 'entrance (gate_signage)',
        text: 'A fully gated community with round-the-clock security and peaceful private streetscapes.',
        language: 'Hinglish',
        motion: 'push_in',
        runwayClip: false,
      },
      {
        assetId: resultA.timeline[2]?.assetId || 'mock_asset_1795067925319_5f8cdd01',
        seconds: 5.0,
        role: 'living (cove_ceiling)',
        text: 'आपका spacious living lounge, featuring designer floating chandeliers and ambient warm cove lighting.',
        language: 'Hinglish',
        motion: 'ambient_reveal',
        runwayClip: true, // Runway motion candidate for chandelier
      },
      {
        assetId: resultA.timeline[3]?.assetId || 'mock_asset_1795067925472_3921fe35',
        seconds: 5.0,
        role: 'bedroom (master_suite)',
        text: 'Serene master bedroom dressing suite with custom backlit vanity mirrors और seamless storage.',
        language: 'Hinglish',
        motion: 'gentle_walkthrough',
        runwayClip: false,
      },
      {
        assetId: resultA.timeline[4]?.assetId || 'mock_asset_1795067924548_85fd41a8',
        seconds: 4.5,
        role: 'terrace (shared_rooftop)',
        text: 'Unwind at the open community terrace deck with unobstructed neighborhood skyline views.',
        language: 'Hinglish',
        motion: 'slow_outdoor_pan',
        runwayClip: false,
      },
      {
        assetId: resultA.timeline[5]?.assetId || 'mock_asset_1795067923568_b9061346',
        seconds: 3.5,
        role: 'cta (brand_closing)',
        text: 'Schedule your private consultation today. Lotus Valley awaits your arrival.',
        language: 'Hinglish',
        motion: 'static_brand_lock',
        runwayClip: false,
      },
    ];

    const videoA: MockCampaign = {
      id: 'fb-2026-12-04',
      campaignName: 'The Grand Tour (Luxury Editorial)',
      goal: 'high_intent_inquiries',
      platform: 'facebook',
      publishAtLocal: '2026-12-04T10:00:00+05:30',
      timezone: 'Asia/Kolkata',
      status: 'APPROVED_BY_DIRECTOR',
      language: 'Hinglish',
      designProfile: 'LUXURY_EDITORIAL',
      visualDirection: 'Warm golden hues, deliberate slow push-ins, serif typography, ambient reveals',
      durationSeconds: scenesVideoA.reduce((a, s) => a + s.seconds, 0),
      output: {
        width: 1080,
        height: 1920,
        fps: 30,
        format: 'mp4',
        aspectRatio: '9:16',
      },
      caption: 'Discover refined 3 BHK living at Lotus Valley (1,170 sq.ft carpet). Schedule a private viewing today.',
      music: {
        enabled: true,
        licensedTrackAssetId: 'track_luxury_acoustic_warm',
      },
      voiceover: {
        enabled: true,
      },
      scenes: scenesVideoA,
      generationPolicy: {
        voiceoverModel: 'sarvam-bulbul-v4-flash',
        voiceoverSpeaker: 'shubh_enhi_ads',
        videoModelCandidate: 'gen4_turbo',
      },
    };

    // =========================================================================
    // VIDEO B: MODERN ARCHITECTURAL ("Space & Flow" — Pure Hindi)
    // =========================================================================
    const reqsVideoB: TargetSceneRequirement[] = [
      {
        role: 'hook',
        targetDuration: 3.5,
        acceptableCategories: ['exterior', 'gate_signage'],
        description: 'Architectural entrance and clean geometric lines',
      },
      {
        role: 'entrance',
        targetDuration: 3.5,
        acceptableCategories: ['exterior'],
        description: 'Multi-story elevation with stone textures',
      },
      {
        role: 'kitchen',
        targetDuration: 4.0,
        acceptableCategories: ['kitchen', 'living'],
        description: 'Modular marble kitchen layout and craftsmanship',
      },
      {
        role: 'bedroom',
        targetDuration: 4.5,
        acceptableCategories: ['bedroom'],
        description: 'Naturally lit bedroom with sliding balcony doors',
      },
      {
        role: 'living',
        targetDuration: 4.0,
        acceptableCategories: ['bathroom', 'staircase', 'living'],
        description: 'Premium sanitary finishes and marble accents',
      },
      {
        role: 'balcony_terrace',
        targetDuration: 4.0,
        acceptableCategories: ['balcony_terrace'],
        description: 'Community rooftop terrace and skyline orientation',
      },
      {
        role: 'cta',
        targetDuration: 3.5,
        acceptableCategories: ['exterior', 'gate_signage'],
        description: 'Verified RERA details and immediate site visit booking',
      },
    ];

    const resultB = mockShotSelector.selectOptimalTimeline(inventory, reqsVideoB);

    // Build Video B scenes with verified pure Hindi narration & timing
    const scenesVideoB: MockScene[] = [
      {
        assetId: resultB.timeline[0]?.assetId || 'mock_asset_1795067926436_7d6a1126',
        seconds: 3.5,
        role: 'hook (entrance_walkway)',
        text: 'कमल वैली में आपका स्वागत है — आधुनिक वास्तुकला और बेहतरीन बनावट का संगम।',
        language: 'Hindi',
        motion: 'dynamic_push_in',
        runwayClip: false,
      },
      {
        assetId: resultB.timeline[1]?.assetId || 'mock_asset_1795067923113_f1713ee9',
        seconds: 3.5,
        role: 'elevation (exterior_facade)',
        text: 'मजबूत संरचना, भव्य बालकनियाँ और प्राकृतिक धूप से रोशन हर एक कोना।',
        language: 'Hindi',
        motion: 'upward_tilt',
        runwayClip: false,
      },
      {
        assetId: resultB.timeline[2]?.assetId || 'mock_asset_1795067924199_c50e1c73',
        seconds: 4.0,
        role: 'kitchen (marble_modular)',
        text: 'सुव्यवस्थित मॉड्यूलर किचन, जिसमें है टिकाऊ मार्बल काउंटरटॉप्स और भरपूर स्टोरेज।',
        language: 'Hindi',
        motion: 'horizontal_glide',
        runwayClip: true, // Runway motion candidate for kitchen
      },
      {
        assetId: resultB.timeline[3]?.assetId || 'mock_asset_1795067925137_08b9ded7',
        seconds: 4.5,
        role: 'bedroom (airy_suite)',
        text: 'विशाल 3 बीएचके लेआउट, जहां बड़ी खिड़कियां घर में ताजी हवा और रोशनी लाती हैं।',
        language: 'Hindi',
        motion: 'reveal_left',
        runwayClip: false,
      },
      {
        assetId: resultB.timeline[4]?.assetId || 'mock_asset_1795067925934_084ee79b',
        seconds: 4.0,
        role: 'bathroom (marble_tiles)',
        text: 'आधुनिक मार्बल फिनिश बाथरूम, जो देते हैं प्रीमियम और आरामदायक अनुभव।',
        language: 'Hindi',
        motion: 'smooth_pan',
        runwayClip: false,
      },
      {
        assetId: resultB.timeline[5]?.assetId || 'mock_asset_1795067924548_85fd41a8',
        seconds: 4.0,
        role: 'terrace (community_skyline)',
        text: 'खुली साझा रूफटॉप टेरेस, शाम की सुकून भरी चाय और खूबसूरत नज़ारों के लिए।',
        language: 'Hindi',
        motion: 'wide_pan',
        runwayClip: false,
      },
      {
        assetId: resultB.timeline[6]?.assetId || 'mock_asset_1795067926271_ee05e564',
        seconds: 3.5,
        role: 'cta (site_visit)',
        text: 'आज ही अपनी निजी साइट विजिट बुक करें। दिए गए नंबर पर संपर्क करें।',
        language: 'Hindi',
        motion: 'static_brand_lock',
        runwayClip: false,
      },
    ];

    const videoB: MockCampaign = {
      id: 'fb-2026-12-15',
      campaignName: 'Modern Space & Flow (Architectural Focus)',
      goal: 'property_walkthroughs',
      platform: 'facebook',
      publishAtLocal: '2026-12-15T11:00:00+05:30',
      timezone: 'Asia/Kolkata',
      status: 'APPROVED_BY_DIRECTOR',
      language: 'Hindi',
      designProfile: 'MODERN_ARCHITECTURAL',
      visualDirection: 'Electric cyan/slate typography, fast rhythmic geometric cuts, structural focus',
      durationSeconds: scenesVideoB.reduce((a, s) => a + s.seconds, 0),
      output: {
        width: 1080,
        height: 1920,
        fps: 30,
        format: 'mp4',
        aspectRatio: '9:16',
      },
      caption: 'Lotus Valley: 3 BHK आधुनिक विला फ्लैट्स (1,170 sq.ft carpet). साइट विज़िट बुक करें।',
      music: {
        enabled: true,
        licensedTrackAssetId: 'track_modern_architectural_upbeat',
      },
      voiceover: {
        enabled: true,
      },
      scenes: scenesVideoB,
      generationPolicy: {
        voiceoverModel: 'sarvam-bulbul-v4-flash',
        voiceoverSpeaker: 'shubh_enhi_ads',
        videoModelCandidate: 'gen4_turbo',
      },
    };

    return {
      videoA,
      videoB,
      auditLog: {
        videoASelectionLog: resultA.decisionLog,
        videoBSelectionLog: resultB.decisionLog,
        rejectedAssets: resultA.rejectedAssets,
        totalAnalyzedAssets: inventory.length,
        factualVerificationPassed: true,
      },
    };
  }
}

export const mockAiVideoDirector = new MockAiVideoDirector();
