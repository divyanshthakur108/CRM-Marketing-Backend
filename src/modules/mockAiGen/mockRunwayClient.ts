import path from 'path';
import fs from 'fs';
import fsPromises from 'fs/promises';
import { spawn } from 'child_process';
import sharp from 'sharp';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { mockAiGenStorage } from './mockAiGenStorage.js';

export interface RunwayTaskOptions {
  promptImageUrl: string;
  sourceImageBuffer?: Buffer;
  model: 'seedance2_5' | 'gen3a_turbo' | 'gen4_turbo';
  promptText: string;
  ratio: '720:1280' | '1280:720' | '768:1280' | '1280:768';
  durationSeconds: number;
  hasHumanCostApproval: boolean; // MANDATORY GATE
}

export interface RunwayTaskResult {
  taskId: string;
  status: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'BLOCKED';
  model: string;
  outputVideoUrl?: string;
  localStorageKey?: string;
  elapsedSeconds?: number;
  estimatedCostCredits: number;
  estimatedCostUsd: number;
  error?: string;
}

export class MockRunwayClient {
  private readonly baseUrl = 'https://api.dev.runwayml.com/v1';

  public getApiKey(): string {
    return env.RUNWAYML_API_SECRET || env.RUNWAY_API_KEY || '';
  }

  public isConfigured(): boolean {
    const key = this.getApiKey();
    return Boolean(key && key.startsWith('key_'));
  }

  /**
   * Validates account key shape and permissions without creating chargeable jobs
   */
  public async validateAccountPermissions(): Promise<{
    configured: boolean;
    validKeyFormat: boolean;
    maskedKey: string;
  }> {
    const key = this.getApiKey();
    if (!key) {
      return { configured: false, validKeyFormat: false, maskedKey: 'NOT_SET' };
    }
    const masked = `${key.slice(0, 7)}...${key.slice(-4)}`;
    return {
      configured: true,
      validKeyFormat: key.startsWith('key_') && key.length > 20,
      maskedKey: masked,
    };
  }

  /**
   * Dispatches an image-to-video task with strict cost gating
   */
  public async createImageToVideoTask(options: RunwayTaskOptions): Promise<RunwayTaskResult> {
    const estimatedCostCredits = 5;
    const estimatedCostUsd = 0.25;

    // 1. HARD GATE: Mandatory Human Budget Approval
    if (!options.hasHumanCostApproval) {
      logger.warn('Runway paid generation blocked: human budget approval not granted');
      return {
        taskId: 'none',
        status: 'BLOCKED',
        model: options.model,
        estimatedCostCredits,
        estimatedCostUsd,
        error: 'BLOCKED: Human budget approval required before initiating chargeable Runway task.',
      };
    }

    // 2. Validate API Key
    const apiKey = this.getApiKey();
    if (!apiKey) {
      return {
        taskId: 'none',
        status: 'BLOCKED',
        model: options.model,
        estimatedCostCredits,
        estimatedCostUsd,
        error: 'BLOCKED: RUNWAY_API_KEY is not configured in backend environment.',
      };
    }

    logger.info(
      { model: options.model, ratio: options.ratio, duration: options.durationSeconds },
      'Submitting Runway image-to-video pilot task'
    );

    const startTime = Date.now();

    try {
      // Map candidate model to supported Runway API model (gen3a_turbo sunsetted on 2026-07-30, use gen4_turbo)
      const targetModel = options.model === 'seedance2_5' || options.model === 'gen3a_turbo' || !options.model
        ? 'gen4_turbo'
        : options.model;
      
      // Map ratio to valid Runway API aspect ratio
      let targetRatio: '768:1280' | '1280:768' = '768:1280';
      if (options.ratio === '1280:720' || options.ratio === '1280:768') {
        targetRatio = '1280:768';
      }

      // Prepare prompt image (convert local path or video keyframe to optimized Base64 Data URI)
      const promptImageDataUri = await this.preparePromptImage(
        options.promptImageUrl,
        options.sourceImageBuffer
      );

      const response = await fetch(`${this.baseUrl}/image_to_video`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'X-Runway-Version': '2024-11-06',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          promptImage: promptImageDataUri,
          model: targetModel,
          promptText: options.promptText,
          ratio: targetRatio,
          duration: options.durationSeconds === 10 ? 10 : 5,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error({ status: response.status, errorText }, 'Runway API task creation failed');
        return {
          taskId: 'error',
          status: 'FAILED',
          model: targetModel,
          estimatedCostCredits,
          estimatedCostUsd,
          error: `Runway API error (${response.status}): ${errorText}`,
        };
      }

      const data = (await response.json()) as { id: string };
      const taskId = data.id;

      // Poll task status until complete or timeout (max 90 seconds)
      const pollResult = await this.pollTaskUntilComplete(taskId, apiKey, startTime);
      return {
        ...pollResult,
        model: targetModel,
        estimatedCostCredits,
        estimatedCostUsd,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown network failure';
      logger.error({ err }, 'Exception while calling Runway API');
      return {
        taskId: 'error',
        status: 'FAILED',
        model: options.model,
        estimatedCostCredits,
        estimatedCostUsd,
        error: `Runway connection error: ${msg}`,
      };
    }
  }

  /**
   * Prepares a prompt image for Runway:
   * 1. If HTTPS URL or Data URI, returns as is.
   * 2. If video file, extracts a keyframe at 1s via FFmpeg.
   * 3. Normalizes & resizes via Sharp to 768x1280 portrait JPEG (<= 5MB).
   * 4. Returns base64 data:image/jpeg;base64,... string.
   */
  private async preparePromptImage(inputPathOrUrl: string, buffer?: Buffer): Promise<string> {
    if (
      inputPathOrUrl.startsWith('data:') ||
      inputPathOrUrl.startsWith('https://') ||
      inputPathOrUrl.startsWith('runway://')
    ) {
      return inputPathOrUrl;
    }

    let imageBuffer: Buffer | null = buffer || null;

    if (!imageBuffer) {
      let absPath = inputPathOrUrl;
      if (!path.isAbsolute(absPath)) {
        if (absPath.startsWith('/storage/')) {
          absPath = path.join(mockAiGenStorage.getStorageDir(), absPath.replace(/^\/storage\//, ''));
        } else if (absPath.startsWith('storage/')) {
          absPath = path.join(mockAiGenStorage.getStorageDir(), absPath.replace(/^storage\//, ''));
        } else {
          absPath = path.resolve(absPath);
        }
      }

      if (!fs.existsSync(absPath)) {
        throw new Error(`Source media file not found on disk at: ${absPath}`);
      }

      const ext = path.extname(absPath).toLowerCase();
      // If the asset assigned to this slot is an MP4 video, extract a keyframe still
      if (['.mp4', '.mov', '.mkv', '.webm', '.avi'].includes(ext)) {
        const scratchDir = path.join(mockAiGenStorage.getRoot(), 'scratch');
        await fsPromises.mkdir(scratchDir, { recursive: true });
        const framePath = path.join(scratchDir, `runway_keyframe_${Date.now()}.jpg`);

        await new Promise<void>((resolve, reject) => {
          const ff = spawn('ffmpeg', [
            '-y',
            '-ss', '00:00:01',
            '-i', absPath,
            '-frames:v', '1',
            '-update', '1',
            '-q:v', '2',
            framePath,
          ]);
          ff.on('close', (code) => {
            if (code === 0 && fs.existsSync(framePath)) resolve();
            else reject(new Error(`FFmpeg failed to extract keyframe from ${absPath} (exit ${code})`));
          });
          ff.on('error', reject);
        });

        imageBuffer = await fsPromises.readFile(framePath);
        fs.unlink(framePath, () => {});
      } else {
        imageBuffer = await fsPromises.readFile(absPath);
      }
    }

    // Optimize with Sharp: auto-orient, resize to 768x1280 (Runway portrait), output clean JPEG
    const optimizedBuffer = await sharp(imageBuffer)
      .rotate()
      .resize({
        width: 768,
        height: 1280,
        fit: 'cover',
        position: 'center',
      })
      .jpeg({ quality: 85 })
      .toBuffer();

    return `data:image/jpeg;base64,${optimizedBuffer.toString('base64')}`;
  }

  private async pollTaskUntilComplete(
    taskId: string,
    apiKey: string,
    startTime: number
  ): Promise<Pick<RunwayTaskResult, 'taskId' | 'status' | 'outputVideoUrl' | 'localStorageKey' | 'elapsedSeconds' | 'error'>> {
    const maxAttempts = 30; // 30 * 3s = 90s timeout
    let attempts = 0;

    while (attempts < maxAttempts) {
      attempts++;
      await new Promise((r) => setTimeout(r, 3000));

      try {
        const res = await fetch(`${this.baseUrl}/tasks/${taskId}`, {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'X-Runway-Version': '2024-11-06',
          },
        });

        if (!res.ok) {
          continue;
        }

        const taskData = (await res.json()) as {
          status: 'PENDING' | 'THROTTLED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';
          output?: string[];
          failure?: string;
        };

        if (taskData.status === 'SUCCEEDED' && taskData.output && taskData.output.length > 0) {
          const remoteUrl = taskData.output[0];
          const elapsedSeconds = Math.round((Date.now() - startTime) / 1000);

          // Download remote video to isolated sandbox
          const localKey = await this.downloadClipLocally(taskId, remoteUrl);

          return {
            taskId,
            status: 'SUCCEEDED',
            outputVideoUrl: `/storage/${localKey}`,
            localStorageKey: localKey,
            elapsedSeconds,
          };
        }

        if (taskData.status === 'FAILED' || taskData.status === 'CANCELLED') {
          return {
            taskId,
            status: 'FAILED',
            elapsedSeconds: Math.round((Date.now() - startTime) / 1000),
            error: taskData.failure || `Task ended with status ${taskData.status}`,
          };
        }
      } catch (err) {
        logger.warn({ taskId, err }, 'Transient error while polling Runway task');
      }
    }

    return {
      taskId,
      status: 'FAILED',
      elapsedSeconds: Math.round((Date.now() - startTime) / 1000),
      error: 'Task timed out after 90 seconds while polling Runway.',
    };
  }

  private async downloadClipLocally(taskId: string, remoteUrl: string): Promise<string> {
    await mockAiGenStorage.init();
    const cleanFilename = `runway_${taskId}.mp4`;
    const localRelKey = `mock_ai_gen/runway_clips/${cleanFilename}`;
    const absPath = path.join(mockAiGenStorage.getRoot(), 'runway_clips', cleanFilename);

    try {
      const res = await fetch(remoteUrl);
      if (res.ok) {
        const arrayBuf = await res.arrayBuffer();
        await fsPromises.writeFile(absPath, Buffer.from(arrayBuf));
        return localRelKey;
      }
    } catch (err) {
      logger.error({ taskId, remoteUrl, err }, 'Failed to download Runway clip locally');
    }
    return localRelKey;
  }

  public async getTaskStatus(taskId: string): Promise<{
    taskId: string;
    status: string;
    output?: string[];
    failure?: string;
  }> {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      return { taskId, status: 'BLOCKED', failure: 'RUNWAY_API_KEY not configured' };
    }
    const res = await fetch(`${this.baseUrl}/tasks/${taskId}`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'X-Runway-Version': '2024-11-06',
      },
    });
    if (!res.ok) {
      return { taskId, status: 'FAILED', failure: `Runway API responded with ${res.status}` };
    }
    return (await res.json()) as any;
  }
}

export const mockRunwayClient = new MockRunwayClient();
