import { Router } from 'express';
import { authController } from './controller.js';
import {
  signupSchema,
  registerSchema,
  loginSchema,
  googleLoginSchema,
  refreshSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  inviteMemberSchema,
  acceptInviteSchema,
  acceptInvitationBodySchema,
} from './validation.js';
import { validate } from '../../middleware/validate.js';
import { authRateLimiter } from '../../middleware/rateLimiter.js';
import { authenticate } from '../../middleware/authenticate.js';
import { resolveTenant } from '../../middleware/resolveTenant.js';
import { authorize } from '../../middleware/authorize.js';
import { asyncHandler } from '../../utils/asyncHandler.js';

const router = Router();

// Apply stricter rate limiter to authentication endpoints
router.use(authRateLimiter);

// 1. Public Signup / Workspace Registration
router.post(
  '/signup',
  validate({ body: signupSchema }),
  asyncHandler(authController.signup)
);

// Backwards-compatible alias for /register
router.post(
  '/register',
  validate({ body: registerSchema }),
  asyncHandler(authController.register)
);

// 2. Client Invitation Acceptance (Sets password and activates client account)
router.post(
  '/invitations/:token/accept',
  validate({ body: acceptInvitationBodySchema }),
  asyncHandler(authController.acceptClientInvitation)
);

// 3. Login
router.post(
  '/login',
  validate({ body: loginSchema }),
  asyncHandler(authController.login)
);

// 3. Google OAuth
router.post(
  '/google',
  validate({ body: googleLoginSchema }),
  asyncHandler(authController.google)
);

// 4. Rotating Refresh Token
router.post(
  '/refresh',
  validate({ body: refreshSchema }),
  asyncHandler(authController.refresh)
);

// 5. Logout
router.post(
  '/logout',
  asyncHandler(authController.logout)
);

// 6. Forgot Password (Dispatches link to console in dev)
router.post(
  '/forgot-password',
  validate({ body: forgotPasswordSchema }),
  asyncHandler(authController.forgotPassword)
);

// 7. Reset Password
router.post(
  '/reset-password',
  validate({ body: resetPasswordSchema }),
  asyncHandler(authController.resetPassword)
);

// 8. Authenticated User Profile & Active Tenant Membership
router.get(
  '/me',
  authenticate,
  resolveTenant,
  asyncHandler(authController.getMe)
);

// 9. Team Member Invitation (Protected by tenant isolation + RBAC)
router.post(
  '/invite',
  authenticate,
  resolveTenant,
  authorize('members:invite'),
  validate({ body: inviteMemberSchema }),
  asyncHandler(authController.inviteMember)
);

// 10. Accept Team Invitation
router.post(
  '/accept-invite',
  validate({ body: acceptInviteSchema }),
  asyncHandler(authController.acceptInvite)
);

export default router;
