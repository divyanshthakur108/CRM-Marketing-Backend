import dotenv from 'dotenv';
dotenv.config();

import { mockAiGenService } from '../modules/mockAiGen/mockAiGenService.js';

async function main() {
  console.log('--- Rendering Professional Upgraded Style-Match Pilot (12.5s) ---');
  await mockAiGenService.init();
  const result = await mockAiGenService.composeStyleMatchPilot();
  console.log('\n========================================');
  console.log('✅ Pilot Render Finished Successfully!');
  console.log('Path:', result.absolutePath);
  console.log('Duration:', result.durationSeconds, 'seconds');
  console.log('Dimensions:', `${result.width}x${result.height}`);
  console.log('Scenes Count:', result.scenesCount);
  console.log('Voiceover Track:', result.voiceoverAudioUrl);
  console.log('Captions Timeline:', result.captionsTimelineUrl);
  console.log('========================================');
}

main().catch((err) => {
  console.error('❌ Pilot render failed:', err);
  process.exit(1);
});
