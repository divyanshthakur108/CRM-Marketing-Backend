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
import { getTodayGeminiUsage } from './cacheModel.js';
import { searchShots, getContentMemoryStats } from './memorySearch.js';
import { analyzePhotos } from './photoAnalysis.js';
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
  creatorStyle: z
    .object({
      hookText: z.boolean().default(true),
      punchInZoom: z.boolean().default(true),
    })
    .optional(),
  stabilizeShaky: z.boolean().default(true).optional(),
  matchColours: z.boolean().default(true).optional(),
  variants: z
    .union([
      z.number().int().min(1).max(MAX_VARIANTS),
      z.array(z.object({
        captionStyle: z.enum(['POP', 'KARAOKE', 'SLIDE', 'MINIMAL', 'BOXED', 'OUTLINE']).optional(),
      })).min(1).max(MAX_VARIANTS),
    ])
    .default(1),
});

router.post(
  '/assets',
  handleUpload,
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.file) throw AppError.badRequest('No file uploaded (field name must be "file")');
    const folder = req.query.folder === 'library' || (req.body && req.body.folder === 'library') ? 'library' : 'assets';
    const asset = await videoLabService.uploadAsset(req.file, folder);
    sendSuccess(res, asset, 201);
  })
);

const analyzePhotosSchema = z.object({
  photos: z
    .array(
      z.object({
        key: assetKey,
        filename: z.string().max(200).optional(),
        isIllustrative: z.boolean().optional(),
        consentOk: z.boolean().optional(),
      })
    )
    .min(1)
    .max(20),
  force: z.boolean().optional(),
  organizationId: z.string().optional(),
  projectId: z.string().optional(),
});

router.post(
  '/library/analyze-photos',
  validate({ body: analyzePhotosSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { photos, force, organizationId, projectId } = req.body as z.infer<typeof analyzePhotosSchema>;
    for (const p of photos) {
      if (!LAB_ASSET_KEY.test(p.key) || !/\.(png|jpg|jpeg|webp)$/i.test(p.key)) {
        throw AppError.badRequest(`Not a valid Video Lab photo: ${p.key}`);
      }
    }
    const results = await analyzePhotos(photos, { force, organizationId, projectId });
    sendSuccess(res, results);
  })
);

const transcribeSchema = z.object({ clipKey: assetKey, language, force: z.boolean().optional() });
const analyzeSchema = z.object({ clipKey: assetKey, force: z.boolean().optional() });

const requireLabClip = (clipKey: string) => {
  if (!LAB_ASSET_KEY.test(clipKey) || !/\.(mp4|mov|webm)$/.test(clipKey)) throw AppError.badRequest('Not a Video Lab clip');
};

/** Returns today's Gemini request count and configured daily limit. */
router.get(
  '/usage',
  asyncHandler(async (_req: Request, res: Response) => {
    sendSuccess(res, await getTodayGeminiUsage());
  })
);

/** Watches one uploaded clip: shots, what they show, quality, where to cut (ffmpeg + Gemini). */
router.post(
  '/analyze',
  validate({ body: analyzeSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { clipKey, force } = req.body as z.infer<typeof analyzeSchema>;
    requireLabClip(clipKey);
    sendSuccess(res, await analyzeClip(clipKey, force));
  })
);

/** Listens to the speech in one uploaded clip and returns timed captions (Gemini). */
router.post(
  '/transcribe',
  validate({ body: transcribeSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { clipKey, language, force } = req.body as z.infer<typeof transcribeSchema>;
    requireLabClip(clipKey);
    sendSuccess(res, await transcribeClip(clipKey, language, force));
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

/** Content Memory: search saved shots across past clips and reels */
router.get(
  '/memory/shots',
  asyncHandler(async (req: Request, res: Response) => {
    const room = typeof req.query.room === 'string' && req.query.room.trim() ? req.query.room.trim() : undefined;
    const q = typeof req.query.q === 'string' && req.query.q.trim() ? req.query.q.trim() : undefined;
    const excludeRecentDays = req.query.excludeRecentDays ? Number(req.query.excludeRecentDays) : undefined;
    const limit = req.query.limit ? Number(req.query.limit) : 10;
    const organizationId =
      typeof req.query.organizationId === 'string' && req.query.organizationId.trim()
        ? req.query.organizationId.trim()
        : undefined;
    const projectId =
      typeof req.query.projectId === 'string' && req.query.projectId.trim() ? req.query.projectId.trim() : undefined;

    const shots = await searchShots({
      room,
      q,
      excludeRecentDays,
      limit,
      organizationId,
      projectId,
    });
    sendSuccess(res, shots);
  })
);

/** Content Memory: get statistics of saved items and shots */
router.get(
  '/memory/stats',
  asyncHandler(async (req: Request, res: Response) => {
    const organizationId =
      typeof req.query.organizationId === 'string' && req.query.organizationId.trim()
        ? req.query.organizationId.trim()
        : undefined;
    const stats = await getContentMemoryStats({ organizationId });
    sendSuccess(res, stats);
  })
);

export default router;
