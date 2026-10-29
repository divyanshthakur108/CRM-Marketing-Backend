import { Request, Response } from 'express';
import { metaConnectionService } from './metaConnectionService.js';
import { sendSuccess } from '../../utils/response.js';
import { AppError } from '../../utils/AppError.js';

export class MetaController {
  async getConnectUrl(req: Request, res: Response) {
    const orgId = req.organizationId || (req.headers['x-organization-id'] as string);
    if (!orgId) {
      throw AppError.badRequest('Organization context is required');
    }
    const result = await metaConnectionService.getConnectUrl(orgId);
    return sendSuccess(res, result, 200, { message: 'Meta connect URL generated' });
  }

  async handleCallback(req: Request, res: Response) {
    const orgId = req.organizationId || (req.headers['x-organization-id'] as string);
    if (!orgId) {
      throw AppError.badRequest('Organization context is required');
    }
    const { code } = req.body;
    if (!code) {
      throw AppError.badRequest('Authorization code is required');
    }

    const connection = await metaConnectionService.handleCallback(orgId, code);
    return sendSuccess(res, connection, 200, { message: 'Meta account connected successfully' });
  }

  async getStatus(req: Request, res: Response) {
    const orgId = req.organizationId || (req.headers['x-organization-id'] as string);
    if (!orgId) {
      throw AppError.badRequest('Organization context is required');
    }
    const status = await metaConnectionService.getConnectionStatus(orgId);
    return sendSuccess(res, status, 200, { message: 'Meta connection status retrieved' });
  }

  async disconnect(req: Request, res: Response) {
    const orgId = req.organizationId || (req.headers['x-organization-id'] as string);
    if (!orgId) {
      throw AppError.badRequest('Organization context is required');
    }
    await metaConnectionService.disconnect(orgId);
    return sendSuccess(res, { disconnected: true }, 200, {
      message: 'Meta accounts disconnected successfully',
    });
  }
}

export const metaController = new MetaController();
