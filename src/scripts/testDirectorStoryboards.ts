import dotenv from 'dotenv';
dotenv.config();
import { mockAiVideoDirector } from '../modules/mockAiGen/mockAiVideoDirector.js';

async function main() {
  console.log('========================================================================');
  console.log('REALCRM — MILESTONE 4: AUTONOMOUS AI VIDEO DIRECTOR DUAL STORYBOARDS');
  console.log('========================================================================\n');

  const result = await mockAiVideoDirector.generateDualStoryboards();

  console.log('--- VIDEO A: LUXURY EDITORIAL (Hinglish) ---');
  console.log(`Campaign: ${result.videoA.campaignName} (${result.videoA.durationSeconds}s)`);
  console.table(
    result.videoA.scenes.map((s, idx) => ({
      index: idx + 1,
      role: s.role,
      assetId: s.assetId,
      duration: `${s.seconds}s`,
      language: s.language,
      narration: s.text,
    }))
  );

  console.log('\n--- VIDEO B: MODERN ARCHITECTURAL (Hindi) ---');
  console.log(`Campaign: ${result.videoB.campaignName} (${result.videoB.durationSeconds}s)`);
  console.table(
    result.videoB.scenes.map((s, idx) => ({
      index: idx + 1,
      role: s.role,
      assetId: s.assetId,
      duration: `${s.seconds}s`,
      language: s.language,
      narration: s.text,
    }))
  );

  console.log('\n--- REJECTED / DISCARDED ASSETS ---');
  console.table(result.auditLog.rejectedAssets);

  console.log('\n--- SELECTION DECISION LOGS (Video A) ---');
  result.auditLog.videoASelectionLog.forEach((log) => console.log('  •', log));

  console.log('\n--- SELECTION DECISION LOGS (Video B) ---');
  result.auditLog.videoBSelectionLog.forEach((log) => console.log('  •', log));
}

main().catch((err) => {
  console.error('Director storyboard test failed:', err);
  process.exit(1);
});
