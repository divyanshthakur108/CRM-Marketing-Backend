import { Request, Response } from 'express';
import { adminService } from './service.js';
import { CreateOrgInput, ListOrgsQueryInput, UpdateOrgStatusInput } from './validation.js';
import { sendSuccess } from '../../utils/response.js';
import { AppError } from '../../utils/AppError.js';

export class AdminController {
  public createOrganization = async (req: Request, res: Response): Promise<void> => {
    if (!req.user || !req.user.isPlatformAdmin) {
      throw AppError.forbidden('Platform administrator privileges required', 'PLATFORM_ADMIN_REQUIRED');
    }

    const input = req.body as CreateOrgInput;
    const ip = req.ip || req.socket.remoteAddress;
    const userAgent = req.headers['user-agent'];

    const result = await adminService.createOrganization(
      input,
      { userId: req.user.userId, email: req.user.email },
      ip,
      userAgent
    );

    sendSuccess(res, result, 201, { message: 'Organization and client account created successfully' });
  };

  public listOrganizations = async (req: Request, res: Response): Promise<void> => {
    if (!req.user || !req.user.isPlatformAdmin) {
      throw AppError.forbidden('Platform administrator privileges required', 'PLATFORM_ADMIN_REQUIRED');
    }

    const query = req.query as unknown as ListOrgsQueryInput;
    const result = await adminService.listOrganizations(query);

    sendSuccess(res, result, 200);
  };

  public resendInvite = async (req: Request, res: Response): Promise<void> => {
    if (!req.user || !req.user.isPlatformAdmin) {
      throw AppError.forbidden('Platform administrator privileges required', 'PLATFORM_ADMIN_REQUIRED');
    }

    const orgId = req.params.id;
    const ip = req.ip || req.socket.remoteAddress;
    const userAgent = req.headers['user-agent'];

    const result = await adminService.resendInvite(
      orgId,
      { userId: req.user.userId, email: req.user.email },
      ip,
      userAgent
    );

    sendSuccess(res, result, 200, { message: result.message });
  };

  public updateOrganizationStatus = async (req: Request, res: Response): Promise<void> => {
    if (!req.user || !req.user.isPlatformAdmin) {
      throw AppError.forbidden('Platform administrator privileges required', 'PLATFORM_ADMIN_REQUIRED');
    }

    const orgId = req.params.id;
    const input = req.body as UpdateOrgStatusInput;
    const ip = req.ip || req.socket.remoteAddress;
    const userAgent = req.headers['user-agent'];

    const result = await adminService.updateOrganizationStatus(
      orgId,
      input,
      { userId: req.user.userId, email: req.user.email },
      ip,
      userAgent
    );

    sendSuccess(res, result, 200, { message: 'Organization status updated successfully' });
  };
}

export const adminController = new AdminController();
