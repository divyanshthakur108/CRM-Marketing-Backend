import { Request, Response, NextFunction } from 'express';
import { logger } from '../config/logger.js';

export const requestLogger = (req: Request, res: Response, next: NextFunction): void => {
  const start = Date.now();
  const reqId = req.id || 'unknown';

  res.on('finish', () => {
    const duration = Date.now() - start;
    const statusCode = res.statusCode;

    const logData = {
      requestId: reqId,
      method: req.method,
      url: req.originalUrl,
      status: statusCode,
      duration: `${duration}ms`,
    };

    if (statusCode >= 500) {
      logger.error(logData, 'HTTP Request Server Error');
    } else if (statusCode >= 400) {
      logger.warn(logData, 'HTTP Request Client Error');
    } else {
      logger.info(logData, 'HTTP Request Completed');
    }
  });

  next();
};
