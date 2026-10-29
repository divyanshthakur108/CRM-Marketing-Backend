import { Request, Response } from 'express';
import { publishingService } from './publishingService.js';
import { sendSuccess } from '../../utils/response.js';
import { AppError } from '../../utils/AppError.js';

export class CampaignController {
  async getCampaigns(req: Request, res: Response) {
    const orgId = req.organizationId || (req.headers['x-organization-id'] as string);
    if (!orgId) {
      throw AppError.badRequest('Organization context is required');
    }
    const { status } = req.query as { status?: string };
    const campaigns = await publishingService.getCampaigns(orgId, status);
    return sendSuccess(res, campaigns, 200, { message: 'Campaigns retrieved successfully' });
  }

  async deployCampaign(req: Request, res: Response) {
    const orgId = req.organizationId || (req.headers['x-organization-id'] as string);
    if (!orgId) {
      throw AppError.badRequest('Organization context is required');
    }
    const { projectId, planItemId, creativeId, name, dailyBudget, objective, targeting } = req.body;

    if (!projectId || !creativeId || !name || dailyBudget === undefined) {
      throw AppError.badRequest('projectId, creativeId, name, and dailyBudget are required');
    }

    const campaign = await publishingService.deployPaidAdCampaign(orgId, {
      projectId,
      planItemId,
      creativeId,
      name,
      dailyBudget: Number(dailyBudget),
      objective,
      targeting,
    });

    return sendSuccess(res, campaign, 201, { message: 'Paid ad campaign deployed successfully' });
  }

  async resumeCampaign(req: Request, res: Response) {
    const orgId = req.organizationId || (req.headers['x-organization-id'] as string);
    if (!orgId) {
      throw AppError.badRequest('Organization context is required');
    }
    const { id } = req.params;

    const campaign = await publishingService.resumeCampaignDeployment(orgId, id);
    return sendSuccess(res, campaign, 200, {
      message: 'Campaign deployment resumed and completed successfully',
    });
  }

  async updateStatus(req: Request, res: Response) {
    const orgId = req.organizationId || (req.headers['x-organization-id'] as string);
    if (!orgId) {
      throw AppError.badRequest('Organization context is required');
    }
    const { id } = req.params;
    const { status } = req.body;

    if (!['ACTIVE', 'PAUSED'].includes(status)) {
      throw AppError.badRequest('Status must be either ACTIVE or PAUSED');
    }

    const campaign = await publishingService.updateCampaignStatus(orgId, id, status);
    return sendSuccess(res, campaign, 200, { message: `Campaign status updated to ${status}` });
  }
}

export const campaignController = new CampaignController();
