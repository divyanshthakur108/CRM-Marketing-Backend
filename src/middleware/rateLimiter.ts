import rateLimit from 'express-rate-limit';
import { Request, Response } from 'express';
import { env } from '../config/env.js';

const rateLimitHandler = (_req: Request, res: Response, _next: unknown, options: { statusCode: number; message: string }) => {
  res.status(options.statusCode).json({
    success: false,
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      message: options.message || 'Too many requests, please try again later.',
    },
  });
};

/**
 * Standard API rate limiter.
 * Applies globally across all general API routes.
 */
export const apiRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: env.NODE_ENV === 'production' ? 100 : 5000, // strict in production (100), relaxed for dev/test/e2e
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many requests from this IP, please try again after 15 minutes.',
  handler: rateLimitHandler,
});

/**
 * Stricter rate limiter for sensitive authentication endpoints (/auth/*).
 */
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: env.NODE_ENV === 'production' ? 10 : 500, // strict in production (10), relaxed in dev/test (500)
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many authentication attempts from this IP, please try again after 15 minutes.',
  handler: rateLimitHandler,
});

/**
 * Custom configurable rate limiter factory.
 */
export const createRateLimiter = (options: {
  windowMs?: number;
  max: number;
  message?: string;
}) => {
  return rateLimit({
    windowMs: options.windowMs || 60 * 1000,
    max: options.max,
    standardHeaders: true,
    legacyHeaders: false,
    message: options.message || 'Too many requests, please try again later.',
    handler: rateLimitHandler,
  });
};
