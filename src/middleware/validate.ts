import { Request, Response, NextFunction, RequestHandler } from 'express';
import { ZodSchema, ZodError } from 'zod';
import { AppError } from '../utils/AppError.js';

export interface ValidationSchemas {
  body?: ZodSchema;
  query?: ZodSchema;
  params?: ZodSchema;
}

/**
 * Validation middleware factory supporting body, query, and params schemas.
 */
export const validate = (
  schemaOrSchemas: ZodSchema | ValidationSchemas
): RequestHandler => {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      const isSingleSchema = 'parse' in schemaOrSchemas;
      const schemas: ValidationSchemas = isSingleSchema
        ? { body: schemaOrSchemas as ZodSchema }
        : (schemaOrSchemas as ValidationSchemas);

      if (schemas.body) {
        req.body = await schemas.body.parseAsync(req.body);
      }

      if (schemas.query) {
        req.query = (await schemas.query.parseAsync(req.query)) as typeof req.query;
      }

      if (schemas.params) {
        req.params = (await schemas.params.parseAsync(req.params)) as typeof req.params;
      }

      next();
    } catch (err) {
      if (err instanceof ZodError) {
        const details = err.issues.map((issue) => ({
          field: issue.path.join('.') || 'payload',
          message: issue.message,
        }));

        next(
          AppError.badRequest(
            'Validation failed',
            'VALIDATION_ERROR',
            details
          )
        );
      } else {
        next(err);
      }
    }
  };
};
