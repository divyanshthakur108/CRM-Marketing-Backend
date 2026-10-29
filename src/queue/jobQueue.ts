import { Types } from 'mongoose';
import { Job, IJob, JobType } from '../models/Job.js';
import { logger } from '../config/logger.js';

export interface EnqueueJobInput {
  organizationId: Types.ObjectId | string;
  idempotencyKey: string;
  queueName?: string;
  jobType: JobType;
  payload: Record<string, unknown>;
  maxAttempts?: number;
}

export class JobQueue {
  private toObjectId(id: Types.ObjectId | string): Types.ObjectId {
    return typeof id === 'string' ? new Types.ObjectId(id) : id;
  }

  /**
   * Enqueues a job with a unique idempotency key.
   * If a job with the same key already exists for the organization, returns the existing job.
   */
  public async enqueueJob(input: EnqueueJobInput): Promise<IJob> {
    const orgId = this.toObjectId(input.organizationId);
    const queueName = input.queueName || 'media-rendering';
    const maxAttempts = input.maxAttempts ?? 3;

    // Check for existing job to maintain strict idempotency
    const existing = await Job.findOne({
      organizationId: orgId,
      idempotencyKey: input.idempotencyKey,
    });

    if (existing) {
      return existing;
    }

    try {
      const job = await Job.create({
        organizationId: orgId,
        idempotencyKey: input.idempotencyKey,
        queueName,
        jobType: input.jobType,
        payload: input.payload,
        maxAttempts,
        status: 'PENDING',
        attempts: 0,
      });

      logger.info(
        { jobId: job._id, key: input.idempotencyKey, type: input.jobType },
        'Job successfully enqueued'
      );
      return job;
    } catch (err: unknown) {
      // Handle race condition where another process enqueued the same key
      if (err && typeof err === 'object' && 'code' in err && (err as { code: number }).code === 11000) {
        const raceJob = await Job.findOne({
          organizationId: orgId,
          idempotencyKey: input.idempotencyKey,
        });
        if (raceJob) return raceJob;
      }
      throw err;
    }
  }

  /**
   * Atomically claims the oldest pending job that is ready to run.
   */
  public async claimNextJob(queueName: string = 'media-rendering'): Promise<IJob | null> {
    const now = new Date();

    const job = await Job.findOneAndUpdate(
      {
        queueName,
        status: 'PENDING',
        $or: [
          { nextRunAt: { $exists: false } },
          { nextRunAt: null },
          { nextRunAt: { $lte: now } },
        ],
      },
      {
        $set: {
          status: 'RUNNING',
          startedAt: now,
        },
        $inc: { attempts: 1 },
      },
      {
        sort: { createdAt: 1 },
        new: true,
      }
    );

    return job;
  }

  /**
   * Marks a job as completed with its result payload.
   */
  public async completeJob(
    jobId: Types.ObjectId | string,
    result?: Record<string, unknown>
  ): Promise<IJob | null> {
    return Job.findByIdAndUpdate(
      this.toObjectId(jobId),
      {
        $set: {
          status: 'COMPLETED',
          completedAt: new Date(),
          result: result || {},
        },
      },
      { new: true }
    );
  }

  /**
   * Fails a job with retry backoff or marks as permanently failed.
   */
  public async failJob(
    jobId: Types.ObjectId | string,
    errorMessage: string
  ): Promise<IJob | null> {
    const job = await Job.findById(this.toObjectId(jobId));
    if (!job) return null;

    if (job.attempts < job.maxAttempts) {
      // Exponential backoff: 2^attempts seconds (e.g. 2s, 4s, 8s)
      const delaySeconds = Math.pow(2, job.attempts);
      const nextRunAt = new Date(Date.now() + delaySeconds * 1000);

      job.status = 'PENDING';
      job.nextRunAt = nextRunAt;
      job.errorMessage = errorMessage;
      await job.save();

      logger.warn(
        { jobId: job._id, attempt: job.attempts, nextRunAt, errorMessage },
        'Job execution failed. Scheduled for retry with exponential backoff'
      );
      return job;
    }

    // Permanently failed
    job.status = 'FAILED';
    job.completedAt = new Date();
    job.errorMessage = errorMessage;
    await job.save();

    logger.error(
      { jobId: job._id, attempts: job.attempts, errorMessage },
      'Job exceeded maximum attempts and permanently failed'
    );
    return job;
  }

  /**
   * Cancels pending jobs for a specific plan item (e.g. when rescheduled outside lead window).
   */
  public async cancelPendingJobsForPlanItem(
    organizationId: Types.ObjectId | string,
    planItemId: Types.ObjectId | string,
    reason: string = 'Item rescheduled outside generation lead window'
  ): Promise<number> {
    const orgId = this.toObjectId(organizationId);
    const itemId = this.toObjectId(planItemId);

    const result = await Job.updateMany(
      {
        organizationId: orgId,
        'payload.planItemId': itemId.toString(),
        status: 'PENDING',
      },
      {
        $set: {
          status: 'FAILED',
          completedAt: new Date(),
          errorMessage: reason,
        },
      }
    );

    if (result.modifiedCount > 0) {
      logger.info(
        { organizationId: orgId, planItemId: itemId, cancelledCount: result.modifiedCount },
        'Cancelled pending jobs due to rescheduling'
      );
    }

    return result.modifiedCount;
  }
}

export const jobQueue = new JobQueue();
