import { Request, Response, NextFunction } from 'express';
import { Types } from 'mongoose';
import { Membership, IMembership } from '../models/Membership.js';
import { Organization } from '../models/Organization.js';
import { Project } from '../models/Project.js';
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

const isValidObjectId = (val?: string | null): boolean => {
  return Boolean(
    val &&
    val !== 'platform-root' &&
    val !== 'undefined' &&
    val !== 'null' &&
    typeof val === 'string' &&
    val.length === 24 &&
    Types.ObjectId.isValid(val)
  );
};

/**
 * Resolves active tenant context and verifies user membership in the organization.
 * Gracefully handles platform administrators and avoids Mongoose CastError on non-ObjectId tenant strings.
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
    const rawTargetOrgId =
      headerOrgId ||
      (req.query.organizationId as string | undefined) ||
      (req.body && (req.body.organizationId as string | undefined));

    const targetOrgId = isValidObjectId(rawTargetOrgId) ? rawTargetOrgId : undefined;

    // 2. Special bypass and multi-tenant resolution for platform administrators
    if (req.user.isPlatformAdmin) {
      // 2a. If an explicit, valid organization ID was requested, use it
      if (targetOrgId) {
        const org = await Organization.findById(targetOrgId);
        if (org) {
          const orgIdStr = org._id.toString();
          req.organizationId = orgIdStr;
          req.membership = {
            organizationId: orgIdStr,
            userId: req.user.userId,
            role: 'platform_admin',
            status: 'ACTIVE',
          };
          return next();
        }
      }

      // 2b. If accessing a specific project, automatically adopt that project's organization
      const urlProjectMatch = req.originalUrl?.match(/\/projects\/([0-9a-fA-F]{24})/);
      const candidateProjectId =
        (isValidObjectId(req.params?.id) ? req.params.id : undefined) ||
        (isValidObjectId(req.params?.projectId) ? req.params.projectId : undefined) ||
        (isValidObjectId(req.body?.projectId) ? req.body.projectId : undefined) ||
        (isValidObjectId(req.query?.projectId as string) ? (req.query.projectId as string) : undefined) ||
        urlProjectMatch?.[1];

      if (candidateProjectId && isValidObjectId(candidateProjectId)) {
        try {
          const project = await Project.findById(candidateProjectId);
          if (project?.organizationId) {
            const projectOrgId = project.organizationId.toString();
            req.organizationId = projectOrgId;
            req.membership = {
              organizationId: projectOrgId,
              userId: req.user.userId,
              role: 'platform_admin',
              status: 'ACTIVE',
            };
            return next();
          }
        } catch {
          // If project lookup fails, continue to default tenant resolution
        }
      }

      // 2c. Check if admin has an existing active organization membership
      const adminMembership = await Membership.findOne({
        userId: req.user.userId,
        status: 'ACTIVE',
      }).sort({ createdAt: 1 });

      if (adminMembership && isValidObjectId(adminMembership.organizationId?.toString())) {
        const org = await Organization.findById(adminMembership.organizationId);
        if (org) {
          const orgIdStr = org._id.toString();
          req.organizationId = orgIdStr;
          req.membership = {
            organizationId: orgIdStr,
            userId: req.user.userId,
            role: 'platform_admin',
            status: 'ACTIVE',
          };
          return next();
        }
      }

      // 2d. Fallback to any active organization in the system
      let defaultOrg = await Organization.findOne({ status: 'ACTIVE' }).sort({ createdAt: 1 });
      if (!defaultOrg) {
        defaultOrg = await Organization.findOne().sort({ createdAt: 1 });
      }

      // 2e. If system has no organizations, create default platform organization
      if (!defaultOrg) {
        defaultOrg = await Organization.create({
          name: 'Platform Administration',
          slug: 'platform-administration',
          status: 'ACTIVE',
          settings: {
            currency: 'INR',
            defaultTimezone: 'Asia/Kolkata',
          },
          onboarding: {
            status: 'completed',
            currentStep: 4,
            data: {},
          },
        });
      }

      const defaultOrgId = defaultOrg._id.toString();
      await Membership.findOneAndUpdate(
        { organizationId: defaultOrg._id, userId: req.user.userId },
        { organizationId: defaultOrg._id, userId: req.user.userId, role: 'platform_admin', status: 'ACTIVE' },
        { upsert: true }
      );

      req.organizationId = defaultOrgId;
      req.membership = {
        organizationId: defaultOrgId,
        userId: req.user.userId,
        role: 'platform_admin',
        status: 'ACTIVE',
      };
      return next();
    }

    // 3. Resolve membership for normal tenant users
    let membership: IMembership | null = null;

    if (targetOrgId) {
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
