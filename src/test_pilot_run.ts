import { mockAiGenService } from './modules/mockAiGen/mockAiGenService.js';

async function main() {
  console.log('Initializing MockAiGenService...');
  await mockAiGenService.init();
  console.log('Rendering 12.5s Style-Match Pilot with Voiceover & Animated Captions...');
  const result = await mockAiGenService.composeStyleMatchPilot();
  console.log('Pilot Composed Successfully!');
  console.log(JSON.stringify(result, null, 2));
}

main().then(() => process.exit(0)).catch(err => {
  console.error('Pilot rendering failed:', err);
  process.exit(1);
});
