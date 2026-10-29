import { Router, Request, Response } from 'express';
import { approvalController } from './controller.js';
import { authenticate } from '../../middleware/authenticate.js';
import { resolveTenant } from '../../middleware/resolveTenant.js';
import { authorize } from '../../middleware/authorize.js';
import { asyncHandler } from '../../utils/asyncHandler.js';

const router = Router();

router.use(authenticate);
router.use(resolveTenant);

router.get(
  '/',
  authorize('approvals:read'),
  asyncHandler((req: Request, res: Response) => approvalController.getApprovals(req, res))
);

router.post(
  '/:id/decide',
  authorize('approvals:decide'),
  asyncHandler((req: Request, res: Response) => approvalController.decideApproval(req, res))
);

export const approvalsRouter = router;
