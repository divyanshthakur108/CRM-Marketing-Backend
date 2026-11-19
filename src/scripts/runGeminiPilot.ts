import path from 'path';
import fs from 'fs';
import { mockVideoPreprocessor } from '../modules/mockAiGen/mockVideoPreprocessor.js';
import { mockGeminiVideoDirector, GeminiSceneAnalysis } from '../modules/mockAiGen/mockGeminiVideoDirector.js';
import { mockAiGenStorage } from '../modules/mockAiGen/mockAiGenStorage.js';
import { env } from '../config/env.js';

interface ExpectedClip {
  cleanName: string;
  originalName: string;
  expectedCategory: string;
  rationale: string;
}

const PILOT_CLIPS: ExpectedClip[] = [
  {
    cleanName: 'mock_asset_1795067923568_b9061346.mp4',
    originalName: 'WhatsApp Video 2026-11-17 at 4.12.59 PM.mp4',
    expectedCategory: 'exterior',
    rationale: 'Front architectural facade, classical pillars, arched upper windows, and ornate balcony.',
  },
  {
    cleanName: 'mock_asset_1795067926271_ee05e564.mp4',
    originalName: 'WhatsApp Video 2026-11-17 at 4.15.07 PM.mp4',
    expectedCategory: 'gate_signage',
    rationale: 'Outdoor entry gate with security cabin and prominent "LOTUS VALLEY" project sign.',
  },
  {
    cleanName: 'mock_asset_1795067926436_7d6a1126.mp4',
    originalName: 'WhatsApp Video 2026-11-17 at 4.16.28 PM.mp4',
    expectedCategory: 'outdoor_presenter',
    rationale: 'Outdoor ground-level view of entrance doors with a person seated outside.',
  },
  {
    cleanName: 'mock_asset_1795067925319_5f8cdd01.mp4',
    originalName: 'WhatsApp Video 2026-11-17 at 4.14.53 PM.mp4',
    expectedCategory: 'living',
    rationale: 'Interior ceiling with warm cove lighting and modern circular floating chandelier.',
  },
  {
    cleanName: 'mock_asset_1795067925472_3921fe35.mp4',
    originalName: 'WhatsApp Video 2026-11-17 at 4.14.57 PM - Copy.mp4',
    expectedCategory: 'bedroom',
    rationale: 'Master bedroom dressing area with backlit full-height mirror and vanity table.',
  },
  {
    cleanName: 'mock_asset_1795067924548_85fd41a8.mp4',
    originalName: 'WhatsApp Video 2026-11-17 at 4.14.42 PM.mp4',
    expectedCategory: 'poor_quality_detail',
    rationale: 'Dark, underexposed static closeup of a wooden door handle with zero spatial context.',
  },
];

async function main() {
  console.log('========================================================================');
  console.log('REALCRM — MILESTONE 2: GEMINI VIDEO UNDERSTANDING PILOT');
  console.log('========================================================================\n');

  await mockAiGenStorage.init();
  const uploadsDir = path.join(mockAiGenStorage.getRoot(), 'uploads');

  console.log('--- PRE-CALL EXPECTATION BASELINE ---');
  console.table(
    PILOT_CLIPS.map((c, i) => ({
      index: i + 1,
      filename: c.cleanName,
      originalName: c.originalName,
      expectedCategory: c.expectedCategory,
      rationale: c.rationale,
    }))
  );

  const results: Array<{
    filename: string;
    expectedCategory: string;
    predictedCategory: string;
    confidence: number;
    match: string;
    presenter: boolean;
    lighting: string;
    reviewFlag: string;
    costUsd: string;
    summary: string;
  }> = [];

  for (let i = 0; i < PILOT_CLIPS.length; i++) {
    const item = PILOT_CLIPS[i];
    const sourcePath = path.join(uploadsDir, item.cleanName);
    const assetId = path.parse(item.cleanName).name;

    console.log(`\n[${i + 1}/${PILOT_CLIPS.length}] Processing ${item.cleanName}...`);

    // 1. Preprocess with native aspect ratio preservation
    const preprocessed = await mockVideoPreprocessor.preprocessAsset(
      sourcePath,
      assetId,
      item.originalName,
      { forceRefresh: false }
    );

    console.log(`    Proxy ready: ${preprocessed.proxyPath} (${preprocessed.normalizedWidth}x${preprocessed.normalizedHeight})`);
    console.log(`    Sending proxy to Gemini (${env.GEMINI_ANALYSIS_MODEL || 'gemini-3.8-flash'})...`);

    const t0 = Date.now();
    const analysis: GeminiSceneAnalysis = await mockGeminiVideoDirector.analyzeVideoClip(
      preprocessed.proxyPath,
      assetId,
      item.originalName,
      preprocessed.durationSeconds
    );
    const elapsed = Date.now() - t0;

    console.log(`    Analysis completed in ${elapsed}ms:`);
    console.log(`      Predicted: ${analysis.predictedCategory} (${analysis.subCategory || 'general'})`);
    console.log(`      Confidence: ${analysis.confidence}`);
    console.log(`      Presenter: ${analysis.presenterDetected} ${analysis.presenterDescription ? `(${analysis.presenterDescription})` : ''}`);
    console.log(`      Review Flag: ${analysis.reviewFlag}`);
    console.log(`      Tokens: in=${analysis.tokensUsed.input}, out=${analysis.tokensUsed.output} | Cost: $${analysis.estimatedCostUsd.toFixed(5)}`);
    console.log(`      Summary: "${analysis.summary}"`);

    const isMatch =
      analysis.predictedCategory.toLowerCase().includes(item.expectedCategory.toLowerCase()) ||
      item.expectedCategory.toLowerCase().includes(analysis.predictedCategory.toLowerCase());

    results.push({
      filename: item.cleanName,
      expectedCategory: item.expectedCategory,
      predictedCategory: analysis.predictedCategory,
      confidence: analysis.confidence,
      match: isMatch ? 'YES' : 'DIFF',
      presenter: analysis.presenterDetected,
      lighting: analysis.lightingQuality,
      reviewFlag: analysis.reviewFlag,
      costUsd: `$${analysis.estimatedCostUsd.toFixed(5)}`,
      summary: analysis.summary.slice(0, 60) + '...',
    });
  }

  const totalSpend = mockGeminiVideoDirector.getCumulativeSpendUsd();

  console.log('\n========================================================================');
  console.log('PILOT RESULTS TABLE: PREDICTIONS VS EXPECTATIONS');
  console.log('========================================================================');
  console.table(results);

  console.log(`\nCumulative Gemini Pilot Spend: $${totalSpend.toFixed(5)} USD (Budget Cap: $2.00 USD)`);
  console.log('No Runway or Sarvam calls were made.');
  console.log('\n[STOP] Milestone 2 pilot run completed. Waiting for user verdict.\n');
}

main().catch((err) => {
  console.error('\n[FAIL] Gemini pilot run failed:', err);
  process.exit(1);
});
