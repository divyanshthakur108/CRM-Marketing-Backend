import { Request, Response } from 'express';
import { healthService } from './service.js';
import { sendSuccess } from '../../utils/response.js';

export class HealthController {
  public getHealth = async (req: Request, res: Response): Promise<void> => {
    const isVerbose = req.query.verbose === 'true';
    const health = await healthService.getHealth(isVerbose);
    sendSuccess(res, health);
  };
}

export const healthController = new HealthController();
