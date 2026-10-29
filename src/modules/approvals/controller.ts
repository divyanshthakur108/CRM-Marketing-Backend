import { Request, Response } from 'express';
import { approvalService } from './service.js';
import { decideApprovalSchema } from './validation.js';
import { AppError } from '../../utils/AppError.js';

export class ApprovalController {
  async getApprovals(req: Request, res: Response): Promise<void> {
    const orgId = req.membership?.organizationId;
    if (!orgId) throw AppError.unauthorized('Organization context required');

    const status = req.query.status as string | undefined;
    const approvals = await approvalService.getApprovals(orgId, status);

    res.status(200).json({
      success: true,
      data: approvals,
    });
  }

  async decideApproval(req: Request, res: Response): Promise<void> {
    const orgId = req.membership?.organizationId;
    const userId = req.user?.userId;
    const userName = req.user?.email || 'User';
    const role = req.membership?.role || 'viewer';
    if (!orgId || !userId) throw AppError.unauthorized('Auth context required');

    const validated = decideApprovalSchema.parse(req.body);
    const approval = await approvalService.decideApproval(
      orgId,
      req.params.id,
      userId,
      userName,
      role,
      validated
    );

    res.status(200).json({
      success: true,
      data: approval,
      meta: { message: `Approval item ${approval.status.toLowerCase()}` },
    });
  }
}

export const approvalController = new ApprovalController();
