import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import dotenv from 'dotenv';

// Ensure .env is loaded whether run from repo root or CRM-Marketing-Backend
const envPath = fs.existsSync(path.resolve(process.cwd(), '.env'))
  ? path.resolve(process.cwd(), '.env')
  : path.resolve(process.cwd(), 'CRM-Marketing-Backend/.env');
dotenv.config({ path: envPath });

import { mockVideoPreprocessor } from '../modules/mockAiGen/mockVideoPreprocessor.js';
import { mockGeminiVideoDirector, GeminiSceneAnalysis } from '../modules/mockAiGen/mockGeminiVideoDirector.js';
import { mockAiGenStorage } from '../modules/mockAiGen/mockAiGenStorage.js';

interface CatalogEntry {
  assetId: string;
  filename: string;
  sourcePath: string;
  sha256: string;
  isDuplicate: boolean;
  duplicateOf?: string;
}

async function runCatalogAnalysis() {
  console.log('========================================================================');
  console.log('REALCRM — MILESTONE 2 EXTENSION: FULL CATALOG MEDIA UNDERSTANDING');
  console.log('========================================================================\n');

  await mockAiGenStorage.init();
  const uploadsDir = path.join(mockAiGenStorage.getRoot(), 'uploads');
  const files = fs.readdirSync(uploadsDir).filter((f) => f.endsWith('.mp4'));

  // Group by SHA256 to avoid redundant processing or API calls
  const hashToPrimary = new Map<string, CatalogEntry>();
  const catalog: CatalogEntry[] = [];

  for (const f of files) {
    const fullPath = path.join(uploadsDir, f);
    const buf = fs.readFileSync(fullPath);
    const hash = crypto.createHash('sha256').update(buf).digest('hex');
    const assetId = path.parse(f).name;

    if (!hashToPrimary.has(hash)) {
      const entry: CatalogEntry = {
        assetId,
        filename: f,
        sourcePath: fullPath,
        sha256: hash,
        isDuplicate: false,
      };
      hashToPrimary.set(hash, entry);
      catalog.push(entry);
    } else {
      const primary = hashToPrimary.get(hash)!;
      catalog.push({
        assetId,
        filename: f,
        sourcePath: fullPath,
        sha256: hash,
        isDuplicate: true,
        duplicateOf: primary.assetId,
      });
    }
  }

  const uniqueEntries = catalog.filter((c) => !c.isDuplicate);
  console.log(`Found ${files.length} total videos (${uniqueEntries.length} unique, ${catalog.length - uniqueEntries.length} duplicates).\n`);

  const results: Array<{
    assetId: string;
    filename: string;
    category: string;
    confidence: number;
    presenter: boolean;
    lighting: string;
    reviewFlag: string;
    costUsd: string;
    summary: string;
  }> = [];

  for (let i = 0; i < uniqueEntries.length; i++) {
    const item = uniqueEntries[i];
    console.log(`\n[${i + 1}/${uniqueEntries.length}] Processing ${item.assetId} (${item.filename})...`);

    // 1. Preprocess proxy (aspect ratio preserved)
    const preprocessed = await mockVideoPreprocessor.preprocessAsset(
      item.sourcePath,
      item.assetId,
      item.filename,
      { forceRefresh: false }
    );

    // 2. Multimodal analysis (cached or Gemini 3.8 Flash)
    const analysis = await mockGeminiVideoDirector.analyzeVideoClip(
      preprocessed.proxyPath,
      item.assetId,
      item.filename,
      preprocessed.durationSeconds
    );

    results.push({
      assetId: item.assetId,
      filename: item.filename,
      category: analysis.predictedCategory,
      confidence: analysis.confidence,
      presenter: analysis.presenterDetected,
      lighting: analysis.lightingQuality,
      reviewFlag: analysis.reviewFlag,
      costUsd: `$${analysis.estimatedCostUsd.toFixed(5)}`,
      summary: analysis.summary.slice(0, 75) + '...',
    });
  }

  console.log('\n========================================================================');
  console.log('FULL CATALOG CLASSIFICATION LEDGER (18 Unique Assets)');
  console.log('========================================================================\n');
  console.table(results);

  console.log(`\nTotal Cumulative Gemini Spend: $${mockGeminiVideoDirector.getCumulativeSpendUsd().toFixed(5)} USD`);
  console.log('Hard Budget Cap: $2.00 USD');
  console.log('Zero paid Runway or Sarvam calls were made.\n');
}

runCatalogAnalysis().catch((err) => {
  console.error('Fatal error during catalog analysis:', err);
  process.exit(1);
});
