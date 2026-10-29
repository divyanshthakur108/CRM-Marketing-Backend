import { Request, Response } from 'express';
import { publishingService } from './publishingService.js';
import { sendSuccess } from '../../utils/response.js';
import { AppError } from '../../utils/AppError.js';

export class PublishingController {
  async publishOrganicPost(req: Request, res: Response) {
    const orgId = req.organizationId || (req.headers['x-organization-id'] as string);
    if (!orgId) {
      throw AppError.badRequest('Organization context is required');
    }
    const { planItemId } = req.body;
    if (!planItemId) {
      throw AppError.badRequest('planItemId is required for organic publishing');
    }

    const post = await publishingService.publishOrganicPost(orgId, planItemId);
    return sendSuccess(res, post, 201, { message: 'Organic post published successfully' });
  }

  async getPublishingLogs(req: Request, res: Response) {
    const orgId = req.organizationId || (req.headers['x-organization-id'] as string);
    if (!orgId) {
      throw AppError.badRequest('Organization context is required');
    }
    const { platform, status } = req.query as { platform?: string; status?: string };
    const logs = await publishingService.getPublishingLogs(orgId, { platform, status });
    return sendSuccess(res, logs, 200, { message: 'Publishing logs retrieved successfully' });
  }

  async retryPublishingLog(req: Request, res: Response) {
    const orgId = req.organizationId || (req.headers['x-organization-id'] as string);
    if (!orgId) {
      throw AppError.badRequest('Organization context is required');
    }
    const { id } = req.params;
    const post = await publishingService.retryPublishingLog(orgId, id);
    return sendSuccess(res, post, 200, { message: 'Publishing retry dispatched successfully' });
  }
}

export const publishingController = new PublishingController();
