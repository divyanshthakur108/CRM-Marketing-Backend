import { connectDB } from './config/db.js';
import mongoose from 'mongoose';
import { jobQueue } from './queue/jobQueue.js';
import { creativeService } from './modules/ai/creativeService.js';
import { logger } from './config/logger.js';
import { IJob } from './models/Job.js';

let isRunning = true;

/**
 * Processes a single job if available.
 * Returns true if a job was found and processed, false otherwise.
 */
export async function processNextJob(queueName: string = 'media-rendering'): Promise<IJob | null> {
  const job = await jobQueue.claimNextJob(queueName);
  if (!job) return null;

  logger.info({ jobId: job._id, type: job.jobType }, 'Worker claimed job for execution');

  try {
    if (job.jobType === 'GENERATE_CREATIVE') {
      const { planItemId, organizationId } = job.payload as {
        planItemId: string;
        organizationId: string;
      };

      if (!planItemId || !organizationId) {
        throw new Error('Missing planItemId or organizationId in job payload');
      }

      const creative = await creativeService.generateCreativeForPlanItem(
        organizationId,
        planItemId
      );

      const completed = await jobQueue.completeJob(job._id, {
        creativeId: creative._id.toString(),
        version: creative.version,
        headline: creative.headline,
        status: creative.status,
      });

      logger.info(
        { jobId: job._id, creativeId: creative._id, version: creative.version },
        'Worker successfully completed creative generation job'
      );
      return completed || job;
    } else if (job.jobType === 'PUBLISH_ORGANIC') {
      const { publishingService } = await import('./modules/publishing/publishingService.js');
      const { planItemId, organizationId } = job.payload as {
        planItemId: string;
        organizationId: string;
      };

      const post = await publishingService.publishOrganicPost(organizationId, planItemId);
      const completed = await jobQueue.completeJob(job._id, {
        publishedPostId: post._id.toString(),
        metaPostId: post.metaPostId,
        postUrl: post.postUrl,
        status: post.status,
      });

      logger.info(
        { jobId: job._id, metaPostId: post.metaPostId },
        'Worker successfully completed organic publish job'
      );
      return completed || job;
    } else if (job.jobType === 'PUBLISH_PAID_AD') {
      const { publishingService } = await import('./modules/publishing/publishingService.js');
      const { campaignId, organizationId } = job.payload as {
        campaignId: string;
        organizationId: string;
      };

      const campaign = await publishingService.resumeCampaignDeployment(organizationId, campaignId);
      const completed = await jobQueue.completeJob(job._id, {
        campaignId: campaign._id.toString(),
        metaCampaignId: campaign.metaCampaignId,
        metaAdId: campaign.metaAdId,
        completedSteps: campaign.completedSteps,
        status: campaign.status,
      });

      logger.info(
        { jobId: job._id, metaCampaignId: campaign.metaCampaignId },
        'Worker successfully completed paid ad deployment job'
      );
      return completed || job;
    } else if (job.jobType === 'GENERATE_CREATIVE_SET') {
      const { creativeEngineService } = await import('./modules/ai/creativeEngineService.js');
      await creativeEngineService.processCreativeSetJob(job);
      const completed = await jobQueue.completeJob(job._id, { completedAt: new Date() });
      logger.info({ jobId: job._id }, 'Worker completed creative set generation job');
      return completed || job;
    } else {
      // Future job types or generic no-op completion
      const completed = await jobQueue.completeJob(job._id, { processedAt: new Date() });
      return completed || job;
    }
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown execution error in worker';
    logger.error({ jobId: job._id, err }, 'Worker failed executing job');
    await jobQueue.failJob(job._id, errorMsg);
    return job;
  }
}

/**
 * Continuous polling loop for standalone worker daemon.
 */
export async function startWorkerLoop(pollIntervalMs: number = 1500): Promise<void> {
  logger.info('Starting background worker loop...');
  isRunning = true;

  while (isRunning) {
    try {
      const processed = await processNextJob();
      if (!processed) {
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      }
    } catch (err) {
      logger.error({ err }, 'Unhandled error in worker loop iteration');
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }
  }

  logger.info('Background worker loop stopped cleanly');
}

export function stopWorker(): void {
  isRunning = false;
}

// Standalone execution entry
if (process.argv[1]?.endsWith('worker.ts') || process.argv[1]?.endsWith('worker.js')) {
  (async () => {
    try {
      await connectDB();
      logger.info('Connected to MongoDB for background worker');

      const shutdown = async () => {
        logger.info('Shutting down background worker...');
        stopWorker();
        await mongoose.disconnect();
        process.exit(0);
      };

      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);

      await startWorkerLoop();
    } catch (err) {
      logger.fatal({ err }, 'Worker process startup failure');
      process.exit(1);
    }
  })();
}
