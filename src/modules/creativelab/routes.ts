import { Router, Request, Response, NextFunction } from 'express';
import multer, { MulterError } from 'multer';
import { z } from 'zod';
import { authenticate } from '../../middleware/authenticate.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { AppError } from '../../utils/AppError.js';
import { sendSuccess } from '../../utils/response.js';
import { env } from '../../config/env.js';
import { getTodayGeminiUsage } from '../videolab/cacheModel.js';
import { creativeLabService } from './service.js';
import { IDEA_TAGS } from './knowledge.js';
import { checkSetup } from './cleanup.js';

/**
 * Admin Creative Lab (POC): type a test project's details, upload its photos and videos,
 * and see the knowledge card the AI writes for every file. Platform admins only.
 */
const router = Router();

router.use(authenticate);
router.use((req: Request, _res: Response, next: NextFunction) => {
  if (!req.user?.isPlatformAdmin) {
    return next(AppError.forbidden('Platform administrator privileges required', 'PLATFORM_ADMIN_REQUIRED'));
  }
  next();
});

const ALLOWED_MIME = new Set(['video/mp4', 'video/quicktime', 'video/webm', 'image/png', 'image/jpeg', 'image/jpg', 'image/webp']);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.MEDIA_MAX_VIDEO_MB * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME.has(file.mimetype.toLowerCase())) cb(null, true);
    else cb(AppError.badRequest(`File type '${file.mimetype}' isn't supported. Use JPG/PNG/WebP photos or MP4/MOV/WebM videos.`));
  },
});

const handleUpload = (req: Request, res: Response, next: NextFunction) => {
  upload.single('file')(req, res, (err: unknown) => {
    if (err instanceof MulterError) {
      return next(
        AppError.badRequest(err.code === 'LIMIT_FILE_SIZE' ? `File is larger than ${env.MEDIA_MAX_VIDEO_MB}MB` : `Upload error: ${err.message}`)
      );
    }
    next(err);
  });
};

const projectSchema = z.object({
  name: z.string().trim().min(1, 'Project name is required').max(120),
  infoText: z.string().trim().max(8000).default(''),
});

/** Today's Gemini requests vs the daily limit */
router.get(
  '/usage',
  asyncHandler(async (_req: Request, res: Response) => {
    sendSuccess(res, await getTodayGeminiUsage());
  })
);

/** What this machine has installed / configured for Creative Lab (shown as a checklist on the page) */
router.get(
  '/setup',
  asyncHandler(async (_req: Request, res: Response) => {
    sendSuccess(res, await checkSetup(env));
  })
);

/** The content ideas a file can be tagged with */
router.get(
  '/ideas',
  asyncHandler(async (_req: Request, res: Response) => {
    sendSuccess(res, IDEA_TAGS);
  })
);

router.get(
  '/projects',
  asyncHandler(async (_req: Request, res: Response) => {
    sendSuccess(res, await creativeLabService.listProjects());
  })
);

/** Creates a test project and turns the typed info into a fact sheet (1 Gemini request) */
router.post(
  '/projects',
  validate({ body: projectSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { name, infoText } = req.body as z.infer<typeof projectSchema>;
    sendSuccess(res, await creativeLabService.createProject(req.user!.userId, name, infoText), 201);
  })
);

router.get(
  '/projects/:id',
  asyncHandler(async (req: Request, res: Response) => {
    sendSuccess(res, await creativeLabService.getProject(req.params.id));
  })
);

/** Updates the typed info and reads the facts again (1 Gemini request) */
router.put(
  '/projects/:id',
  validate({ body: projectSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { name, infoText } = req.body as z.infer<typeof projectSchema>;
    sendSuccess(res, await creativeLabService.updateInfo(req.params.id, name, infoText));
  })
);

/** Deletes the test project with all its files and knowledge cards */
router.delete(
  '/projects/:id',
  asyncHandler(async (req: Request, res: Response) => {
    sendSuccess(res, await creativeLabService.deleteProject(req.params.id));
  })
);

/** Uploads one photo or video; its analysis is queued (1 Gemini request, or 0 if the same file was analyzed before) */
router.post(
  '/projects/:id/assets',
  handleUpload,
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.file) throw AppError.badRequest('No file uploaded (field name: file)');
    sendSuccess(res, await creativeLabService.uploadAsset(req.params.id, req.file, req.user!.userId), 201);
  })
);

router.post(
  '/assets/:assetId/reanalyze',
  asyncHandler(async (req: Request, res: Response) => {
    sendSuccess(res, await creativeLabService.reanalyze(req.params.assetId));
  })
);

/** Step 1 clean-up: fix plan (1 Gemini request, reused) + safe ffmpeg fixes. body { replan?: true, orientation?: ok|upside_down|turn_left|turn_right } */
router.post(
  '/assets/:assetId/clean',
  asyncHandler(async (req: Request, res: Response) => {
    const o = req.body?.orientation;
    const orientation = ['ok', 'upside_down', 'turn_left', 'turn_right'].includes(o) ? o : undefined;
    sendSuccess(res, await creativeLabService.startCleanup(req.params.assetId, req.body?.replan === true, orientation), 202);
  })
);

const cleanedStatusSchema = z.object({ status: z.enum(['APPROVED', 'REJECTED', 'READY']) });
router.post(
  '/assets/:assetId/cleaned/status',
  validate({ body: cleanedStatusSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { status } = req.body as z.infer<typeof cleanedStatusSchema>;
    sendSuccess(res, await creativeLabService.setCleanedStatus(req.params.assetId, status));
  })
);

router.delete(
  '/assets/:assetId',
  asyncHandler(async (req: Request, res: Response) => {
    await creativeLabService.deleteAsset(req.params.assetId);
    sendSuccess(res, { deleted: true });
  })
);

// ── Brand kit, nearby places, map card ─────────────────────────────────────

const IMAGE_MIME = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp']);
const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (IMAGE_MIME.has(file.mimetype.toLowerCase())) cb(null, true);
    else cb(AppError.badRequest('Use a PNG, JPG or WebP image'));
  },
});
const mapStyle = (v: unknown): 'flat' | '3d' => (v === '3d' ? '3d' : 'flat');
const handleImageUpload = (req: Request, res: Response, next: NextFunction) => {
  imageUpload.single('file')(req, res, (err: unknown) => {
    if (err instanceof MulterError) {
      return next(AppError.badRequest(err.code === 'LIMIT_FILE_SIZE' ? 'Image is larger than 8MB' : `Upload error: ${err.message}`));
    }
    next(err);
  });
};

router.put(
  '/projects/:id/logo',
  handleImageUpload,
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.file) throw AppError.badRequest('No file uploaded (field name: file)');
    sendSuccess(res, await creativeLabService.setLogo(req.params.id, req.file));
  })
);

router.delete(
  '/projects/:id/logo',
  asyncHandler(async (req: Request, res: Response) => {
    sendSuccess(res, await creativeLabService.removeLogo(req.params.id));
  })
);

/** Nearby places: [{ name, time?: { value, unit: min|hr }, distance?: { value, unit: km|m } }] */
router.put(
  '/projects/:id/places',
  asyncHandler(async (req: Request, res: Response) => {
    sendSuccess(res, await creativeLabService.setPlaces(req.params.id, req.body?.places));
  })
);

router.get(
  '/projects/:id/map-card/prompt',
  asyncHandler(async (req: Request, res: Response) => {
    const v = req.query.variant !== undefined ? Number(req.query.variant) : undefined;
    sendSuccess(res, await creativeLabService.getMapCardPrompt(req.params.id, Number.isFinite(v) ? v : undefined, mapStyle(req.query.style)));
  })
);

/** Makes a new map card. engine "free" (default): Cloudflare background + exact text drawn by us; "gemini": Gemini draws everything (paid). Calling again = regenerate */
router.post(
  '/projects/:id/map-cards',
  asyncHandler(async (req: Request, res: Response) => {
    const engine = req.body?.engine === 'gemini' ? 'gemini' : 'free';
    sendSuccess(res, await creativeLabService.generateMapCard(req.params.id, mapStyle(req.body?.style), engine), 201);
  })
);

/** Adds a map card made elsewhere (e.g. on the Gemini website with the copied prompt) */
router.post(
  '/projects/:id/map-cards/upload',
  handleImageUpload,
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.file) throw AppError.badRequest('No file uploaded (field name: file)');
    sendSuccess(res, await creativeLabService.uploadMapCard(req.params.id, req.file, mapStyle(req.body?.style)), 201);
  })
);

const mapStatusSchema = z.object({ status: z.enum(['NEEDS_CHECK', 'APPROVED', 'REJECTED']) });
router.post(
  '/projects/:id/map-cards/:cardId/status',
  validate({ body: mapStatusSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { status } = req.body as z.infer<typeof mapStatusSchema>;
    sendSuccess(res, await creativeLabService.setMapCardStatus(req.params.id, req.params.cardId, status));
  })
);

const resultSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(160),
  notes: z.string().trim().max(2000).default(''),
  aiDisclosure: z.string().trim().max(300).default(''),
  tags: z.string().trim().max(400).default(''),
  verdict: z.enum(['USE', 'CHECK', 'DONT_USE']).default('CHECK'),
});

/** Adds a finished reel (MP4) to the project's "Generated results"; no Gemini request */
router.post(
  '/projects/:id/results',
  handleUpload,
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.file) throw AppError.badRequest('No file uploaded (field name: file)');
    const body = resultSchema.parse(req.body);
    sendSuccess(
      res,
      await creativeLabService.addResult(
        req.params.id,
        { buffer: req.file.buffer, filename: req.file.originalname },
        { ...body, tags: body.tags.split(','), source: 'upload', createdBy: req.user!.userId }
      ),
      201
    );
  })
);

/** Removes a result from the page (the video stays in storage) */
router.delete(
  '/results/:resultId',
  asyncHandler(async (req: Request, res: Response) => {
    await creativeLabService.deleteResult(req.params.resultId);
    sendSuccess(res, { deleted: true });
  })
);

export default router;
