import { mockAiGenService } from './modules/mockAiGen/mockAiGenService.js';

async function main() {
  console.log('Initializing MockAiGenService...');
  await mockAiGenService.init();
  console.log('Rendering Full 47s Presenter-Led Ad with Voiceover & Animated Captions...');
  const result = await mockAiGenService.composeCampaignAd('fb-2026-12-25');
  console.log('Full 47s Ad Composed Successfully!');
  console.log(JSON.stringify(result, null, 2));
}

main().then(() => process.exit(0)).catch(err => {
  console.error('Full ad rendering failed:', err);
  process.exit(1);
});
