import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { Types } from 'mongoose';
import {
  SignupInput,
  LoginInput,
  GoogleLoginInput,
  ResetPasswordInput,
  InviteMemberInput,
} from './validation.js';
import { AuthResponse, UserSession } from './model.js';
import { User, IUser } from '../../models/User.js';
import { Organization, IOrganization } from '../../models/Organization.js';
import { Membership, IMembership } from '../../models/Membership.js';
import { RefreshToken } from '../../models/RefreshToken.js';
import { Invitation } from '../../models/Invitation.js';
import {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
  hashToken,
} from '../../utils/token.js';
import { AppError } from '../../utils/AppError.js';
import { logger } from '../../config/logger.js';
import { env } from '../../config/env.js';

export interface PopulatedMembership {
  _id: unknown;
  organizationId: IOrganization;
  userId: unknown;
  role: string;
  status: string;
}

export interface UserMeResponse {
  user: {
    id: string;
    email: string;
    name: string;
    avatarUrl?: string;
    isPlatformAdmin: boolean;
    role: string;
    organizationId?: string;
    organizationName?: string;
    onboardingStatus?: string;
  };
  activeOrganization: {
    id: string;
    name: string;
    slug: string;
    role: string;
  } | null;
  memberships: Array<{
    organizationId: string;
    organizationName: string;
    role: string;
    status: string;
  }>;
}

export interface InviteResponse {
  id: string;
  email: string;
  role: string;
  status: string;
  expiresAt: Date;
  inviteLink: string;
}

import { createUniqueSlug } from '../../utils/slug.js';

export class AuthService {
  /**
   * Register a new user + create primary organization + assign 'org_owner' membership
   */
  public async signup(input: SignupInput, deviceInfo?: string): Promise<AuthResponse> {
    const existingUser = await User.findOne({ email: input.email.toLowerCase() });
    if (existingUser) {
      throw AppError.conflict(
        'An account with this email address already exists',
        'EMAIL_ALREADY_EXISTS'
      );
    }

    const passwordHash = await bcrypt.hash(input.password, 10);
    const user = await User.create({
      email: input.email.toLowerCase(),
      passwordHash,
      fullName: input.name,
      isPlatformAdmin: false,
    });

    const slug = await createUniqueSlug(input.organizationName);
    const organization = await Organization.create({
      name: input.organizationName,
      slug,
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

    const membership = await Membership.create({
      organizationId: organization._id,
      userId: user._id,
      role: 'org_owner',
      status: 'ACTIVE',
      assignedProjects: [],
    });

    return this.createAuthSession(user, organization, membership, deviceInfo);
  }

  /**
   * Backwards compatible alias for signup
   */
  public async register(input: SignupInput, deviceInfo?: string): Promise<AuthResponse> {
    return this.signup(input, deviceInfo);
  }

  /**
   * Authenticate user with email and password
   * Returns generic "Invalid credentials" (401) on wrong credentials
   */
  public async login(input: LoginInput, deviceInfo?: string): Promise<AuthResponse> {
    const user = await User.findOne({ email: input.email.toLowerCase() });
    if (!user) {
      throw AppError.unauthorized('Invalid credentials', 'INVALID_CREDENTIALS');
    }

    if (user.status === 'invited') {
      throw AppError.forbidden(
        'Your invitation has not been accepted yet. Please set your password using your invite link.',
        'ACCOUNT_INVITED'
      );
    }

    if (user.status === 'disabled') {
      throw AppError.forbidden(
        'Your account has been disabled. Please contact support.',
        'ACCOUNT_DISABLED'
      );
    }

    const isMatch = await user.comparePassword(input.password);
    if (!isMatch) {
      throw AppError.unauthorized('Invalid credentials', 'INVALID_CREDENTIALS');
    }

    // Resolve tenant membership
    const memberships = (await Membership.find({
      userId: user._id,
      status: 'ACTIVE',
    }).populate('organizationId')) as unknown as PopulatedMembership[];

    if (!memberships.length && !user.isPlatformAdmin) {
      throw AppError.forbidden(
        'User has no active organization memberships',
        'NO_ACTIVE_MEMBERSHIP'
      );
    }

    let activeMembership: PopulatedMembership | undefined;

    if (input.organizationId) {
      activeMembership = memberships.find(
        (m) =>
          m.organizationId._id.toString() === input.organizationId ||
          m.organizationId.toString() === input.organizationId
      );
      if (!activeMembership && !user.isPlatformAdmin) {
        throw AppError.forbidden(
          'You do not have active access to this organization',
          'TENANT_ACCESS_DENIED'
        );
      }
    } else {
      activeMembership = memberships[0];
    }

    let organization: IOrganization;
    if (activeMembership && typeof activeMembership.organizationId === 'object') {
      organization = activeMembership.organizationId as unknown as IOrganization;
    } else if (activeMembership) {
      organization = (await Organization.findById(
        activeMembership.organizationId
      )) as IOrganization;
    } else {
      // Platform admin without specific membership
      organization = (await Organization.findOne()) || ({
        _id: 'platform-root',
        name: 'Platform Administration',
      } as unknown as IOrganization);
    }

    if (
      organization &&
      (organization.status === 'DISABLED' ||
        (organization.status as string) === 'disabled' ||
        organization.status === 'SUSPENDED')
    ) {
      throw AppError.forbidden(
        'Organization account is currently inactive.',
        'ORGANIZATION_DISABLED'
      );
    }

    return this.createAuthSession(user, organization, activeMembership, deviceInfo, memberships);
  }

  /**
   * Google OAuth session handler (production OAuth or simulated workflow)
   */
  public async googleLogin(input: GoogleLoginInput, deviceInfo?: string): Promise<AuthResponse> {
    const email = (input.email || 'google.user@realcrm.in').toLowerCase();
    const fullName = input.name || 'Google Workspace User';

    let user = await User.findOne({ email });
    let organization: IOrganization | null = null;
    let membership: IMembership | PopulatedMembership | null = null;

    if (!user) {
      const randomPassword = crypto.randomBytes(16).toString('hex') + 'A1!';
      const passwordHash = await bcrypt.hash(randomPassword, 10);

      user = await User.create({
        email,
        fullName,
        passwordHash,
        isPlatformAdmin: false,
      });

      const orgName = input.organizationName || `${fullName}'s Real Estate`;
      const slug = await createUniqueSlug(orgName);
      organization = await Organization.create({
        name: orgName,
        slug,
        status: 'ACTIVE',
      });

      membership = await Membership.create({
        organizationId: organization._id,
        userId: user._id,
        role: 'org_owner',
        status: 'ACTIVE',
      });
    } else {
      membership = await Membership.findOne({
        userId: user._id,
        status: 'ACTIVE',
      }).populate<{ organizationId: IOrganization }>('organizationId');

      if (membership && typeof membership.organizationId === 'object') {
        organization = membership.organizationId as unknown as IOrganization;
      } else if (membership) {
        organization = await Organization.findById(membership.organizationId);
      }
    }

    if (!organization) {
      const orgName = `${fullName}'s Real Estate`;
      organization = await Organization.create({
        name: orgName,
        slug: await createUniqueSlug(orgName),
        status: 'ACTIVE',
      });
      membership = await Membership.create({
        organizationId: organization._id,
        userId: user._id,
        role: 'org_owner',
        status: 'ACTIVE',
      });
    }

    return this.createAuthSession(user, organization, membership || undefined, deviceInfo);
  }

  /**
   * Rotates refresh token and issues fresh access token
   */
  public async refresh(oldRefreshToken: string, deviceInfo?: string): Promise<AuthResponse> {
    const payload = verifyRefreshToken(oldRefreshToken);
    const hashedOld = hashToken(oldRefreshToken);

    const tokenRecord = await RefreshToken.findOne({
      token: hashedOld,
      userId: payload.userId,
      isRevoked: false,
    });

    if (!tokenRecord) {
      // Possible reuse attack detected: Revoke all tokens for this user
      await RefreshToken.updateMany({ userId: payload.userId }, { isRevoked: true });
      throw AppError.unauthorized('Invalid or revoked refresh token', 'INVALID_REFRESH_TOKEN');
    }

    // Mark old token as revoked (rotation)
    tokenRecord.isRevoked = true;
    await tokenRecord.save();

    const user = await User.findById(payload.userId);
    if (!user) {
      throw AppError.unauthorized('User associated with token no longer exists', 'USER_NOT_FOUND');
    }

    const organization = await Organization.findById(payload.organizationId);
    if (!organization) {
      throw AppError.unauthorized('Organization no longer exists', 'ORG_NOT_FOUND');
    }

    const membership = await Membership.findOne({
      organizationId: organization._id,
      userId: user._id,
      status: 'ACTIVE',
    });

    return this.createAuthSession(user, organization, membership || undefined, deviceInfo);
  }

  /**
   * Revoke refresh token in database
   */
  public async logout(refreshToken?: string): Promise<void> {
    if (!refreshToken) return;
    try {
      const hashed = hashToken(refreshToken);
      await RefreshToken.updateOne({ token: hashed }, { isRevoked: true });
    } catch (err) {
      logger.warn({ err }, 'Error during refresh token revocation');
    }
  }

  /**
   * Forgot password: creates reset token and logs dev link to console
   */
  public async forgotPassword(email: string, baseUrl?: string): Promise<{ message: string }> {
    const user = await User.findOne({ email: email.toLowerCase() });
    if (user) {
      const rawToken = crypto.randomBytes(32).toString('hex');
      const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');

      user.resetPasswordToken = hashedToken;
      user.resetPasswordExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour validity
      await user.save();

      const origin = (baseUrl || env.CLIENT_URL || 'http://localhost:5173').split(',')[0].trim();
      const resetLink = `${origin}/reset-password?token=${rawToken}&email=${encodeURIComponent(user.email)}`;

      // Requirement: "Password reset email: log the link to console in dev."
      console.log('\n======================================================');
      console.log('🔑 [DEV PASSWORD RESET LINK DISPATCHED]');
      console.log(`Target User: ${user.email}`);
      console.log(`Reset URL:   ${resetLink}`);
      console.log('======================================================\n');
      logger.info({ email: user.email, resetLink }, 'Password reset link generated');
    }

    // Generic safe response to prevent email enumeration
    return {
      message: 'If an account matches that email address, password reset instructions have been sent.',
    };
  }

  /**
   * Reset password using token
   */
  public async resetPassword(input: ResetPasswordInput): Promise<{ message: string }> {
    const hashedToken = crypto.createHash('sha256').update(input.token).digest('hex');

    const user = await User.findOne({
      resetPasswordToken: hashedToken,
      resetPasswordExpires: { $gt: new Date() },
    });

    if (!user) {
      throw AppError.badRequest(
        'Password reset token is invalid or has expired',
        'INVALID_RESET_TOKEN'
      );
    }

    user.passwordHash = await bcrypt.hash(input.password, 10);
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();

    // Invalidate existing sessions for security
    await RefreshToken.updateMany({ userId: user._id }, { isRevoked: true });

    return { message: 'Password has been updated successfully. You may now log in.' };
  }

  /**
   * Get current authenticated user profile + tenant membership details
   */
  public async getMe(userId: string, targetOrgId?: string): Promise<UserMeResponse> {
    const user = await User.findById(userId).select('-passwordHash');
    if (!user) {
      throw AppError.notFound('User profile not found', 'USER_NOT_FOUND');
    }

    const memberships = (await Membership.find({
      userId: user._id,
      status: 'ACTIVE',
    }).populate('organizationId')) as unknown as PopulatedMembership[];

    let currentMembership: PopulatedMembership | undefined;
    if (targetOrgId) {
      currentMembership = memberships.find(
        (m) =>
          m.organizationId._id.toString() === targetOrgId ||
          m.organizationId.toString() === targetOrgId
      );
    }

    if (!currentMembership && memberships.length > 0) {
      currentMembership = memberships[0];
    }

    const activeOrg = currentMembership?.organizationId;

    return {
      user: {
        id: user._id.toString(),
        email: user.email,
        name: user.fullName,
        avatarUrl: user.avatarUrl,
        isPlatformAdmin: user.isPlatformAdmin,
        role: currentMembership?.role || (user.isPlatformAdmin ? 'platform_admin' : 'viewer'),
        organizationId: activeOrg ? activeOrg._id.toString() : undefined,
        organizationName: activeOrg ? activeOrg.name : undefined,
        onboardingStatus: (activeOrg as unknown as { onboarding?: { status?: string } })?.onboarding?.status || 'completed',
      },
      activeOrganization: activeOrg
        ? {
            id: activeOrg._id.toString(),
            name: activeOrg.name,
            slug: activeOrg.slug,
            role: currentMembership?.role || 'viewer',
          }
        : null,
      memberships: memberships.map((m) => ({
        organizationId: m.organizationId._id.toString(),
        organizationName: m.organizationId.name,
        role: m.role,
        status: m.status,
      })),
    };
  }

  /**
   * Invite a new team member by email with specified role
   */
  public async inviteMember(
    orgId: string,
    invitedByUserId: string,
    input: InviteMemberInput,
    baseUrl?: string
  ): Promise<InviteResponse> {
    const organization = await Organization.findById(orgId);
    if (!organization) {
      throw AppError.notFound('Organization not found', 'ORG_NOT_FOUND');
    }

    const existingUser = await User.findOne({ email: input.email.toLowerCase() });
    if (existingUser) {
      const activeMember = await Membership.findOne({
        organizationId: orgId,
        userId: existingUser._id,
      });
      if (activeMember && activeMember.status === 'ACTIVE') {
        throw AppError.conflict(
          'User is already an active member of this organization',
          'ALREADY_MEMBER'
        );
      }
    }

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    const invitation = await Invitation.create({
      organizationId: organization._id,
      email: input.email.toLowerCase(),
      role: input.role,
      token,
      invitedBy: invitedByUserId,
      status: 'PENDING',
      expiresAt,
    });

    const origin = (baseUrl || env.CLIENT_URL || 'http://localhost:5173').split(',')[0].trim();
    const inviteLink = `${origin}/signup?inviteToken=${token}&email=${encodeURIComponent(input.email)}`;

    console.log('\n======================================================');
    console.log('✉️ [DEV INVITATION LINK DISPATCHED]');
    console.log(`Invitee Email: ${input.email}`);
    console.log(`Assigned Role: ${input.role}`);
    console.log(`Organization:  ${organization.name}`);
    console.log(`Invite URL:    ${inviteLink}`);
    console.log('======================================================\n');

    return {
      id: invitation._id.toString(),
      email: invitation.email,
      role: invitation.role,
      status: invitation.status,
      expiresAt: invitation.expiresAt,
      inviteLink,
    };
  }

  /**
   * Accept an invitation and bind membership
   */
  public async acceptInvite(
    token: string,
    name?: string,
    password?: string,
    deviceInfo?: string
  ): Promise<AuthResponse> {
    const invitation = await Invitation.findOne({
      token,
      status: 'PENDING',
      expiresAt: { $gt: new Date() },
    });

    if (!invitation) {
      throw AppError.badRequest('Invalid or expired invitation token', 'INVALID_INVITATION');
    }

    let user = await User.findOne({ email: invitation.email });
    if (!user) {
      if (!password || !name) {
        throw AppError.badRequest(
          'Full name and password are required to register new invited account',
          'MISSING_REQUIRED_FIELDS'
        );
      }

      const passwordHash = await bcrypt.hash(password, 10);
      user = await User.create({
        email: invitation.email,
        fullName: name,
        passwordHash,
        isPlatformAdmin: false,
      });
    }

    const organization = await Organization.findById(invitation.organizationId);
    if (!organization) {
      throw AppError.notFound('Associated organization no longer exists', 'ORG_NOT_FOUND');
    }

    const membership = await Membership.findOneAndUpdate(
      { organizationId: organization._id, userId: user._id },
      { role: invitation.role, status: 'ACTIVE' },
      { upsert: true, new: true }
    );

    invitation.status = 'ACCEPTED';
    await invitation.save();

    return this.createAuthSession(user, organization, membership, deviceInfo);
  }

  /**
   * Client accepts an invitation token from email invite link, sets password, and activates account
   */
  public async acceptClientInvitation(
    rawToken: string,
    password: string,
    deviceInfo?: string
  ): Promise<AuthResponse> {
    const tokenHash = hashToken(rawToken);

    // Look up invitation by tokenHash OR token (single-use check)
    const invitation = await Invitation.findOne({
      $or: [{ tokenHash }, { token: tokenHash }, { token: rawToken }],
      status: 'PENDING',
      expiresAt: { $gt: new Date() },
    });

    if (!invitation) {
      throw AppError.badRequest('Invalid or expired invitation token', 'INVALID_INVITATION_TOKEN');
    }

    const user = await User.findOne({ email: invitation.email });
    if (!user) {
      throw AppError.notFound('Associated client user account not found', 'USER_NOT_FOUND');
    }

    // Set client password and activate account
    user.passwordHash = await bcrypt.hash(password, 10);
    user.status = 'active';
    await user.save();

    // Mark invitation token as single-use ACCEPTED
    invitation.status = 'ACCEPTED';
    await invitation.save();

    const organization = await Organization.findById(invitation.organizationId);
    if (!organization) {
      throw AppError.notFound('Associated organization no longer exists', 'ORG_NOT_FOUND');
    }

    const membership = await Membership.findOne({
      organizationId: organization._id,
      userId: user._id,
    });

    return this.createAuthSession(user, organization, membership, deviceInfo);
  }

  /**
   * Helper to construct signed tokens, register refresh token in DB, and prepare response
   */
  private async createAuthSession(
    user: IUser,
    organization: IOrganization,
    membership?: PopulatedMembership | { role?: string } | null,
    deviceInfo?: string,
    allMemberships?: PopulatedMembership[]
  ): Promise<AuthResponse> {
    const role = membership?.role || (user.isPlatformAdmin ? 'platform_admin' : 'viewer');
    const isValidOrgId =
      organization?._id && Types.ObjectId.isValid(organization._id.toString());
    const orgId = isValidOrgId ? organization._id.toString() : 'platform-root';

    const accessToken = generateAccessToken({
      userId: user._id.toString(),
      email: user.email,
      isPlatformAdmin: user.isPlatformAdmin,
      organizationId: orgId,
      role,
    });

    const tokenId = crypto.randomUUID();
    const refreshToken = generateRefreshToken({
      userId: user._id.toString(),
      organizationId: orgId,
      tokenId,
    });

    const hashedRefreshToken = hashToken(refreshToken);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    await RefreshToken.create({
      organizationId: isValidOrgId ? organization._id : undefined,
      userId: user._id,
      token: hashedRefreshToken,
      deviceInfo: deviceInfo || 'web-browser',
      isRevoked: false,
      expiresAt,
    });

    const userSession: UserSession = {
      id: user._id.toString(),
      email: user.email,
      name: user.fullName,
      role,
      organizationId: orgId,
      organizationName: organization.name,
      isPlatformAdmin: user.isPlatformAdmin,
      onboardingStatus: (organization as unknown as { onboarding?: { status?: string } })?.onboarding?.status || 'completed',
    };

    const orgs = allMemberships
      ? allMemberships.map((m) => ({
          id: m.organizationId._id ? m.organizationId._id.toString() : m.organizationId.toString(),
          name: m.organizationId.name || 'Organization',
          role: m.role,
          status: m.status,
        }))
      : [
          {
            id: orgId,
            name: organization.name,
            role,
            status: 'ACTIVE',
          },
        ];

    return {
      user: userSession,
      accessToken,
      refreshToken,
      organizations: orgs,
    };
  }
}

export const authService = new AuthService();
