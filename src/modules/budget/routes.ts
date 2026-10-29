import { Router, Request, Response } from 'express';
import { budgetController } from './controller.js';
import { authenticate } from '../../middleware/authenticate.js';
import { resolveTenant } from '../../middleware/resolveTenant.js';
import { authorize } from '../../middleware/authorize.js';
import { asyncHandler } from '../../utils/asyncHandler.js';

const router = Router();

router.use(authenticate);
router.use(resolveTenant);

router.get(
  '/:month',
  authorize('budget:read'),
  asyncHandler((req: Request, res: Response) => budgetController.getBudget(req, res))
);

router.put(
  '/:month',
  authorize('budget:write'),
  asyncHandler((req: Request, res: Response) => budgetController.updateBudget(req, res))
);

export const budgetRouter = router;
