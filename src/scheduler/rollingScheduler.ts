import cron, { ScheduledTask } from 'node-cron';
import { PlanItem } from '../models/PlanItem.js';
import { Creative } from '../models/Creative.js';
import { Job } from '../models/Job.js';
import { jobQueue } from '../queue/jobQueue.js';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { Types } from 'mongoose';

export interface RollingSchedulerResult {
  evaluatedCount: number;
  enqueuedJobsCount: number;
  skippedCount: number;
  enqueuedItemIds: string[];
}

export class RollingScheduler {
  private cronJob: ScheduledTask | null = null;

  /**
   * Evaluates all approved plan items across organizations and enqueues
   * creative generation jobs for items within the lead window.
   *
   * @param referenceDate Optional explicit date (useful for fake clock unit tests)
   */
  public async runRollingScheduler(referenceDate?: Date): Promise<RollingSchedulerResult> {
    const now = referenceDate ? new Date(referenceDate) : new Date();
    const leadDays = env.GENERATION_LEAD_DAYS || 7;
    const windowEnd = new Date(now.getTime() + leadDays * 24 * 60 * 60 * 1000);

    logger.info(
      { now: now.toISOString(), windowEnd: windowEnd.toISOString(), leadDays },
      'Executing rolling creative scheduler run'
    );

    // Rule: item APPROVED + publish date within GENERATION_LEAD_DAYS
    const eligibleItems = await PlanItem.find({
      approvalStatus: 'APPROVED',
      publishStatus: { $nin: ['CANCELLED', 'PUBLISHED'] },
      $or: [
        { scheduledAt: { $gte: now, $lte: windowEnd } },
        { scheduledDate: { $gte: now, $lte: windowEnd } },
      ],
    });

    let enqueuedJobsCount = 0;
    let skippedCount = 0;
    const enqueuedItemIds: string[] = [];

    for (const item of eligibleItems) {
      // Check if creative already exists for this item
      const existingCreative = await Creative.findOne({
        organizationId: item.organizationId,
        planItemId: item._id,
      });

      if (existingCreative) {
        skippedCount++;
        continue;
      }

      // Enqueue job with deterministic idempotency key to prevent duplicates
      const idempotencyKey = `gen-creative:${item._id.toString()}`;

      const existingJob = await Job.findOne({
        organizationId: item.organizationId,
        idempotencyKey,
      });

      if (existingJob) {
        skippedCount++;
        continue;
      }

      try {
        await jobQueue.enqueueJob({
          organizationId: item.organizationId,
          idempotencyKey,
          queueName: 'media-rendering',
          jobType: 'GENERATE_CREATIVE',
          payload: {
            planItemId: item._id.toString(),
            organizationId: item.organizationId.toString(),
          },
          maxAttempts: 3,
        });

        enqueuedJobsCount++;
        enqueuedItemIds.push(item._id.toString());
      } catch (err) {
        logger.error({ err, itemId: item._id }, 'Error enqueuing creative job from scheduler');
      }
    }

    logger.info(
      {
        totalEvaluated: eligibleItems.length,
        enqueued: enqueuedJobsCount,
        skipped: skippedCount,
      },
      'Rolling creative scheduler completed run'
    );

    return {
      evaluatedCount: eligibleItems.length,
      enqueuedJobsCount,
      skippedCount,
      enqueuedItemIds,
    };
  }

  /**
   * Recalculates eligibility for a specific plan item upon rescheduling.
   * Cancels stale pending jobs if the item is moved outside the lead window.
   */
  public async handleItemRescheduled(
    organizationId: Types.ObjectId | string,
    planItemId: Types.ObjectId | string,
    newScheduledDate: Date,
    currentDate?: Date
  ): Promise<{ status: 'ENQUEUED' | 'CANCELLED' | 'NOOP'; message: string }> {
    const now = currentDate ? new Date(currentDate) : new Date();
    const leadDays = env.GENERATION_LEAD_DAYS || 7;
    const windowEnd = new Date(now.getTime() + leadDays * 24 * 60 * 60 * 1000);

    const isInsideWindow = newScheduledDate >= now && newScheduledDate <= windowEnd;

    if (!isInsideWindow) {
      // Rescheduling outside window cancels any pending generation job
      const cancelledCount = await jobQueue.cancelPendingJobsForPlanItem(
        organizationId,
        planItemId,
        `Item moved outside generation lead window (${newScheduledDate.toISOString()})`
      );

      return {
        status: 'CANCELLED',
        message: `Item rescheduled outside lead window. Cancelled ${cancelledCount} pending job(s).`,
      };
    }

    // If inside window, verify if item is approved and needs a creative
    const item = await PlanItem.findOne({ _id: planItemId, organizationId });
    if (!item || item.approvalStatus !== 'APPROVED') {
      return { status: 'NOOP', message: 'Item is inside window but not yet approved.' };
    }

    const existingCreative = await Creative.findOne({ organizationId, planItemId });
    if (existingCreative) {
      return { status: 'NOOP', message: 'Creative already exists for this item.' };
    }

    await jobQueue.enqueueJob({
      organizationId,
      idempotencyKey: `gen-creative:${planItemId.toString()}`,
      queueName: 'media-rendering',
      jobType: 'GENERATE_CREATIVE',
      payload: {
        planItemId: planItemId.toString(),
        organizationId: organizationId.toString(),
      },
      maxAttempts: 3,
    });

    return {
      status: 'ENQUEUED',
      message: 'Item rescheduled within lead window. Enqueued generation job.',
    };
  }

  /**
   * Starts daily cron scheduler (runs at 02:00 AM daily by default).
   */
  public startDailyScheduler(cronExpression: string = '0 2 * * *'): ScheduledTask {
    if (this.cronJob) {
      this.cronJob.stop();
    }

    this.cronJob = cron.schedule(cronExpression, async () => {
      try {
        await this.runRollingScheduler();
      } catch (err) {
        logger.error({ err }, 'Error in daily rolling scheduler cron');
      }
    });

    logger.info({ cronExpression }, 'Daily rolling creative scheduler started');
    return this.cronJob;
  }

  public stopDailyScheduler(): void {
    if (this.cronJob) {
      this.cronJob.stop();
      this.cronJob = null;
      logger.info('Daily rolling creative scheduler stopped');
    }
  }
}

export const rollingScheduler = new RollingScheduler();
