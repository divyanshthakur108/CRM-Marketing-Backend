import { Request, Response } from 'express';
import { audienceService } from './service.js';
import { createAudienceBriefSchema, updateAudienceBriefSchema } from './validation.js';
import { AppError } from '../../utils/AppError.js';

class AudienceController {
  public listBriefs = async (req: Request, res: Response): Promise<void> => {
    if (!req.membership) {
      throw AppError.forbidden('Organization membership required');
    }

    const { projectId } = req.query;
    const briefs = await audienceService.listBriefs(
      req.membership.organizationId,
      projectId as string
    );

    res.status(200).json({
      success: true,
      data: briefs,
    });
  };

  public getBrief = async (req: Request, res: Response): Promise<void> => {
    if (!req.membership) {
      throw AppError.forbidden('Organization membership required');
    }

    const brief = await audienceService.getBriefById(
      req.membership.organizationId,
      req.params.id
    );

    res.status(200).json({
      success: true,
      data: brief,
    });
  };

  public createBrief = async (req: Request, res: Response): Promise<void> => {
    if (!req.membership) {
      throw AppError.forbidden('Organization membership required');
    }

    const validated = createAudienceBriefSchema.parse(req.body);
    const brief = await audienceService.createBrief(
      req.membership.organizationId,
      validated
    );

    res.status(201).json({
      success: true,
      data: brief,
      message: 'Audience brief created successfully',
    });
  };

  public updateBrief = async (req: Request, res: Response): Promise<void> => {
    if (!req.membership) {
      throw AppError.forbidden('Organization membership required');
    }

    const validated = updateAudienceBriefSchema.parse(req.body);
    const brief = await audienceService.updateBrief(
      req.membership.organizationId,
      req.params.id,
      validated
    );

    res.status(200).json({
      success: true,
      data: brief,
      message: 'Audience brief updated successfully',
    });
  };

  public deleteBrief = async (req: Request, res: Response): Promise<void> => {
    if (!req.membership) {
      throw AppError.forbidden('Organization membership required');
    }

    await audienceService.deleteBrief(
      req.membership.organizationId,
      req.params.id
    );

    res.status(200).json({
      success: true,
      message: 'Audience brief deleted successfully',
    });
  };
}

export const audienceController = new AudienceController();
