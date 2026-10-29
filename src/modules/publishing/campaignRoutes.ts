import { Router, Request, Response } from 'express';
import { campaignController } from './campaignController.js';
import { authenticate } from '../../middleware/authenticate.js';
import { resolveTenant } from '../../middleware/resolveTenant.js';
import { authorize } from '../../middleware/authorize.js';
import { asyncHandler } from '../../utils/asyncHandler.js';

const router = Router();

router.use(authenticate);
router.use(resolveTenant);

router.get(
  '/',
  authorize('campaigns:read'),
  asyncHandler((req: Request, res: Response) => campaignController.getCampaigns(req, res))
);

router.post(
  '/deploy',
  authorize('campaigns:publish'),
  asyncHandler((req: Request, res: Response) => campaignController.deployCampaign(req, res))
);

router.post(
  '/:id/resume',
  authorize('campaigns:publish'),
  asyncHandler((req: Request, res: Response) => campaignController.resumeCampaign(req, res))
);

router.patch(
  '/:id/status',
  authorize('campaigns:publish'),
  asyncHandler((req: Request, res: Response) => campaignController.updateStatus(req, res))
);

export const campaignsRouter = router;
