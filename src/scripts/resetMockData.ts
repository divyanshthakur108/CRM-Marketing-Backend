import dotenv from 'dotenv';
dotenv.config();

import { mockAiGenService } from '../modules/mockAiGen/mockAiGenService.js';

async function main() {
  console.log('--- Triggering Mock AI Data Reset ---');
  await mockAiGenService.init();
  const res = await mockAiGenService.resetMockData();
  console.log('✅ Reset Output:', res);
}

main().catch((err) => {
  console.error('❌ Reset failed:', err);
  process.exit(1);
});
