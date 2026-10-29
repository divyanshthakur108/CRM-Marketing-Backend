import { Router } from 'express';
import { healthController } from './controller.js';
import { healthQuerySchema } from './validation.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';

const router = Router();

router.get(
  '/health',
  validate({ query: healthQuerySchema }),
  asyncHandler(healthController.getHealth)
);

export default router;
