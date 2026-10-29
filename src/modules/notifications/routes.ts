import { Router } from 'express';
import { notificationsController } from './controller.js';
import { authenticate } from '../../middleware/authenticate.js';
import { resolveTenant } from '../../middleware/resolveTenant.js';
import { asyncHandler } from '../../utils/asyncHandler.js';

const router = Router();

router.use(authenticate);
router.use(resolveTenant);

router.get('/', asyncHandler(notificationsController.getNotifications));
router.patch('/read-all', asyncHandler(notificationsController.markAllRead));
router.patch('/:id/toggle', asyncHandler(notificationsController.toggleRead));

export default router;
