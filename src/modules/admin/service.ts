import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { Types } from 'mongoose';
import { Organization } from '../../models/Organization.js';
import { User, IUser } from '../../models/User.js';
import { Membership } from '../../models/Membership.js';
import { Invitation } from '../../models/Invitation.js';
import { AuditLog } from '../../models/AuditLog.js';
import { AppError } from '../../utils/AppError.js';
import { createUniqueSlug } from '../../utils/slug.js';
import { hashToken } from '../../utils/token.js';
import { emailService } from '../../services/emailService.js';
import { env } from '../../config/env.js';
import { CreateOrgInput, ListOrgsQueryInput, UpdateOrgStatusInput } from './validation.js';

export interface AdminUserContext {
  userId: string;
  email: string;
}

export class AdminService {
  /**
   * 1. Create Organization + Client User + Invitation
   */
  public async createOrganization(
    input: CreateOrgInput,
    admin: AdminUserContext,
    ip?: string,
    userAgent?: string
  ) {
    const clientEmail = input.clientEmail.toLowerCase().trim();

    // Check if client email already exists
    const existingUser = await User.findOne({ email: clientEmail });
    if (existingUser) {
      throw AppError.conflict(
        `A user account with email '${clientEmail}' already exists`,
        'CLIENT_EMAIL_EXISTS'
      );
    }

    // Create unique organization slug
    const slug = await createUniqueSlug(input.organizationName);

    // Create Organization with onboarding pending
    const organization = await Organization.create({
      name: input.organizationName,
      slug,
      status: 'ACTIVE',
      onboarding: {
        status: 'pending',
        currentStep: 1,
        data: {
          step1: {},
          step2: {},
          step3: {},
          step4: {},
        },
      },
    });

    // Create invited client user with secure random temporary password hash
    const tempPassword = crypto.randomBytes(24).toString('hex') + 'A1!';
    const passwordHash = await bcrypt.hash(tempPassword, 10);

    const clientUser = await User.create({
      email: clientEmail,
      fullName: input.clientName,
      passwordHash,
      isPlatformAdmin: false,
      status: 'invited',
    });

    // Create org_owner membership
    await Membership.create({
      organizationId: organization._id,
      userId: clientUser._id,
      role: 'org_owner',
      status: 'ACTIVE',
    });

    // Generate single-use invitation token (store only SHA-256 hash, expires in 48h)
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000); // 48 hours

    await Invitation.create({
      organizationId: organization._id,
      email: clientEmail,
      role: 'org_owner',
      token: tokenHash,
      tokenHash,
      invitedBy: new Types.ObjectId(admin.userId),
      status: 'PENDING',
      expiresAt,
    });

    // Dispatch invitation email via Nodemailer (or dev console)
    const primaryClientUrl = (env.CLIENT_URL || 'http://localhost:5173').split(',')[0].trim();
    const inviteLink = `${primaryClientUrl}/invitations/${rawToken}/accept`;
    await emailService.sendClientInvitation({
      to: clientEmail,
      clientName: input.clientName,
      organizationName: organization.name,
      inviteLink,
    });

    // Record audit log entry
    await AuditLog.create({
      organizationId: organization._id,
      userId: new Types.ObjectId(admin.userId),
      userEmail: admin.email,
      action: 'ORGANIZATION_CREATE',
      resourceType: 'Organization',
      resourceId: organization._id.toString(),
      details: {
        organizationName: organization.name,
        clientEmail,
        clientName: input.clientName,
      },
      ipAddress: ip,
      userAgent,
    });

    return {
      organization: {
        id: organization._id.toString(),
        name: organization.name,
        slug: organization.slug,
        status: organization.status,
        onboarding: organization.onboarding,
        createdAt: organization.createdAt,
      },
      client: {
        id: clientUser._id.toString(),
        email: clientUser.email,
        fullName: clientUser.fullName,
        status: clientUser.status,
      },
      invitation: {
        expiresAt,
      },
      // Expose raw token only in dev/test to allow automated integration tests
      inviteToken: env.NODE_ENV !== 'production' ? rawToken : undefined,
    };
  }

  /**
   * 2. List Organizations with Search, Pagination, & Onboarding Status
   */
  public async listOrganizations(query: ListOrgsQueryInput) {
    const page = Math.max(1, query.page);
    const limit = Math.max(1, Math.min(100, query.limit));
    const skip = (page - 1) * limit;

    const filter: Record<string, unknown> = {};
    if (query.search) {
      filter.$or = [
        { name: { $regex: query.search, $options: 'i' } },
        { slug: { $regex: query.search, $options: 'i' } },
      ];
    }

    const [organizations, total] = await Promise.all([
      Organization.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
      Organization.countDocuments(filter),
    ]);

    // Attach owner user info for each organization
    const orgsWithOwners = await Promise.all(
      organizations.map(async (org) => {
        const ownerMembership = await Membership.findOne({
          organizationId: org._id,
          role: { $in: ['org_owner', 'OWNER'] },
        }).populate<{ userId: IUser }>('userId');

        const client = ownerMembership?.userId
          ? {
              id: ownerMembership.userId._id.toString(),
              name: ownerMembership.userId.fullName,
              fullName: ownerMembership.userId.fullName,
              email: ownerMembership.userId.email,
              status: ownerMembership.userId.status,
            }
          : null;

        return {
          id: org._id.toString(),
          name: org.name,
          slug: org.slug,
          status: org.status,
          onboarding: org.onboarding,
          client,
          createdAt: org.createdAt,
          updatedAt: org.updatedAt,
        };
      })
    );

    return {
      organizations: orgsWithOwners,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * 3. Resend Client Invitation
   */
  public async resendInvite(
    organizationId: string,
    admin: AdminUserContext,
    ip?: string,
    userAgent?: string
  ) {
    const organization = await Organization.findById(organizationId);
    if (!organization) {
      throw AppError.notFound('Organization not found', 'ORGANIZATION_NOT_FOUND');
    }

    const ownerMembership = await Membership.findOne({
      organizationId: organization._id,
      role: { $in: ['org_owner', 'OWNER'] },
    }).populate<{ userId: IUser }>('userId');

    if (!ownerMembership || !ownerMembership.userId) {
      throw AppError.notFound('No client owner found for this organization', 'CLIENT_NOT_FOUND');
    }

    const clientUser = ownerMembership.userId;
    if (clientUser.status === 'active') {
      throw AppError.badRequest(
        'Client user has already activated their account and set a password',
        'CLIENT_ALREADY_ACTIVE'
      );
    }

    // Invalidate previous pending invitations
    await Invitation.updateMany(
      { organizationId: organization._id, email: clientUser.email, status: 'PENDING' },
      { status: 'REVOKED' }
    );

    // Generate fresh single-use 48h invitation token
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);

    await Invitation.create({
      organizationId: organization._id,
      email: clientUser.email,
      role: 'org_owner',
      token: tokenHash,
      tokenHash,
      invitedBy: new Types.ObjectId(admin.userId),
      status: 'PENDING',
      expiresAt,
    });

    // Send email
    const primaryClientUrl = (env.CLIENT_URL || 'http://localhost:5173').split(',')[0].trim();
    const inviteLink = `${primaryClientUrl}/invitations/${rawToken}/accept`;
    await emailService.sendClientInvitation({
      to: clientUser.email,
      clientName: clientUser.fullName,
      organizationName: organization.name,
      inviteLink,
    });

    // Audit log
    await AuditLog.create({
      organizationId: organization._id,
      userId: new Types.ObjectId(admin.userId),
      userEmail: admin.email,
      action: 'ORGANIZATION_RESEND_INVITE',
      resourceType: 'Organization',
      resourceId: organization._id.toString(),
      details: {
        organizationName: organization.name,
        clientEmail: clientUser.email,
      },
      ipAddress: ip,
      userAgent,
    });

    return {
      message: 'Invitation link resent successfully',
      expiresAt,
      inviteToken: env.NODE_ENV !== 'production' ? rawToken : undefined,
    };
  }

  /**
   * 4. Update Organization Status (Enable / Disable)
   */
  public async updateOrganizationStatus(
    organizationId: string,
    input: UpdateOrgStatusInput,
    admin: AdminUserContext,
    ip?: string,
    userAgent?: string
  ) {
    const organization = await Organization.findById(organizationId);
    if (!organization) {
      throw AppError.notFound('Organization not found', 'ORGANIZATION_NOT_FOUND');
    }

    const rawStatus = input.status.toUpperCase();
    const normalizedStatus =
      rawStatus === 'DISABLED' || input.status === 'disabled'
        ? 'DISABLED'
        : rawStatus === 'SUSPENDED'
          ? 'SUSPENDED'
          : 'ACTIVE';

    organization.status = normalizedStatus;
    await organization.save();

    // If disabled, also update user status
    if (normalizedStatus === 'DISABLED') {
      const memberships = await Membership.find({ organizationId: organization._id });
      const userIds = memberships.map((m) => m.userId);
      await User.updateMany(
        { _id: { $in: userIds }, isPlatformAdmin: false },
        { status: 'disabled' }
      );
    } else if (normalizedStatus === 'ACTIVE') {
      const memberships = await Membership.find({ organizationId: organization._id });
      const userIds = memberships.map((m) => m.userId);
      await User.updateMany(
        { _id: { $in: userIds }, isPlatformAdmin: false, status: 'disabled' },
        { status: 'active' }
      );
    }

    // Audit log
    await AuditLog.create({
      organizationId: organization._id,
      userId: new Types.ObjectId(admin.userId),
      userEmail: admin.email,
      action: 'ORGANIZATION_STATUS_UPDATE',
      resourceType: 'Organization',
      resourceId: organization._id.toString(),
      details: {
        organizationName: organization.name,
        newStatus: normalizedStatus,
      },
      ipAddress: ip,
      userAgent,
    });

    return {
      id: organization._id.toString(),
      name: organization.name,
      slug: organization.slug,
      status: organization.status,
      onboarding: organization.onboarding,
      updatedAt: organization.updatedAt,
    };
  }
}

export const adminService = new AdminService();
