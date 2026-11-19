import dotenv from 'dotenv';
dotenv.config();

import { mockAiGenService } from '../modules/mockAiGen/mockAiGenService.js';
import { mockAudioEngine } from '../modules/mockAiGen/mockAudioEngine.js';
import { resolveFfprobeBinary } from '../utils/ffmpeg.js';
import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';

const execFileAsync = promisify(execFile);

async function probeFileStreams(filePath: string): Promise<{ videoDuration: number; audioDuration: number; channels: number }> {
  const ffprobeBin = resolveFfprobeBinary();
  const { stdout } = await execFileAsync(ffprobeBin, [
    '-v', 'error',
    '-show_entries', 'stream=codec_type,duration,channels:format=duration',
    '-of', 'json',
    filePath,
  ]);
  const data = JSON.parse(stdout || '{}');
  const vStream = (data.streams || []).find((s: any) => s.codec_type === 'video');
  const aStream = (data.streams || []).find((s: any) => s.codec_type === 'audio');

  const videoDuration = parseFloat(vStream?.duration || data.format?.duration || '0');
  const audioDuration = parseFloat(aStream?.duration || '0');
  const channels = parseInt(aStream?.channels || '0', 10);

  return { videoDuration, audioDuration, channels };
}

async function main() {
  console.log('========================================================================');
  console.log('REALCRM — PHASE A VERIFICATION & REGRESSION AUDIT (AUDIO FIXES)');
  console.log('========================================================================\n');

  await mockAiGenService.init();

  const testCampaigns = ['fb-2026-12-15', 'fb-2026-12-04'];
  const auditResults: any[] = [];

  for (const campaignId of testCampaigns) {
    console.log(`\n------------------------------------------------------------`);
    console.log(`[TEST RUN] Composing and Mastering Campaign Ad: ${campaignId}`);
    console.log(`------------------------------------------------------------`);

    const result = await mockAiGenService.composeCampaignAd(campaignId);
    console.log(`✅ Ad rendered: ${result.absolutePath}`);

    // Probe physical streams
    const { videoDuration, audioDuration, channels } = await probeFileStreams(result.absolutePath);

    // Measure broadcast audio metrics via ebur128
    const audioMetrics = await mockAudioEngine.measureAudioQuality(result.absolutePath);

    // Verify QA Gates
    const qaGate = await mockAudioEngine.verifyAudioQaGates({
      audioPath: result.absolutePath,
      expectedVideoDuration: videoDuration,
      campaignId,
    });

    // Check separate QA stems
    const qaDir = path.join(path.dirname(path.dirname(result.absolutePath)), 'qa', 'audio');
    const voiceOnlyStem = path.join(qaDir, `${campaignId}_voice_only.wav`);
    const musicOnlyStem = path.join(qaDir, `${campaignId}_music_only.wav`);
    const finalMixStem = path.join(qaDir, `${campaignId}_final_mix.wav`);

    const stemsExist =
      fs.existsSync(voiceOnlyStem) &&
      fs.existsSync(musicOnlyStem) &&
      fs.existsSync(finalMixStem);

    // Read narration script for per-scene breakdown table
    const scriptPath = path.join(path.dirname(path.dirname(result.absolutePath)), 'audio', `narration_script_${campaignId}.json`);
    let sceneTable: any[] = [];
    if (fs.existsSync(scriptPath)) {
      const script = JSON.parse(fs.readFileSync(scriptPath, 'utf8'));
      sceneTable = (script.scenes || []).map((sc: any) => ({
        sceneIndex: sc.sceneIndex,
        sceneRole: sc.sceneRole,
        charCount: sc.narrationText?.length || 0,
        startSec: `${sc.startSeconds.toFixed(2)}s`,
        endSec: `${sc.endSeconds.toFixed(2)}s`,
        plannedDuration: `${sc.sceneDuration.toFixed(2)}s`,
        narrationExcerpt: (sc.narrationText || '').substring(0, 45) + '...',
      }));
    }

    console.log(`\nPer-Scene Narration & Timeline Table for ${campaignId}:`);
    console.table(sceneTable);

    auditResults.push({
      campaignId,
      profile: result.designProfile,
      videoDuration: `${videoDuration.toFixed(2)}s`,
      audioDuration: `${audioDuration.toFixed(2)}s`,
      durationDelta: `${(audioDuration - videoDuration).toFixed(2)}s`,
      integratedLufs: `${audioMetrics.integratedLoudnessLufs.toFixed(1)} LUFS`,
      truePeakDb: `${audioMetrics.truePeakDb.toFixed(2)} dBTP`,
      loudnessRange: `${audioMetrics.loudnessRangeLu.toFixed(1)} LU`,
      channels: channels === 2 ? 'Stereo (2ch)' : `Mono (${channels}ch)`,
      sampleRate: `${audioMetrics.sampleRate} Hz`,
      stemsWritten: stemsExist ? 'YES (3 stems)' : 'NO',
      qaGateStatus: qaGate.passed ? 'PASSED ✅' : 'FAILED ❌',
      failureReasons: qaGate.failureReasons,
    });
  }

  console.log('\n========================================================================');
  console.log('PHASE A: MEASURED REGRESSION RESULTS (BEFORE VS AFTER AUDIT)');
  console.log('========================================================================');
  console.table(auditResults);

  // Assert all passed
  const anyFailed = auditResults.some((r) => r.qaGateStatus.includes('FAILED'));
  if (anyFailed) {
    console.error('\n❌ REGRESSION TEST FAILED: One or more Audio QA gates failed.');
    process.exit(1);
  } else {
    console.log('\n✅ ALL AUDIO QA GATES PASSED: Full audio duration, broadcast -14 LUFS, <= -1.5 dBTP, stereo layout verified.');
  }
}

main().catch((err) => {
  console.error('Fatal error during Phase A audio verification:', err);
  process.exit(1);
});
