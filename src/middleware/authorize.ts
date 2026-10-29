import { Request, Response, NextFunction } from 'express';
import { Permission, hasPermission } from '../config/permissions.js';
import { AppError } from '../utils/AppError.js';

/**
 * Middleware factory that enforces role-based permissions from the permission matrix
 */
export const authorize = (permission: Permission) => {
  return (req: Request, _res: Response, next: NextFunction): void => {
    // 1. Platform admin bypasses tenant permission checks
    if (req.user?.isPlatformAdmin) {
      return next();
    }

    // 2. Ensure tenant membership was resolved
    const role = req.membership?.role;
    if (!role) {
      throw AppError.forbidden(
        'Action requires active organization membership context',
        'NO_MEMBERSHIP_CONTEXT'
      );
    }

    // 3. Evaluate against permission matrix
    const isAllowed = hasPermission(role, permission);
    if (!isAllowed) {
      throw AppError.forbidden(
        `Insufficient permissions: role '${role}' lacks '${permission}'`,
        'INSUFFICIENT_PERMISSIONS'
      );
    }

    next();
  };
};
