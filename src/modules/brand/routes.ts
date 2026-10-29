import { Router } from 'express';
import { brandController } from './controller.js';
import { authenticate } from '../../middleware/authenticate.js';
import { resolveTenant } from '../../middleware/resolveTenant.js';
import { authorize } from '../../middleware/authorize.js';
import { asyncHandler } from '../../utils/asyncHandler.js';

const router = Router();

router.use(authenticate);
router.use(resolveTenant);

router.get('/', authorize('brand:read'), asyncHandler(brandController.getBrand));
router.put('/', authorize('brand:manage'), asyncHandler(brandController.updateBrand));

export default router;
