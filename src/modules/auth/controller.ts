import { Request, Response } from 'express';
import { authService } from './service.js';
import { sendSuccess } from '../../utils/response.js';
import {
  SignupInput,
  LoginInput,
  GoogleLoginInput,
  ForgotPasswordInput,
  ResetPasswordInput,
  InviteMemberInput,
  AcceptInviteInput,
} from './validation.js';
import { env } from '../../config/env.js';
import { AppError } from '../../utils/AppError.js';

const COOKIE_NAME = 'refreshToken';
const ACCESS_COOKIE_NAME = 'accessToken';

const getCookieOptions = () => ({
  httpOnly: true,
  secure: env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days in milliseconds
  path: '/',
});

const getAccessCookieOptions = () => ({
  httpOnly: true,
  secure: env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  maxAge: 24 * 60 * 60 * 1000, // 24 hours in milliseconds
  path: '/',
});


export class AuthController {
  /**
   * POST /signup
   */
  public signup = async (req: Request, res: Response): Promise<void> => {
    const input = req.body as SignupInput;
    const deviceInfo = req.headers['user-agent'];
    const result = await authService.signup(input, deviceInfo);

    if (result.refreshToken) {
      res.cookie(COOKIE_NAME, result.refreshToken, getCookieOptions());
    }
    if (result.accessToken) {
      res.cookie(ACCESS_COOKIE_NAME, result.accessToken, getAccessCookieOptions());
    }

    sendSuccess(
      res,
      {
        user: result.user,
        accessToken: result.accessToken,
        organizations: result.organizations,
      },
      201,
      { message: 'Workspace account created successfully' }
    );
  };

  /**
   * Backwards compatible POST /register
   */
  public register = async (req: Request, res: Response): Promise<void> => {
    return this.signup(req, res);
  };

  /**
   * POST /login
   */
  public login = async (req: Request, res: Response): Promise<void> => {
    const input = req.body as LoginInput;
    const deviceInfo = req.headers['user-agent'];
    const result = await authService.login(input, deviceInfo);

    if (result.refreshToken) {
      res.cookie(COOKIE_NAME, result.refreshToken, getCookieOptions());
    }
    if (result.accessToken) {
      res.cookie(ACCESS_COOKIE_NAME, result.accessToken, getAccessCookieOptions());
    }

    sendSuccess(
      res,
      {
        user: result.user,
        accessToken: result.accessToken,
        organizations: result.organizations,
      },
      200,
      { message: 'Authentication successful' }
    );
  };

  /**
   * POST /google
   */
  public google = async (req: Request, res: Response): Promise<void> => {
    const input = req.body as GoogleLoginInput;
    const deviceInfo = req.headers['user-agent'];
    const result = await authService.googleLogin(input, deviceInfo);

    if (result.refreshToken) {
      res.cookie(COOKIE_NAME, result.refreshToken, getCookieOptions());
    }
    if (result.accessToken) {
      res.cookie(ACCESS_COOKIE_NAME, result.accessToken, getAccessCookieOptions());
    }

    sendSuccess(
      res,
      {
        user: result.user,
        accessToken: result.accessToken,
        organizations: result.organizations,
      },
      200,
      { message: 'Google authentication successful' }
    );
  };

  /**
   * POST /refresh
   */
  public refresh = async (req: Request, res: Response): Promise<void> => {
    const rawToken =
      req.cookies?.[COOKIE_NAME] ||
      (req.body && req.body.refreshToken) ||
      (req.headers['x-refresh-token'] as string | undefined);

    if (!rawToken) {
      throw AppError.unauthorized('Refresh token is required', 'MISSING_REFRESH_TOKEN');
    }

    const deviceInfo = req.headers['user-agent'];
    const result = await authService.refresh(rawToken, deviceInfo);

    if (result.refreshToken) {
      res.cookie(COOKIE_NAME, result.refreshToken, getCookieOptions());
    }
    if (result.accessToken) {
      res.cookie(ACCESS_COOKIE_NAME, result.accessToken, getAccessCookieOptions());
    }

    sendSuccess(
      res,
      {
        accessToken: result.accessToken,
        user: result.user,
        organizations: result.organizations,
      },
      200,
      { message: 'Session refreshed successfully' }
    );
  };

  /**
   * POST /logout
   */
  public logout = async (req: Request, res: Response): Promise<void> => {
    const token = req.cookies?.[COOKIE_NAME] || (req.body && req.body.refreshToken);
    if (token) {
      await authService.logout(token);
    }

    res.clearCookie(COOKIE_NAME, {
      httpOnly: true,
      secure: env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
    });
    res.clearCookie(ACCESS_COOKIE_NAME, {
      httpOnly: true,
      secure: env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
    });

    sendSuccess(res, { loggedOut: true }, 200, { message: 'Logged out successfully' });
  };

  /**
   * POST /forgot-password
   */
  public forgotPassword = async (req: Request, res: Response): Promise<void> => {
    const { email } = req.body as ForgotPasswordInput;
    const origin = req.headers.origin || env.CLIENT_URL;
    const result = await authService.forgotPassword(email, origin);
    sendSuccess(res, result, 200);
  };

  /**
   * POST /reset-password
   */
  public resetPassword = async (req: Request, res: Response): Promise<void> => {
    const input = req.body as ResetPasswordInput;
    const result = await authService.resetPassword(input);
    sendSuccess(res, result, 200);
  };

  /**
   * GET /me
   */
  public getMe = async (req: Request, res: Response): Promise<void> => {
    if (!req.user) {
      throw AppError.unauthorized('Authentication required', 'AUTHENTICATION_REQUIRED');
    }

    const orgId = req.organizationId || (req.headers['x-organization-id'] as string | undefined);
    const result = await authService.getMe(req.user.userId, orgId);
    sendSuccess(res, result, 200);
  };

  /**
   * POST /invite
   */
  public inviteMember = async (req: Request, res: Response): Promise<void> => {
    if (!req.organizationId || !req.user) {
      throw AppError.badRequest('Organization context is required for team invites', 'MISSING_ORG');
    }

    const input = req.body as InviteMemberInput;
    const origin = req.headers.origin || env.CLIENT_URL;
    const result = await authService.inviteMember(
      req.organizationId,
      req.user.userId,
      input,
      origin
    );

    sendSuccess(res, result, 201, { message: 'Team invitation dispatched' });
  };

  /**
   * POST /accept-invite
   */
  public acceptInvite = async (req: Request, res: Response): Promise<void> => {
    const { token, name, password } = req.body as AcceptInviteInput;
    const deviceInfo = req.headers['user-agent'];
    const result = await authService.acceptInvite(token, name, password, deviceInfo);

    if (result.refreshToken) {
      res.cookie(COOKIE_NAME, result.refreshToken, getCookieOptions());
    }
    if (result.accessToken) {
      res.cookie(ACCESS_COOKIE_NAME, result.accessToken, getAccessCookieOptions());
    }

    sendSuccess(
      res,
      {
        user: result.user,
        accessToken: result.accessToken,
        organizations: result.organizations,
      },
      200,
      { message: 'Invitation accepted successfully' }
    );
  };

  /**
   * POST /invitations/:token/accept
   */
  public acceptClientInvitation = async (req: Request, res: Response): Promise<void> => {
    const { token } = req.params;
    const { password } = req.body as { password: string };
    const deviceInfo = req.headers['user-agent'];

    const result = await authService.acceptClientInvitation(token, password, deviceInfo);

    if (result.refreshToken) {
      res.cookie(COOKIE_NAME, result.refreshToken, getCookieOptions());
    }
    if (result.accessToken) {
      res.cookie(ACCESS_COOKIE_NAME, result.accessToken, getAccessCookieOptions());
    }

    sendSuccess(
      res,
      {
        user: result.user,
        accessToken: result.accessToken,
        organizations: result.organizations,
      },
      200,
      { message: 'Invitation accepted and account activated successfully' }
    );
  };
}

export const authController = new AuthController();
