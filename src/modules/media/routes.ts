import { Router, Request, Response, NextFunction } from 'express';
import multer, { MulterError } from 'multer';
import rateLimit from 'express-rate-limit';
import { mediaController } from './controller.js';
import { authenticate } from '../../middleware/authenticate.js';
import { resolveTenant } from '../../middleware/resolveTenant.js';
import { authorize } from '../../middleware/authorize.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { AppError } from '../../utils/AppError.js';
import { env } from '../../config/env.js';

const router = Router();

// Allowed MIME types across images, videos, and PDFs
const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/pjpeg',
  'image/png',
  'image/x-png',
  'image/webp',
  'image/gif',
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'application/pdf',
]);

// 200MB upper bound for multer (video limit). Specific per-type limits enforced by fileSignature validation
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: env.MEDIA_MAX_VIDEO_MB * 1024 * 1024,
  },
  fileFilter: (_req, file, cb) => {
    const mime = file.mimetype.toLowerCase();
    if (ALLOWED_MIME_TYPES.has(mime)) {
      cb(null, true);
    } else {
      cb(
        AppError.badRequest(
          `Invalid file type '${file.mimetype}'. Only images (JPG, PNG, WebP), videos (MP4, MOV, WebM), and brochures (PDF) are allowed.`
        )
      );
    }
  },
});

const handleMulterUpload = (req: Request, res: Response, next: NextFunction) => {
  upload.single('file')(req, res, (err: unknown) => {
    if (err) {
      if (err instanceof MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return next(AppError.badRequest(`File size exceeds maximum allowable limit of ${env.MEDIA_MAX_VIDEO_MB}MB`));
        }
        return next(AppError.badRequest(`File upload error: ${err.message}`));
      }
      return next(err);
    }
    next();
  });
};

const uploadRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: env.MEDIA_UPLOAD_RATE_LIMIT,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many media uploads from this client. Please try again later.',
  },
});

// All media endpoints require authentication (Bearer token or httpOnly cookie)
router.use(authenticate);

// Direct media streaming and thumbnail endpoints (supports <img>/<video> tags with cookies)
router.get('/:id/file', asyncHandler(mediaController.getMediaFile));
router.get('/:id/thumbnail', asyncHandler(mediaController.getMediaThumbnail));

// Tenant-scoped management endpoints
router.use(resolveTenant);

router.get('/', authorize('media:read'), asyncHandler(mediaController.listMedia));
router.post(
  '/',
  authorize('media:upload'),
  uploadRateLimiter,
  handleMulterUpload,
  asyncHandler(mediaController.uploadMedia)
);
router.post('/reorder', authorize('media:update'), asyncHandler(mediaController.reorderMedia));
router.get('/:id', authorize('media:read'), asyncHandler(mediaController.getMedia));
router.patch('/:id', authorize('media:update'), asyncHandler(mediaController.patchMedia));
router.delete('/:id', authorize('media:delete'), asyncHandler(mediaController.deleteMedia));

export default router;
