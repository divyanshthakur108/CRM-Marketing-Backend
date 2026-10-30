import { Router, Request, Response } from 'express';
import { aiController } from './controller.js';
import {
  generateImageSchema,
  generateCopySchema,
  generateCreativeSchema,
  requestRevisionSchema,
} from './validation.js';
import { validate } from '../../middleware/validate.js';
import { authenticate } from '../../middleware/authenticate.js';
import { resolveTenant } from '../../middleware/resolveTenant.js';
import { authorize } from '../../middleware/authorize.js';
import { asyncHandler } from '../../utils/asyncHandler.js';

const router = Router();

// Public / lightweight generation endpoints (used in quick studio previews)
router.post(
  '/generate-image',
  validate({ body: generateImageSchema }),
  asyncHandler((req: Request, res: Response) => aiController.generateImage(req, res))
);

router.post(
  '/generate-copy',
  validate({ body: generateCopySchema }),
  asyncHandler((req: Request, res: Response) => aiController.generateCopy(req, res))
);

// AI Health & Configuration Status (Platform Admin / Org Owner / Authenticated Member)
router.get(
  '/health',
  authenticate,
  resolveTenant,
  asyncHandler((req: Request, res: Response) => aiController.getAiHealth(req, res))
);

// Cost Estimation before Paid AI Execution
router.post(
  '/estimate-cost',
  authenticate,
  resolveTenant,
  asyncHandler((req: Request, res: Response) => aiController.estimateCost(req, res))
);

// Photo Enhancement (Lighting/cleanup only, preserves original)
router.post(
  '/enhance-photo',
  authenticate,
  resolveTenant,
  authorize('creatives:create'),
  asyncHandler((req: Request, res: Response) => aiController.enhancePhoto(req, res))
);

// Protected Tenant-Scoped Creative Endpoints
router.get(
  '/creatives',
  authenticate,
  resolveTenant,
  authorize('creatives:read'),
  asyncHandler((req: Request, res: Response) => aiController.getCreatives(req, res))
);

router.get(
  '/creatives/:id',
  authenticate,
  resolveTenant,
  authorize('creatives:read'),
  asyncHandler((req: Request, res: Response) => aiController.getCreativeById(req, res))
);

router.post(
  '/creatives/generate',
  authenticate,
  resolveTenant,
  authorize('creatives:create'),
  validate({ body: generateCreativeSchema }),
  asyncHandler((req: Request, res: Response) => aiController.generateCreative(req, res))
);

router.post(
  '/creatives/:id/revision',
  authenticate,
  resolveTenant,
  authorize('creatives:update'),
  validate({ body: requestRevisionSchema }),
  asyncHandler((req: Request, res: Response) => aiController.requestRevision(req, res))
);

// Review Flow Endpoints
router.get(
  '/occasions',
  authenticate,
  resolveTenant,
  asyncHandler((req: Request, res: Response) => aiController.getOccasions(req, res))
);

router.post(
  '/projects/:id/extend-video',
  authenticate,
  resolveTenant,
  authorize('creatives:create'),
  asyncHandler((req: Request, res: Response) => aiController.extendVideo(req, res))
);

router.post(
  '/projects/:id/generate-occasion',
  authenticate,
  resolveTenant,
  authorize('creatives:create'),
  asyncHandler((req: Request, res: Response) => aiController.generateOccasion(req, res))
);

router.post(
  '/projects/:id/generate-creatives',
  authenticate,
  resolveTenant,
  authorize('creatives:create'),
  asyncHandler((req: Request, res: Response) => aiController.triggerProjectCreatives(req, res))
);

router.post(
  '/projects/:id/generate-presenter-video',
  authenticate,
  resolveTenant,
  authorize('creatives:create'),
  asyncHandler((req: Request, res: Response) => aiController.generatePresenterVideo(req, res))
);

router.post(
  '/projects/:id/generate-captions',
  authenticate,
  resolveTenant,
  authorize('creatives:create'),
  asyncHandler((req: Request, res: Response) => aiController.generateCaptions(req, res))
);

router.post(
  '/creatives/:id/approve',
  authenticate,
  resolveTenant,
  authorize('creatives:approve'),
  asyncHandler((req: Request, res: Response) => aiController.approveCreative(req, res))
);

router.post(
  '/creatives/:id/request-changes',
  authenticate,
  resolveTenant,
  authorize('creatives:update'),
  asyncHandler((req: Request, res: Response) => aiController.requestChanges(req, res))
);

router.post(
  '/creatives/:id/reject',
  authenticate,
  resolveTenant,
  authorize('creatives:update'),
  asyncHandler((req: Request, res: Response) => aiController.rejectCreative(req, res))
);

router.post(
  '/creatives/:id/regenerate',
  authenticate,
  resolveTenant,
  authorize('creatives:create'),
  asyncHandler((req: Request, res: Response) => aiController.regenerateCreative(req, res))
);

router.patch(
  '/projects/:id/hero-photo',
  authenticate,
  resolveTenant,
  authorize('creatives:update'),
  asyncHandler((req: Request, res: Response) => aiController.setHeroPhoto(req, res))
);

router.post(
  '/scheduler/trigger',
  authenticate,
  resolveTenant,
  asyncHandler((req: Request, res: Response) => aiController.triggerScheduler(req, res))
);

router.get(
  '/jobs',
  authenticate,
  resolveTenant,
  asyncHandler((req: Request, res: Response) => aiController.getJobs(req, res))
);

// ================= AI STUDIO: 15-SHOT IMAGE & REEL GENERATION ROUTES =================
router.get(
  '/projects/:projectId/studio-batches',
  authenticate,
  resolveTenant,
  authorize('creatives:read'),
  asyncHandler((req: Request, res: Response) => aiController.getStudioBatches(req, res))
);

router.get(
  '/studio-batches/:batchId',
  authenticate,
  resolveTenant,
  authorize('creatives:read'),
  asyncHandler((req: Request, res: Response) => aiController.getStudioBatchById(req, res))
);

router.post(
  '/projects/:projectId/studio-analyze',
  authenticate,
  resolveTenant,
  authorize('creatives:create'),
  asyncHandler((req: Request, res: Response) => aiController.analyzeStudioProperty(req, res))
);

router.post(
  '/projects/:projectId/studio-generate-images',
  authenticate,
  resolveTenant,
  authorize('creatives:create'),
  asyncHandler((req: Request, res: Response) => aiController.generateStudioImages(req, res))
);

router.post(
  '/studio-batches/:batchId/regenerate-image',
  authenticate,
  resolveTenant,
  authorize('creatives:create'),
  asyncHandler((req: Request, res: Response) => aiController.regenerateStudioImage(req, res))
);

router.patch(
  '/studio-batches/:batchId/selection',
  authenticate,
  resolveTenant,
  authorize('creatives:update'),
  asyncHandler((req: Request, res: Response) => aiController.updateStudioSelection(req, res))
);

router.post(
  '/studio-batches/:batchId/generate-reel',
  authenticate,
  resolveTenant,
  authorize('creatives:create'),
  asyncHandler((req: Request, res: Response) => aiController.generateStudioReel(req, res))
);

router.post(
  '/studio-batches/:batchId/reels/:reelId/approval',
  authenticate,
  resolveTenant,
  authorize('creatives:approve'),
  asyncHandler((req: Request, res: Response) => aiController.setStudioReelApproval(req, res))
);

export default router;
