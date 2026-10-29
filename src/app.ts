import express, { Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { env } from './config/env.js';
import { requestId } from './middleware/requestId.js';
import { requestLogger } from './middleware/requestLogger.js';
import { apiRateLimiter } from './middleware/rateLimiter.js';
import { notFoundHandler } from './middleware/notFoundHandler.js';
import { errorHandler } from './middleware/errorHandler.js';

// Modular Routers
import healthRouter from './modules/health/routes.js';
import authRouter from './modules/auth/routes.js';
import aiRouter from './modules/ai/routes.js';
import projectsRouter from './modules/projects/routes.js';
import mediaRouter from './modules/media/routes.js';
import brandRouter from './modules/brand/routes.js';
import audienceRouter from './modules/audience/routes.js';
import { budgetRouter } from './modules/budget/routes.js';
import { plansRouter, planItemsRouter } from './modules/plans/routes.js';
import { approvalsRouter } from './modules/approvals/routes.js';
import { metaRouter } from './modules/meta/routes.js';
import { publishingRouter } from './modules/publishing/routes.js';
import { campaignsRouter } from './modules/publishing/campaignRoutes.js';
import { leadsRouter } from './modules/leads/routes.js';
import { webhooksRouter } from './modules/webhooks/routes.js';
import { analyticsRouter } from './modules/analytics/routes.js';
import { whatsAppRouter } from './modules/whatsapp/routes.js';
import { appointmentRouter } from './modules/appointments/routes.js';
import adminRouter from './modules/admin/routes.js';
import onboardingRouter from './modules/onboarding/routes.js';
import notificationsRouter from './modules/notifications/routes.js';
import path from 'path';

export const createApp = (): Express => {
  const app = express();

  // 1. Request Correlation ID
  app.use(requestId);

  // 2. Structured Request Logging (Pino)
  app.use(requestLogger);

  // 3. Security Headers (Helmet)
  app.use(helmet({ crossOriginResourcePolicy: false }));

  // 4. CORS Allow-List from CLIENT_URL & Local Development Origins
  const isDev = env.NODE_ENV !== 'production';
  const localDevRegex = /^https?:\/\/(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)(:\d+)?$/;
  const configuredOrigins = [
    ...(env.CLIENT_URL ? env.CLIENT_URL.split(',') : []),
    ...(env.CORS_ORIGIN ? env.CORS_ORIGIN.split(',') : []),
  ]
    .map((url) => url.trim())
    .filter(Boolean);

  app.use(
    cors({
      origin: (origin, callback) => {
        // Allow requests with no origin (e.g. mobile apps, curl, server-to-server)
        if (!origin) return callback(null, true);
        if (isDev && localDevRegex.test(origin)) {
          return callback(null, true);
        }
        if (configuredOrigins.includes(origin) || configuredOrigins.includes('*')) {
          return callback(null, true);
        }
        return callback(new Error(`CORS origin ${origin} not permitted`));
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: [
        'Content-Type',
        'Authorization',
        'X-Request-Id',
        'x-organization-id',
        'X-Organization-Id',
      ],
    })
  );

  // 5. Cookie Parser
  app.use(cookieParser());

  // 6. JSON Body Limit (10mb)
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // 6. Static File Storage
  app.use('/storage', express.static(path.resolve(process.cwd(), 'storage')));

  // 7. Global API Rate Limiter
  app.use('/api', apiRateLimiter);

  // 8. Mount Modules (API v1)
  app.use('/api/v1', healthRouter);
  app.use('/api/v1/auth', authRouter);
  app.use('/api/v1/ai', aiRouter);
  app.use('/api/v1/projects', projectsRouter);
  app.use('/api/v1/media', mediaRouter);
  app.use('/api/v1/brand', brandRouter);
  app.use('/api/v1/audience-briefs', audienceRouter);
  app.use('/api/v1/budgets', budgetRouter);
  app.use('/api/v1/plans', plansRouter);
  app.use('/api/v1/plan-items', planItemsRouter);
  app.use('/api/v1/approvals', approvalsRouter);
  app.use('/api/v1/meta', metaRouter);
  app.use('/api/v1/publishing', publishingRouter);
  app.use('/api/v1/campaigns', campaignsRouter);
  app.use('/api/v1/leads', leadsRouter);
  app.use('/api/v1/analytics', analyticsRouter);
  app.use('/api/v1/conversations', whatsAppRouter);
  app.use('/api/v1/appointments', appointmentRouter);
  app.use('/api/v1/admin/organizations', adminRouter);
  app.use('/api/v1/onboarding', onboardingRouter);
  app.use('/api/v1/notifications', notificationsRouter);
  app.use('/api/v1/webhooks', webhooksRouter);
  app.use('/webhooks', webhooksRouter);

  // 9. 404 Handler for Unmatched Routes
  app.use(notFoundHandler);

  // 10. Centralized Error Handler
  app.use(errorHandler);

  return app;
};
