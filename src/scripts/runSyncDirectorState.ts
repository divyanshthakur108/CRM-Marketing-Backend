import dotenv from 'dotenv';
dotenv.config();
import { mockAiGenService } from '../modules/mockAiGen/mockAiGenService.js';

async function main() {
  console.log('Synchronizing AI Director State with Property Project & Campaigns...');
  await mockAiGenService.init();
  const mappings = await mockAiGenService.autoMapSlots();
  console.log(`Auto-mapped ${Object.keys(mappings).length} room slots based on real visual evidence!`);

  const campaigns = await mockAiGenService.getCampaigns();
  console.log(`Generated ${campaigns.length} distinct directed campaigns:`);
  for (const c of campaigns) {
    console.log(`  • [${c.id}] ${c.campaignName} (${c.language}, ${c.durationSeconds}s, ${c.scenes.length} scenes)`);
  }
}

main().catch(console.error);
