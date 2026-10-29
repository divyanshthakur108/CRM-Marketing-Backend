import { z } from 'zod';

// Strong password check: at least 8 chars, at least one letter and one number
export const passwordValidation = z
  .string()
  .min(8, 'Password must be at least 8 characters long')
  .regex(/[A-Za-z]/, 'Password must contain at least one letter')
  .regex(/[0-9]/, 'Password must contain at least one number');

export const signupSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters long').trim(),
  email: z.string().email('Valid work email address is required').toLowerCase().trim(),
  password: passwordValidation,
  organizationName: z.string().min(2, 'Organization name must be at least 2 characters long').trim(),
});
export type SignupInput = z.infer<typeof signupSchema>;

// Alias for backwards compatibility with any existing tests
export const registerSchema = signupSchema;
export type RegisterInput = SignupInput;

export const loginSchema = z.object({
  email: z.string().email('Valid work email address is required').toLowerCase().trim(),
  password: z.string().min(6, 'Password must be at least 6 characters long'),
  organizationId: z.string().optional(),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const googleLoginSchema = z.object({
  idToken: z.string().optional(),
  email: z.string().email().optional(),
  name: z.string().optional(),
  organizationName: z.string().optional(),
});
export type GoogleLoginInput = z.infer<typeof googleLoginSchema>;

export const refreshSchema = z.object({
  refreshToken: z.string().optional(),
});
export type RefreshInput = z.infer<typeof refreshSchema>;

export const forgotPasswordSchema = z.object({
  email: z.string().email('Valid work email address is required').toLowerCase().trim(),
});
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z.object({
  token: z.string().min(1, 'Reset token is required'),
  password: passwordValidation,
});
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

export const inviteMemberSchema = z.object({
  email: z.string().email('Valid invitee email address is required').toLowerCase().trim(),
  role: z.enum([
    'platform_admin',
    'org_owner',
    'marketing_manager',
    'creative_contributor',
    'client_approver',
    'viewer',
    'OWNER',
    'ADMIN',
    'MARKETING_MANAGER',
    'SALES_AGENT',
    'CREATIVE_EDITOR',
    'VIEWER',
  ]),
});
export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;

export const acceptInviteSchema = z.object({
  token: z.string().min(1, 'Invitation token is required'),
  name: z.string().min(2).optional(),
  password: passwordValidation.optional(),
});
export type AcceptInviteInput = z.infer<typeof acceptInviteSchema>;

export const acceptInvitationBodySchema = z.object({
  password: passwordValidation,
});
export type AcceptInvitationBodyInput = z.infer<typeof acceptInvitationBodySchema>;
