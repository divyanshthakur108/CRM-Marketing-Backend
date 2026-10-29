import { Router } from 'express';
import { adminController } from './controller.js';
import { createOrgSchema, updateOrgStatusSchema, listOrgsQuerySchema } from './validation.js';
import { authenticate } from '../../middleware/authenticate.js';
import { validate } from '../../middleware/validate.js';
import { authRateLimiter } from '../../middleware/rateLimiter.js';
import { asyncHandler } from '../../utils/asyncHandler.js';

const router = Router();

// Apply auth rate limiter and authenticate middleware across all admin routes
router.use(authRateLimiter);
router.use(authenticate);

// 1. Create Organization + Client User + 48h Invitation
router.post(
  '/',
  validate({ body: createOrgSchema }),
  asyncHandler(adminController.createOrganization)
);

// 2. List Organizations with Search, Pagination, & Onboarding Status
router.get(
  '/',
  validate({ query: listOrgsQuerySchema }),
  asyncHandler(adminController.listOrganizations)
);

// 3. Resend Client Invitation
router.post(
  '/:id/resend-invite',
  asyncHandler(adminController.resendInvite)
);

// 4. Update Organization Status (Enable / Disable)
router.patch(
  '/:id/status',
  validate({ body: updateOrgStatusSchema }),
  asyncHandler(adminController.updateOrganizationStatus)
);

export default router;
