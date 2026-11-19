import { mockAiGenService } from '../modules/mockAiGen/mockAiGenService.js';
import { logger } from '../config/logger.js';

async function main() {
  logger.info('Initializing mock AI generation service...');
  await mockAiGenService.init();

  logger.info('Composing Video A (fb-2026-12-04)...');
  const adA = await mockAiGenService.composeCampaignAd('fb-2026-12-04');
  logger.info({ adA }, 'Video A composed successfully');

  logger.info('Composing Video B (fb-2026-12-15)...');
  const adB = await mockAiGenService.composeCampaignAd('fb-2026-12-15');
  logger.info({ adB }, 'Video B composed successfully');

  console.log('ALL_ADS_COMPOSED_SUCCESS');
}

main().catch((err) => {
  logger.error({ err }, 'Error during ad composition script');
  process.exit(1);
});
