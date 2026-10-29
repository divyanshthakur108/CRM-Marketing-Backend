import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      id?: string;
    }
  }
}

export const requestId = (req: Request, res: Response, next: NextFunction): void => {
  const headerId = req.headers['x-request-id'];
  const id = (Array.isArray(headerId) ? headerId[0] : headerId) || crypto.randomUUID();

  req.id = id;
  res.setHeader('X-Request-Id', id);

  next();
};
