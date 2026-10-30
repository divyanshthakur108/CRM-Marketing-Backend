import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { z } from 'zod';

// Ensure environment variables are loaded
const candidateEnvPaths = [
  path.resolve(process.cwd(), '.env'),
  path.resolve(process.cwd(), 'backend', '.env'),
  path.resolve(process.cwd(), '..', '.env'),
];
for (const p of candidateEnvPaths) {
  if (fs.existsSync(p)) {
    dotenv.config({ path: p });
    break;
  }
}
dotenv.config();

const envSchema = z.object({
  PORT: z.coerce.number().default(5000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
  MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),
  CLIENT_URL: z.string().default('http://localhost:5173'),
  CORS_ORIGIN: z.string().optional(),
  GEMINI_API_KEY: z.string().optional().default(''),
  AI_PROVIDER: z.enum(['mock', 'gemini', 'none']).default('mock'),
  GEMINI_IMAGE_MODEL: z.string().default('imagen-3.0-generate-002'),
  GEMINI_VIDEO_MODEL: z.string().default('veo-2.0-generate-001'),
  AI_DAILY_COST_CAP_USD: z.coerce.number().default(25.0),
  AI_MAX_VIDEO_SECONDS_PER_REEL: z.coerce.number().default(25),
  REEL_MUSIC_PATH: z.string().optional(),
  FFMPEG_PATH: z.string().optional(),
  GENERATION_LEAD_DAYS: z.coerce.number().default(7),
  META_ADAPTER: z.enum(['mock', 'meta']).default('mock'),
  ENCRYPTION_KEY: z.string().default('realcrm_secure_token_encryption_key_32_bytes_len_2026'),
  JWT_SECRET: z.string().default('realcrm_enterprise_jwt_access_secret_key_2026_xyz'),
  JWT_REFRESH_SECRET: z.string().default('realcrm_enterprise_jwt_refresh_secret_key_2026_abc'),
  JWT_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),
  ADMIN_EMAIL: z.string().email().default('admin@realcrm.in'),
  ADMIN_PASSWORD: z.string().min(8).default('AdminPassword123!'),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().default('RealCRM Platform <no-reply@realcrm.in>'),
  MEDIA_MAX_IMAGE_MB: z.coerce.number().default(10),
  MEDIA_MAX_VIDEO_MB: z.coerce.number().default(200),
  MEDIA_MAX_PDF_MB: z.coerce.number().default(20),
  MEDIA_MAX_FILES_PER_PROJECT: z.coerce.number().default(100),
  MEDIA_UPLOAD_RATE_LIMIT: z.coerce.number().default(120),
});

const parseEnv = () => {
  const result = envSchema.safeParse({
    PORT: process.env.PORT,
    NODE_ENV: process.env.NODE_ENV,
    LOG_LEVEL: process.env.LOG_LEVEL,
    MONGODB_URI: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/real_estate_ai_crm',
    CLIENT_URL: process.env.CLIENT_URL || process.env.CORS_ORIGIN || 'http://localhost:5173',
    CORS_ORIGIN: process.env.CORS_ORIGIN,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY || '',
    AI_PROVIDER: (process.env.AI_PROVIDER as 'mock' | 'gemini' | 'none') || 'mock',
    GEMINI_IMAGE_MODEL: process.env.GEMINI_IMAGE_MODEL || 'imagen-3.0-generate-002',
    GEMINI_VIDEO_MODEL: process.env.GEMINI_VIDEO_MODEL || 'veo-2.0-generate-001',
    AI_DAILY_COST_CAP_USD: process.env.AI_DAILY_COST_CAP_USD ? parseFloat(process.env.AI_DAILY_COST_CAP_USD) : 25.0,
    AI_MAX_VIDEO_SECONDS_PER_REEL: process.env.AI_MAX_VIDEO_SECONDS_PER_REEL ? parseInt(process.env.AI_MAX_VIDEO_SECONDS_PER_REEL, 10) : 25,
    REEL_MUSIC_PATH: process.env.REEL_MUSIC_PATH,
    FFMPEG_PATH: process.env.FFMPEG_PATH,
    GENERATION_LEAD_DAYS: process.env.GENERATION_LEAD_DAYS ? parseInt(process.env.GENERATION_LEAD_DAYS, 10) : 7,
    META_ADAPTER: (process.env.META_ADAPTER as 'mock' | 'meta') || 'mock',
    ENCRYPTION_KEY: process.env.ENCRYPTION_KEY || 'realcrm_secure_token_encryption_key_32_bytes_len_2026',
    JWT_SECRET: process.env.JWT_SECRET || 'realcrm_enterprise_jwt_access_secret_key_2026_xyz',
    JWT_REFRESH_SECRET:
      process.env.JWT_REFRESH_SECRET || 'realcrm_enterprise_jwt_refresh_secret_key_2026_abc',
    JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '15m',
    JWT_REFRESH_EXPIRES_IN: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
    ADMIN_EMAIL: process.env.ADMIN_EMAIL || 'admin@realcrm.in',
    ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || 'AdminPassword123!',
    SMTP_HOST: process.env.SMTP_HOST,
    SMTP_PORT: process.env.SMTP_PORT,
    SMTP_USER: process.env.SMTP_USER,
    SMTP_PASS: process.env.SMTP_PASS || process.env.SMTP_PASSWORD,
    SMTP_FROM: process.env.SMTP_FROM || 'RealCRM Platform <no-reply@realcrm.in>',
    MEDIA_MAX_IMAGE_MB: process.env.MEDIA_MAX_IMAGE_MB ? parseInt(process.env.MEDIA_MAX_IMAGE_MB, 10) : 10,
    MEDIA_MAX_VIDEO_MB: process.env.MEDIA_MAX_VIDEO_MB ? parseInt(process.env.MEDIA_MAX_VIDEO_MB, 10) : 200,
    MEDIA_MAX_PDF_MB: process.env.MEDIA_MAX_PDF_MB ? parseInt(process.env.MEDIA_MAX_PDF_MB, 10) : 20,
    MEDIA_MAX_FILES_PER_PROJECT: process.env.MEDIA_MAX_FILES_PER_PROJECT ? parseInt(process.env.MEDIA_MAX_FILES_PER_PROJECT, 10) : 100,
    MEDIA_UPLOAD_RATE_LIMIT: process.env.MEDIA_UPLOAD_RATE_LIMIT ? parseInt(process.env.MEDIA_UPLOAD_RATE_LIMIT, 10) : 120,
  });

  if (!result.success) {
    console.error('❌ Invalid or missing environment configuration:');
    result.error.issues.forEach((issue) => {
      console.error(` - ${issue.path.join('.')}: ${issue.message}`);
    });
    process.exit(1);
  }

  return result.data;
};

export const maskSecret = (secret?: string | null): string => {
  if (!secret) return '[NOT CONFIGURED]';
  if (secret.length <= 8) return '****';
  return `${secret.substring(0, 4)}...${secret.substring(secret.length - 4)}`;
};

export const env = parseEnv();
export type Env = z.infer<typeof envSchema>;
