import { Router } from 'express';
import { audienceController } from './controller.js';
import { authenticate } from '../../middleware/authenticate.js';
import { resolveTenant } from '../../middleware/resolveTenant.js';
import { authorize } from '../../middleware/authorize.js';
import { asyncHandler } from '../../utils/asyncHandler.js';

const router = Router();

router.use(authenticate);
router.use(resolveTenant);

router.get('/', authorize('audience:read'), asyncHandler(audienceController.listBriefs));
router.post('/', authorize('audience:create'), asyncHandler(audienceController.createBrief));
router.get('/:id', authorize('audience:read'), asyncHandler(audienceController.getBrief));
router.patch('/:id', authorize('audience:update'), asyncHandler(audienceController.updateBrief));
router.delete('/:id', authorize('audience:delete'), asyncHandler(audienceController.deleteBrief));

export default router;
