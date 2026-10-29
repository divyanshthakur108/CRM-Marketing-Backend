import { Router, Request, Response } from 'express';
import { planController } from './controller.js';
import { authenticate } from '../../middleware/authenticate.js';
import { resolveTenant } from '../../middleware/resolveTenant.js';
import { authorize } from '../../middleware/authorize.js';
import { asyncHandler } from '../../utils/asyncHandler.js';

// --- Plans Router (/api/v1/plans) ---
const plansRouter = Router();

plansRouter.use(authenticate);
plansRouter.use(resolveTenant);

plansRouter.post(
  '/generate',
  authorize('plans:create'),
  asyncHandler((req: Request, res: Response) => planController.generatePlan(req, res))
);

plansRouter.get(
  '/',
  authorize('plans:read'),
  asyncHandler((req: Request, res: Response) => planController.getPlans(req, res))
);

plansRouter.get(
  '/:id',
  authorize('plans:read'),
  asyncHandler((req: Request, res: Response) => planController.getPlanById(req, res))
);

plansRouter.post(
  '/:id/submit',
  authorize('plans:update'),
  asyncHandler((req: Request, res: Response) => planController.submitPlan(req, res))
);

plansRouter.post(
  '/:id/approve',
  authorize('plans:approve'),
  asyncHandler((req: Request, res: Response) => planController.approvePlan(req, res))
);

plansRouter.post(
  '/:id/request-changes',
  authorize('plans:approve'),
  asyncHandler((req: Request, res: Response) => planController.requestChanges(req, res))
);

// --- Plan Items Router (/api/v1/plan-items) ---
const planItemsRouter = Router();

planItemsRouter.use(authenticate);
planItemsRouter.use(resolveTenant);

planItemsRouter.get(
  '/',
  authorize('plans:read'),
  asyncHandler((req: Request, res: Response) => planController.getPlanItems(req, res))
);

planItemsRouter.post(
  '/',
  authorize('plans:create'),
  asyncHandler((req: Request, res: Response) => planController.createPlanItem(req, res))
);

planItemsRouter.patch(
  '/:id',
  authorize('plans:update'),
  asyncHandler((req: Request, res: Response) => planController.updatePlanItem(req, res))
);

planItemsRouter.patch(
  '/:id/reschedule',
  authorize('plans:update'),
  asyncHandler((req: Request, res: Response) => planController.reschedulePlanItem(req, res))
);

planItemsRouter.patch(
  '/:id/pause',
  authorize('plans:update'),
  asyncHandler((req: Request, res: Response) => planController.pausePlanItem(req, res))
);

planItemsRouter.patch(
  '/:id/resume',
  authorize('plans:update'),
  asyncHandler((req: Request, res: Response) => planController.resumePlanItem(req, res))
);

planItemsRouter.patch(
  '/:id/cancel',
  authorize('plans:update'),
  asyncHandler((req: Request, res: Response) => planController.cancelPlanItem(req, res))
);

planItemsRouter.delete(
  '/:id',
  authorize('plans:update'),
  asyncHandler((req: Request, res: Response) => planController.deletePlanItem(req, res))
);

export { plansRouter, planItemsRouter };
