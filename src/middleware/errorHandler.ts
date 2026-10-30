import { Request, Response, NextFunction, ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../utils/AppError.js';
import { logger } from '../config/logger.js';
import { env } from '../config/env.js';

export interface ErrorResponsePayload {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export const errorHandler: ErrorRequestHandler = (
  err: Error | AppError,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction
): void => {
  let statusCode = 500;
  let code = 'INTERNAL_SERVER_ERROR';
  let message = 'An unexpected server error occurred';
  let details: unknown = undefined;

  // 1. Handled AppError
  if (err instanceof AppError) {
    statusCode = err.statusCode;
    code = err.code;
    message = err.message;
    details = err.details;
  }
  // 2. Direct Zod Error fallback
  else if (err instanceof ZodError) {
    statusCode = 400;
    code = 'VALIDATION_ERROR';
    message = 'Validation failed';
    details = err.issues.map((issue) => ({
      field: issue.path.join('.') || 'payload',
      message: issue.message,
    }));
  }
  // 3. Mongoose Validation Error
  else if (err.name === 'ValidationError' || (err as unknown as Record<string, unknown>).name === 'ValidationError') {
    statusCode = 400;
    code = 'VALIDATION_ERROR';
    message = err.message || 'Database validation failed';
    const mongooseErrors = (err as unknown as { errors?: Record<string, { message?: string }> }).errors;
    if (mongooseErrors && typeof mongooseErrors === 'object') {
      details = Object.keys(mongooseErrors).map((key) => ({
        field: key,
        message: mongooseErrors[key]?.message || 'Invalid value',
      }));
    }
  }
  // 4. Mongoose Cast Error / BSON Error (Invalid ObjectId)
  else if (
    err.name === 'CastError' ||
    (err as unknown as Record<string, unknown>).name === 'CastError' ||
    err.name === 'BSONError' ||
    (err as unknown as Record<string, unknown>).name === 'BSONError'
  ) {
    statusCode = 400;
    code = 'INVALID_IDENTIFIER';
    const castErr = err as unknown as { path?: string; value?: unknown };
    message = `Invalid format for ${castErr.path || 'identifier'}: ${castErr.value || 'invalid parameter'}`;
  }
  // 5. MongoDB Duplicate Key (E11000)
  else if ((err as unknown as { code?: number }).code === 11000) {
    statusCode = 409;
    code = 'DUPLICATE_RESOURCE';
    const keyValue = (err as unknown as { keyValue?: Record<string, unknown> }).keyValue;
    const fields = keyValue ? Object.keys(keyValue).join(', ') : 'field';
    message = `A resource with this ${fields} already exists`;
  }
  // 6. Malformed JSON Body
  else if (err instanceof SyntaxError && 'status' in err && (err as { status: number }).status === 400) {
    statusCode = 400;
    code = 'INVALID_JSON';
    message = 'Malformed JSON in request payload';
  }
  // 4. Unexpected / Unhandled Error
  else {
    logger.error(
      {
        requestId: req.id,
        err,
        method: req.method,
        url: req.originalUrl,
      },
      'Unhandled Application Exception'
    );

    if (env.NODE_ENV !== 'production') {
      message = err.message || message;
    }
  }

  const payload: ErrorResponsePayload = {
    success: false,
    error: {
      code,
      message,
      ...(details !== undefined ? { details } : {}),
    },
  };

  res.status(statusCode).json(payload);
};
