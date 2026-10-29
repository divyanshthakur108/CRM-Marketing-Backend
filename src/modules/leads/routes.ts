import { Router } from 'express';
import { leadController } from './leadController.js';
import {
  createLeadSchema,
  updateLeadSchema,
  leadQuerySchema,
  addTimelineEntrySchema,
} from './leadValidation.js';
import { authenticate } from '../../middleware/authenticate.js';
import { resolveTenant } from '../../middleware/resolveTenant.js';
import { authorize } from '../../middleware/authorize.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';

export const leadsRouter = Router();

// Enforce authentication and active tenant resolution
leadsRouter.use(authenticate, resolveTenant);

leadsRouter.get(
  '/',
  authorize('leads:read'),
  validate({ query: leadQuerySchema }),
  asyncHandler(leadController.listLeads)
);

leadsRouter.get(
  '/:id',
  authorize('leads:read'),
  asyncHandler(leadController.getLead)
);

leadsRouter.post(
  '/',
  authorize('leads:write'),
  validate({ body: createLeadSchema }),
  asyncHandler(leadController.createLead)
);

leadsRouter.patch(
  '/:id',
  authorize('leads:write'),
  validate({ body: updateLeadSchema }),
  asyncHandler(leadController.updateLead)
);

leadsRouter.post(
  '/:id/timeline',
  authorize('leads:write'),
  validate({ body: addTimelineEntrySchema }),
  asyncHandler(leadController.addTimelineEntry)
);

leadsRouter.delete(
  '/:id',
  authorize('leads:write'),
  asyncHandler(leadController.deleteLead)
);
