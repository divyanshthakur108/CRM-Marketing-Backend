import { Router, Request, Response, NextFunction } from 'express';
import multer, { MulterError } from 'multer';
import { z } from 'zod';
import { authenticate } from '../../middleware/authenticate.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { AppError } from '../../utils/AppError.js';
import { sendSuccess } from '../../utils/response.js';
import { env } from '../../config/env.js';
import { videoLabService } from './service.js';
import { MAX_VARIANTS, SHOT_CATEGORIES } from './recipe.js';
import { analyzeClip } from './analyze.js';
import { transcribeClip } from './transcribe.js';
import { LAB_ASSET_KEY } from './service.js';

/**
 * Admin Video Lab: test the video-editing pipeline with uploaded files and typed details,
 * without creating any organization or project. Platform admins only.
 */
const router = Router();

const requirePlatformAdmin = (req: Request, _res: Response, next: NextFunction) => {
  if (!req.user?.isPlatformAdmin) {
    return next(AppError.forbidden('Platform administrator privileges required', 'PLATFORM_ADMIN_REQUIRED'));
  }
  next();
};

router.use(authenticate);
router.use(requirePlatformAdmin);

const ALLOWED_MIME = new Set([
  'video/mp4',
  'video/quicktime',
  'video/webm',
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'audio/mpeg',
  'audio/mp3',
  'audio/mp4',
  'audio/x-m4a',
  'audio/aac',
  'audio/wav',
  'audio/x-wav',
  'audio/wave',
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.MEDIA_MAX_VIDEO_MB * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME.has(file.mimetype.toLowerCase())) cb(null, true);
    else cb(AppError.badRequest(`File type '${file.mimetype}' isn't supported. Use MP4/MOV/WebM, PNG/JPG/WebP or MP3/M4A/WAV.`));
  },
});

const handleUpload = (req: Request, res: Response, next: NextFunction) => {
  upload.single('file')(req, res, (err: unknown) => {
    if (err instanceof MulterError) {
      return next(
        AppError.badRequest(
          err.code === 'LIMIT_FILE_SIZE' ? `File is larger than ${env.MEDIA_MAX_VIDEO_MB}MB` : `Upload error: ${err.message}`
        )
      );
    }
    next(err);
  });
};

const assetKey = z.string().min(1).max(200);

const language = z.enum(['hi', 'pa', 'en', 'hinglish']);

const cueSchema = z.object({
  start: z.number().min(0).max(600),
  end: z.number().min(0).max(600),
  text: z.string().max(160),
});

const timeRange = z.object({ start: z.number().min(0).max(3600), end: z.number().min(0).max(3600) });

const shotSchema = z.object({
  start: z.number().min(0).max(3600),
  end: z.number().min(0).max(3600),
  label: z.string().max(120),
  category: z.enum(SHOT_CATEGORIES),
  quality: z.number().int().min(1).max(5),
  hookScore: z.number().int().min(1).max(5),
  issues: z.array(z.string().max(40)).max(20).default([]),
  hasSpeech: z.boolean(),
  bestStart: z.number().min(0).max(3600),
  bestEnd: z.number().min(0).max(3600),
  keep: z.boolean(),
  reason: z.string().max(300).default(''),
});

const createRendersSchema = z.object({
  clips: z
    .array(
      z.object({
        key: assetKey,
        filename: z.string().max(200).optional(),
        durationSeconds: z.number().min(0).max(3600).optional(),
        cues: z.array(cueSchema).max(400).optional(),
        shots: z.array(shotSchema).max(120).optional(),
        silences: z.array(timeRange).max(400).optional(),
      })
    )
    .min(1)
    .max(5),
  logoKey: assetKey.optional(),
  musicKey: assetKey.optional(),
  facts: z.object({
    orgName: z.string().trim().min(1, 'Org name is required').max(80),
    projectName: z.string().trim().min(1, 'Project name is required').max(80),
    phone: z.string().trim().max(30).optional(),
    rera: z.string().trim().max(80).optional(),
  }),
  captions: z.object({
    language,
    source: z.enum(['speech', 'typed']).default('typed'),
    lines: z.array(z.string().max(120)).max(20).default([]),
  }),
  editing: z.enum(['smart', 'whole']).default('whole'),
  targetSeconds: z.number().int().min(8).max(90).optional(),
  variants: z.number().int().min(1).max(MAX_VARIANTS).default(1),
});

router.post(
  '/assets',
  handleUpload,
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.file) throw AppError.badRequest('No file uploaded (field name must be "file")');
    const asset = await videoLabService.uploadAsset(req.file);
    sendSuccess(res, asset, 201);
  })
);

const transcribeSchema = z.object({ clipKey: assetKey, language });
const analyzeSchema = z.object({ clipKey: assetKey });

const requireLabClip = (clipKey: string) => {
  if (!LAB_ASSET_KEY.test(clipKey) || !/\.(mp4|mov|webm)$/.test(clipKey)) throw AppError.badRequest('Not a Video Lab clip');
};

/** Watches one uploaded clip: shots, what they show, quality, where to cut (ffmpeg + Gemini). */
router.post(
  '/analyze',
  validate({ body: analyzeSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { clipKey } = req.body as z.infer<typeof analyzeSchema>;
    requireLabClip(clipKey);
    sendSuccess(res, await analyzeClip(clipKey));
  })
);

/** Listens to the speech in one uploaded clip and returns timed captions (Gemini). */
router.post(
  '/transcribe',
  validate({ body: transcribeSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { clipKey, language } = req.body as z.infer<typeof transcribeSchema>;
    requireLabClip(clipKey);
    sendSuccess(res, await transcribeClip(clipKey, language));
  })
);

router.post(
  '/renders',
  validate({ body: createRendersSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { variants, ...input } = req.body as z.infer<typeof createRendersSchema>;
    const renders = await videoLabService.createRenders(input, variants, req.user!.userId);
    sendSuccess(res, renders, 201, { message: `${renders.length} video(s) queued for rendering` });
  })
);

router.get(
  '/renders',
  asyncHandler(async (_req: Request, res: Response) => {
    sendSuccess(res, await videoLabService.listRenders());
  })
);

router.get(
  '/renders/:id',
  asyncHandler(async (req: Request, res: Response) => {
    sendSuccess(res, await videoLabService.getRender(req.params.id));
  })
);

export default router;
