import { Router } from 'express';
import { onboardingController } from './controller.js';
import { authenticate } from '../../middleware/authenticate.js';
import { resolveTenant } from '../../middleware/resolveTenant.js';
import { asyncHandler } from '../../utils/asyncHandler.js';

const router = Router();

// Protect all onboarding routes with user authentication and tenant isolation context
router.use(authenticate);
router.use(resolveTenant);

// 1. GET /api/v1/onboarding -> { currentStep, data, status }
router.get('/', asyncHandler(onboardingController.getOnboarding));

// 2. PUT /api/v1/onboarding/steps/:step (1 to 4): validates and saves step draft
router.put('/steps/:step', asyncHandler(onboardingController.saveStep));

// 3. POST /api/v1/onboarding/submit: requires all 4 steps valid
router.post('/submit', asyncHandler(onboardingController.submitOnboarding));

export default router;
