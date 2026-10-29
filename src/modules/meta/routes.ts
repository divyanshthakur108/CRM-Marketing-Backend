import { Router, Request, Response } from 'express';
import { metaController } from './controller.js';
import { authenticate } from '../../middleware/authenticate.js';
import { resolveTenant } from '../../middleware/resolveTenant.js';
import { authorize } from '../../middleware/authorize.js';
import { asyncHandler } from '../../utils/asyncHandler.js';

const router = Router();

router.use(authenticate);
router.use(resolveTenant);

router.get(
  '/connect-url',
  authorize('campaigns:create'),
  asyncHandler((req: Request, res: Response) => metaController.getConnectUrl(req, res))
);

router.post(
  '/callback',
  authorize('campaigns:create'),
  asyncHandler((req: Request, res: Response) => metaController.handleCallback(req, res))
);

router.get(
  '/status',
  authorize('campaigns:read'),
  asyncHandler((req: Request, res: Response) => metaController.getStatus(req, res))
);

router.post(
  '/disconnect',
  authorize('campaigns:create'),
  asyncHandler((req: Request, res: Response) => metaController.disconnect(req, res))
);

export const metaRouter = router;
