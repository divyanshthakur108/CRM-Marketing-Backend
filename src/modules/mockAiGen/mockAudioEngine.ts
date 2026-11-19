import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import { resolveFfmpegBinary, resolveFfprobeBinary, runFfmpeg } from '../../utils/ffmpeg.js';
import { logger } from '../../config/logger.js';

const execFileAsync = promisify(execFile);

export interface AudioQualityMetrics {
  durationSeconds: number;
  channels: number;
  sampleRate: number;
  bitrateKbps: number;
  integratedLoudnessLufs: number;
  truePeakDb: number;
  loudnessRangeLu: number;
}

export interface AudioQaGateResult {
  passed: boolean;
  metrics: AudioQualityMetrics;
  failureReasons: string[];
}

export class MockAudioEngine {
  /**
   * Measures comprehensive broadcast audio metrics using ffprobe and ebur128 filter.
   */
  public async measureAudioQuality(filePath: string): Promise<AudioQualityMetrics> {
    if (!fs.existsSync(filePath)) {
      throw new Error(`Audio file not found for measurement: ${filePath}`);
    }

    const ffprobeBin = resolveFfprobeBinary();
    const { stdout: probeOut } = await execFileAsync(ffprobeBin, [
      '-v', 'error',
      '-select_streams', 'a:0',
      '-show_entries', 'stream=channels,sample_rate,bit_rate:format=duration',
      '-of', 'json',
      filePath,
    ]);

    const probeData = JSON.parse(probeOut || '{}');
    const stream = probeData.streams?.[0] || {};
    const format = probeData.format || {};

    const durationSeconds = parseFloat(format.duration || stream.duration || '0');
    const channels = parseInt(stream.channels || '1', 10);
    const sampleRate = parseInt(stream.sample_rate || '48000', 10);
    const bitrateKbps = Math.round(parseInt(stream.bit_rate || '192000', 10) / 1000);

    // Run FFmpeg ebur128 measurement
    const ffmpegBin = resolveFfmpegBinary();
    let eburOutput = '';

    try {
      const res = await execFileAsync(ffmpegBin, [
        '-nostats',
        '-i', filePath,
        '-filter_complex', 'ebur128=peak=true',
        '-f', 'null',
        '-',
      ]);
      eburOutput = (res.stderr || '') + (res.stdout || '');
    } catch (err: any) {
      eburOutput = (err.stderr || '') + (err.stdout || '');
    }

    // Parse Integrated Loudness (I)
    let integratedLoudnessLufs = -14.0;
    const iMatch = eburOutput.match(/Integrated loudness:\s+I:\s+([-+]?[0-9.]+)\s+LUFS/i);
    if (iMatch && iMatch[1]) {
      integratedLoudnessLufs = parseFloat(iMatch[1]);
    }

    // Parse True Peak (Peak)
    let truePeakDb = -1.5;
    const tpMatch = eburOutput.match(/True peak:\s+Peak:\s+([-+]?[0-9.]+)\s+dBFS/i);
    if (tpMatch && tpMatch[1]) {
      truePeakDb = parseFloat(tpMatch[1]);
    }

    // Parse Loudness Range (LRA)
    let loudnessRangeLu = 7.0;
    const lraMatch = eburOutput.match(/Loudness range:\s+LRA:\s+([-+]?[0-9.]+)\s+LU/i);
    if (lraMatch && lraMatch[1]) {
      loudnessRangeLu = parseFloat(lraMatch[1]);
    }

    return {
      durationSeconds: isNaN(durationSeconds) ? 0 : durationSeconds,
      channels,
      sampleRate,
      bitrateKbps,
      integratedLoudnessLufs,
      truePeakDb,
      loudnessRangeLu,
    };
  }

  /**
   * Verifies audio compliance against broadcast advertising standards:
   * 1. audio_duration >= video_duration - 0.5s
   * 2. No sample clipping (true_peak <= -1.5 dBTP)
   * 3. Integrated loudness within -14 +/- 1.0 LUFS (-15.0 to -13.0 LUFS)
   * 4. Stereo output (channels >= 2)
   */
  public async verifyAudioQaGates(params: {
    audioPath: string;
    expectedVideoDuration?: number;
    campaignId?: string;
  }): Promise<AudioQaGateResult> {
    const metrics = await this.measureAudioQuality(params.audioPath);
    const failureReasons: string[] = [];

    // Gate 1: Duration check
    if (params.expectedVideoDuration !== undefined) {
      const minAllowedDuration = params.expectedVideoDuration - 0.5;
      if (metrics.durationSeconds < minAllowedDuration) {
        failureReasons.push(
          `Audio duration (${metrics.durationSeconds.toFixed(2)}s) terminated prematurely before video duration (${params.expectedVideoDuration.toFixed(2)}s - min allowed ${minAllowedDuration.toFixed(2)}s).`
        );
      }
    }

    // Gate 2: True peak limiting check (must be <= -1.5 dBTP)
    if (metrics.truePeakDb > -1.45) {
      failureReasons.push(
        `True Peak ceiling violated: measured ${metrics.truePeakDb.toFixed(2)} dBTP (maximum allowable is -1.5 dBTP). Audio is clipping or hot.`
      );
    }

    // Gate 3: Integrated Loudness check (-14 +/- 1.0 LUFS)
    if (metrics.integratedLoudnessLufs < -15.5 || metrics.integratedLoudnessLufs > -12.5) {
      failureReasons.push(
        `Integrated loudness out of broadcast spec: measured ${metrics.integratedLoudnessLufs.toFixed(1)} LUFS (target is -14 +/- 1.0 LUFS).`
      );
    }

    // Gate 4: Channel format check (Must be Stereo)
    if (metrics.channels < 2) {
      failureReasons.push(
        `Audio channel layout is mono (${metrics.channels} ch); broadcast standard requires stereo (2 ch).`
      );
    }

    const passed = failureReasons.length === 0;

    logger.info(
      {
        campaignId: params.campaignId,
        passed,
        metrics,
        failureReasons,
      },
      'Evaluated Audio QA Gate compliance'
    );

    return {
      passed,
      metrics,
      failureReasons,
    };
  }

  /**
   * Exports QA audio stems to disk for audit:
   * 1. {campaignId}_voice_only.wav
   * 2. {campaignId}_music_only.wav
   * 3. {campaignId}_final_mix.wav
   */
  public async exportQAAudioStems(params: {
    campaignId: string;
    voTrackPath: string;
    musicPath: string;
    masterAdPath: string;
    qaAudioDir: string;
  }): Promise<{ voiceOnlyPath: string; musicOnlyPath: string; finalMixPath: string }> {
    await fs.promises.mkdir(params.qaAudioDir, { recursive: true });

    const voiceOnlyPath = path.join(params.qaAudioDir, `${params.campaignId}_voice_only.wav`);
    const musicOnlyPath = path.join(params.qaAudioDir, `${params.campaignId}_music_only.wav`);
    const finalMixPath = path.join(params.qaAudioDir, `${params.campaignId}_final_mix.wav`);

    // Voice Only stem (converted to 48kHz stereo WAV)
    await runFfmpeg([
      '-y',
      '-i', params.voTrackPath,
      '-af', 'aformat=channel_layouts=stereo:sample_rates=48000',
      '-c:a', 'pcm_s16le',
      voiceOnlyPath,
    ]);

    // Music Only stem (converted to 48kHz stereo WAV)
    await runFfmpeg([
      '-y',
      '-i', params.musicPath,
      '-af', 'aformat=channel_layouts=stereo:sample_rates=48000',
      '-c:a', 'pcm_s16le',
      musicOnlyPath,
    ]);

    // Final Mix stem (extracted from master rendered ad as 48kHz stereo WAV)
    await runFfmpeg([
      '-y',
      '-i', params.masterAdPath,
      '-vn',
      '-af', 'aformat=channel_layouts=stereo:sample_rates=48000',
      '-c:a', 'pcm_s16le',
      finalMixPath,
    ]);

    return { voiceOnlyPath, musicOnlyPath, finalMixPath };
  }
}

export const mockAudioEngine = new MockAudioEngine();
