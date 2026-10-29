import { Router, Request, Response } from 'express';
import { publishingController } from './controller.js';
import { authenticate } from '../../middleware/authenticate.js';
import { resolveTenant } from '../../middleware/resolveTenant.js';
import { authorize } from '../../middleware/authorize.js';
import { asyncHandler } from '../../utils/asyncHandler.js';

const router = Router();

router.use(authenticate);
router.use(resolveTenant);

router.post(
  '/organic',
  authorize('campaigns:publish'),
  asyncHandler((req: Request, res: Response) => publishingController.publishOrganicPost(req, res))
);

router.get(
  '/logs',
  authorize('campaigns:read'),
  asyncHandler((req: Request, res: Response) => publishingController.getPublishingLogs(req, res))
);

router.post(
  '/logs/:id/retry',
  authorize('campaigns:publish'),
  asyncHandler((req: Request, res: Response) => publishingController.retryPublishingLog(req, res))
);

export const publishingRouter = router;
