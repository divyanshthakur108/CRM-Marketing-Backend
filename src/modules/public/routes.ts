import { Router } from 'express';
import { demoController } from './demoController.js';
import { createDemoRequestSchema } from './demoValidation.js';
import { validate } from '../../middleware/validate.js';
import { createRateLimiter } from '../../middleware/rateLimiter.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { env } from '../../config/env.js';

export const publicRouter = Router();

const publicDemoRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: env.NODE_ENV === 'production' ? 10 : 200, // 10 per 15 min in prod, relaxed in dev
  message: 'Too many demo requests submitted from this IP. Please try again after 15 minutes.',
});

/**
 * Public VIP Demo Booking Endpoint
 * POST /api/v1/public/demo-request
 */
publicRouter.post(
  '/demo-request',
  publicDemoRateLimiter,
  validate({ body: createDemoRequestSchema }),
  asyncHandler(demoController.submitDemoRequest)
);

