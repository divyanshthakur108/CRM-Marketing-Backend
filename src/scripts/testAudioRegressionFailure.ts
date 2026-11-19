import { runFfmpeg } from '../utils/ffmpeg.js';
import { mockAudioEngine } from '../modules/mockAiGen/mockAudioEngine.js';
import fs from 'fs';
import path from 'path';

async function main() {
  console.log('========================================================================');
  console.log('TESTING REGRESSION TEST: PROOF OF FAILURE ON OLD BEHAVIOR');
  console.log('========================================================================\n');

  const testDir = 'storage/mock_ai_gen/test_regression';
  fs.mkdirSync(testDir, { recursive: true });

  const oldBuggyAudioPath = path.join(testDir, 'old_buggy_behavior.wav');

  // Re-create the exact OLD broken audio behavior:
  // 1. Scene 1 is ~4.3s
  // 2. Scene 2 is ~4s starting at delay 4.3s
  // 3. Mixed with old filter: amix=inputs=2:duration=first:dropout_transition=0:normalize=0
  // 4. Procedural sine waves (110Hz, 138Hz, 164Hz)
  // 5. No loudnorm (-12.6 LUFS, hot peak +0.1 dBTP), mono output
  console.log('Step 1: Simulating exact OLD broken audio pipeline...');
  const scene1 = path.join(testDir, 'scene1.wav');
  const scene2 = path.join(testDir, 'scene2.wav');

  // Scene 1: 4.27s tone
  await runFfmpeg([
    '-y',
    '-f', 'lavfi',
    '-i', 'sine=frequency=440:duration=4.27',
    '-c:a', 'pcm_s16le',
    scene1,
  ]);

  // Scene 2: 4.0s tone
  await runFfmpeg([
    '-y',
    '-f', 'lavfi',
    '-i', 'sine=frequency=550:duration=4.0',
    '-c:a', 'pcm_s16le',
    scene2,
  ]);

  // Old bug filter complex: amix with duration=first + harmonic sine waves + no loudnorm + mono
  const oldHarmonics = '0.10*sin(2*PI*110*t)+0.07*sin(2*PI*138.59*t)+0.07*sin(2*PI*164.81*t)+0.04*sin(2*PI*207.65*t)';
  await runFfmpeg([
    '-y',
    '-i', scene1,
    '-i', scene2,
    '-f', 'lavfi',
    '-i', `aevalsrc=${oldHarmonics}:d=26:s=48000`,
    '-filter_complex',
    '[0:a]adelay=350|350[a0];[1:a]adelay=4300|4300[a1];[a0][a1]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[vo];[vo][2:a]amix=inputs=2:duration=first:dropout_transition=0:normalize=0,volume=2.2,aformat=channel_layouts=mono[aout]',
    '-map', '[aout]',
    '-c:a', 'pcm_s16le',
    oldBuggyAudioPath,
  ]);

  console.log('Step 2: Probing old audio file generated with old behavior...');
  const oldMetrics = await mockAudioEngine.measureAudioQuality(oldBuggyAudioPath);
  console.log('Old File Measured Metrics:', {
    duration: `${oldMetrics.durationSeconds.toFixed(2)}s`,
    channels: oldMetrics.channels,
    integratedLufs: `${oldMetrics.integratedLoudnessLufs.toFixed(1)} LUFS`,
    truePeakDb: `${oldMetrics.truePeakDb.toFixed(2)} dBTP`,
  });

  console.log('\nStep 3: Running verifyAudioQaGates on old file (expecting FAIL)...');
  const qaResult = await mockAudioEngine.verifyAudioQaGates({
    audioPath: oldBuggyAudioPath,
    expectedVideoDuration: 26.0,
    campaignId: 'OLD_BUGGY_PIPELINE',
  });

  console.log('QA Gate Passed?', qaResult.passed ? 'YES (UNEXPECTED)' : 'NO (EXPECTED CATCH! ✅)');
  console.log('Failure Reasons Caught:');
  qaResult.failureReasons.forEach((r, i) => console.log(`  ${i + 1}. ${r}`));

  if (!qaResult.passed && qaResult.failureReasons.length >= 3) {
    console.log('\n✅ PROOF VERIFIED: Audio QA Gate correctly rejects the old behavior!');
  } else {
    console.error('\n❌ Regression test did not catch the old failures.');
    process.exit(1);
  }

  // Clean up test files
  fs.rmSync(testDir, { recursive: true, force: true });
}

main().catch(console.error);
