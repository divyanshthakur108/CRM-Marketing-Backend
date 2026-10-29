export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: unknown;
  public readonly isOperational: boolean;

  constructor(
    statusCode: number,
    code: string,
    message: string,
    details?: unknown,
    isOperational = true
  ) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.isOperational = isOperational;

    Object.setPrototypeOf(this, new.target.prototype);
    Error.captureStackTrace(this, this.constructor);
  }

  static badRequest(message = 'Bad Request', code = 'BAD_REQUEST', details?: unknown) {
    return new AppError(400, code, message, details);
  }

  static unauthorized(message = 'Unauthorized', code = 'UNAUTHORIZED', details?: unknown) {
    return new AppError(401, code, message, details);
  }

  static forbidden(message = 'Forbidden', code = 'FORBIDDEN', details?: unknown) {
    return new AppError(403, code, message, details);
  }

  static notFound(message = 'Resource not found', code = 'NOT_FOUND', details?: unknown) {
    return new AppError(404, code, message, details);
  }

  static conflict(message = 'Conflict', code = 'CONFLICT', details?: unknown) {
    return new AppError(409, code, message, details);
  }

  static tooManyRequests(
    message = 'Too many requests, please try again later.',
    code = 'RATE_LIMIT_EXCEEDED',
    details?: unknown
  ) {
    return new AppError(429, code, message, details);
  }

  static internal(
    message = 'Internal server error',
    code = 'INTERNAL_SERVER_ERROR',
    details?: unknown
  ) {
    return new AppError(500, code, message, details, false);
  }
}
