import dotenv from 'dotenv';
dotenv.config();

import { mockAiGenService } from '../modules/mockAiGen/mockAiGenService.js';
import { runFfmpeg } from '../utils/ffmpeg.js';
import path from 'path';
import fs from 'fs';

async function main() {
  console.log('--- Rendering The Grand Tour (Presenter-Led Editorial) fb-2026-12-25 ---');
  await mockAiGenService.init();

  const campaignId = 'fb-2026-12-25';
  const result = await mockAiGenService.composeCampaignAd(campaignId);

  console.log('\n========================================');
  console.log('✅ Campaign Ad Render Finished Successfully!');
  console.log('Path:', result.absolutePath);
  console.log('Duration:', result.durationSeconds, 'seconds');
  console.log('Dimensions:', `${result.width}x${result.height}`);
  console.log('Scenes Count:', result.scenesCount);
  console.log('Voiceover Track:', result.voiceoverAudioUrl);
  console.log('Captions Timeline:', result.captionsTimelineUrl);
  console.log('========================================');

  // Extract verification frames
  const verifyDir = path.dirname(result.absolutePath);
  const frame5s = path.join(verifyDir, `verify_${campaignId}_005s.jpg`);
  const frame10s = path.join(verifyDir, `verify_${campaignId}_010s.jpg`);

  await runFfmpeg([
    '-y',
    '-ss', '00:00:05.000',
    '-i', result.absolutePath,
    '-vframes', '1',
    '-q:v', '2',
    frame5s,
  ]);
  console.log('Frame at 0:05 saved to:', frame5s);

  await runFfmpeg([
    '-y',
    '-ss', '00:00:10.000',
    '-i', result.absolutePath,
    '-vframes', '1',
    '-q:v', '2',
    frame10s,
  ]);
  console.log('Frame at 0:10 saved to:', frame10s);
}

main().catch((err) => {
  console.error('❌ Ad render failed:', err);
  process.exit(1);
});
