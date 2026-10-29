import { Request, Response } from 'express';
import { leadService } from './leadService.js';
import { sendSuccess } from '../../utils/response.js';

export class LeadController {
  public listLeads = async (req: Request, res: Response): Promise<void> => {
    const result = await leadService.listLeads(
      req.organizationId!,
      req.query as unknown as Parameters<typeof leadService.listLeads>[1]
    );
    sendSuccess(res, result);
  };

  public getLead = async (req: Request, res: Response): Promise<void> => {
    const result = await leadService.getLeadById(req.organizationId!, req.params.id);
    sendSuccess(res, result);
  };

  public createLead = async (req: Request, res: Response): Promise<void> => {
    const authorName = req.user?.email || 'Sales Agent';
    const authorId = req.user?.userId;
    const lead = await leadService.createLead(
      req.organizationId!,
      req.body,
      authorName,
      authorId
    );
    sendSuccess(res, lead, 201);
  };

  public updateLead = async (req: Request, res: Response): Promise<void> => {
    const authorName = req.user?.email || 'Sales Agent';
    const authorId = req.user?.userId;
    const lead = await leadService.updateLead(
      req.organizationId!,
      req.params.id,
      req.body,
      authorName,
      authorId
    );
    sendSuccess(res, lead, 200);
  };

  public addTimelineEntry = async (req: Request, res: Response): Promise<void> => {
    const authorName = req.user?.email || 'Sales Agent';
    const authorId = req.user?.userId;
    const { type, summary, details } = req.body;

    const activity = await leadService.addTimelineEntry(
      req.organizationId!,
      req.params.id,
      type,
      summary,
      details,
      authorName,
      authorId
    );
    sendSuccess(res, activity, 201);
  };

  public deleteLead = async (req: Request, res: Response): Promise<void> => {
    await leadService.deleteLead(req.organizationId!, req.params.id);
    sendSuccess(res, { deleted: true }, 200);
  };
}

export const leadController = new LeadController();
