import { Request, Response, NextFunction } from 'express';
import { Membership, IMembership } from '../models/Membership.js';
import { Organization } from '../models/Organization.js';
import { AppError } from '../utils/AppError.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      organizationId?: string;
      membership?: IMembership | {
        organizationId: string;
        userId: string;
        role: string;
        status: string;
      };
    }
  }
}

/**
 * Resolves active tenant context and verifies user membership in the organization
 */
export const resolveTenant = async (
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (!req.user) {
      throw AppError.unauthorized('Authentication required before tenant resolution', 'AUTHENTICATION_REQUIRED');
    }

    // 1. Extract requested organization identifier
    const headerOrgId = req.headers['x-organization-id'] as string | undefined;
    const targetOrgId =
      headerOrgId ||
      (req.query.organizationId as string | undefined) ||
      (req.body && req.body.organizationId as string | undefined);

    // 2. Special bypass for platform administrators
    if (req.user.isPlatformAdmin) {
      if (targetOrgId) {
        const org = await Organization.findById(targetOrgId);
        if (!org) {
          throw AppError.notFound('Target organization not found', 'ORGANIZATION_NOT_FOUND');
        }
        req.organizationId = targetOrgId;
        req.membership = {
          organizationId: targetOrgId,
          userId: req.user.userId,
          role: 'platform_admin',
          status: 'ACTIVE',
        };
      } else {
        // Fallback for platform admin without explicit target org header
        const defaultOrg = await Organization.findOne().sort({ createdAt: 1 });
        if (defaultOrg) {
          const defaultOrgId = defaultOrg._id.toString();
          req.organizationId = defaultOrgId;
          req.membership = {
            organizationId: defaultOrgId,
            userId: req.user.userId,
            role: 'platform_admin',
            status: 'ACTIVE',
          };
        }
      }
      return next();
    }

    // 3. Resolve membership for normal tenant users
    let membership: IMembership | null = null;

    if (targetOrgId) {
      // Validate target org format if it looks like an ObjectId or query by ID
      membership = await Membership.findOne({
        organizationId: targetOrgId,
        userId: req.user.userId,
        status: 'ACTIVE',
      });

      if (!membership) {
        throw AppError.forbidden(
          'You do not have active access to this organization',
          'TENANT_ACCESS_DENIED'
        );
      }
    } else {
      // Fallback: Default to user's first active membership
      membership = await Membership.findOne({
        userId: req.user.userId,
        status: 'ACTIVE',
      }).sort({ createdAt: 1 });

      if (!membership) {
        throw AppError.forbidden(
          'No active organization membership found for user',
          'NO_ACTIVE_MEMBERSHIP'
        );
      }
    }

    req.organizationId = membership.organizationId.toString();
    req.membership = membership;

    next();
  } catch (err) {
    next(err);
  }
};
