import { Router } from 'express';
import { analyticsController } from './analyticsController.js';
import { authenticate } from '../../middleware/authenticate.js';
import { resolveTenant } from '../../middleware/resolveTenant.js';
import { authorize } from '../../middleware/authorize.js';
import { asyncHandler } from '../../utils/asyncHandler.js';

export const analyticsRouter = Router();

analyticsRouter.use(authenticate, resolveTenant);

analyticsRouter.post(
  '/sync',
  authorize('analytics:read'),
  asyncHandler(analyticsController.syncInsights)
);

analyticsRouter.get(
  '/overview',
  authorize('analytics:read'),
  asyncHandler(analyticsController.getOverview)
);

analyticsRouter.get(
  '/campaigns',
  authorize('analytics:read'),
  asyncHandler(analyticsController.getCampaigns)
);

analyticsRouter.get(
  '/content',
  authorize('analytics:read'),
  asyncHandler(analyticsController.getContent)
);

analyticsRouter.get(
  '/leads',
  authorize('analytics:read'),
  asyncHandler(analyticsController.getLeads)
);
