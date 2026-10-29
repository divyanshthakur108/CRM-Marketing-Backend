import { Request, Response } from 'express';
import { analyticsService } from './analyticsService.js';
import { sendSuccess } from '../../utils/response.js';

export class AnalyticsController {
  public syncInsights = async (req: Request, res: Response): Promise<void> => {
    const days = req.body?.days ? Number(req.body.days) : 30;
    const result = await analyticsService.syncDailyInsights(req.organizationId!, days);
    sendSuccess(res, result, 200, { message: 'Insights synced successfully' });
  };

  public getOverview = async (req: Request, res: Response): Promise<void> => {
    const options = {
      from: req.query.from ? new Date(req.query.from as string) : undefined,
      to: req.query.to ? new Date(req.query.to as string) : undefined,
      rangePreset: req.query.rangePreset as '7D' | '30D' | '90D' | 'Q4' | undefined,
    };
    const result = await analyticsService.getOverview(req.organizationId!, options);
    sendSuccess(res, result);
  };

  public getCampaigns = async (req: Request, res: Response): Promise<void> => {
    const options = {
      from: req.query.from ? new Date(req.query.from as string) : undefined,
      to: req.query.to ? new Date(req.query.to as string) : undefined,
      rangePreset: req.query.rangePreset as '7D' | '30D' | '90D' | 'Q4' | undefined,
    };
    const result = await analyticsService.getCampaignsAnalytics(req.organizationId!, options);
    sendSuccess(res, result);
  };

  public getContent = async (req: Request, res: Response): Promise<void> => {
    const options = {
      from: req.query.from ? new Date(req.query.from as string) : undefined,
      to: req.query.to ? new Date(req.query.to as string) : undefined,
      rangePreset: req.query.rangePreset as '7D' | '30D' | '90D' | 'Q4' | undefined,
    };
    const result = await analyticsService.getContentAnalytics(req.organizationId!, options);
    sendSuccess(res, result);
  };

  public getLeads = async (req: Request, res: Response): Promise<void> => {
    const options = {
      from: req.query.from ? new Date(req.query.from as string) : undefined,
      to: req.query.to ? new Date(req.query.to as string) : undefined,
      rangePreset: req.query.rangePreset as '7D' | '30D' | '90D' | 'Q4' | undefined,
    };
    const result = await analyticsService.getLeadAnalytics(req.organizationId!, options);
    sendSuccess(res, result);
  };
}

export const analyticsController = new AnalyticsController();
