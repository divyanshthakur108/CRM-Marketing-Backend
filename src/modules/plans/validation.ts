import { z } from 'zod';

export const planItemTypeEnum = z.enum([
  'POST_4x5',
  'REEL_9x16',
  'CAROUSEL',
  'PAID_AD',
  'INSTAGRAM_REEL',
  'FACEBOOK_CAROUSEL',
  'LINKEDIN_POST',
  'WHATSAPP_BROADCAST',
  'YOUTUBE_SHORTS',
  'PRINT_FLYER',
]);

export const planItemChannelEnum = z.enum([
  'INSTAGRAM',
  'FACEBOOK',
  'BOTH',
  'LINKEDIN',
  'WHATSAPP',
  'YOUTUBE',
]);

export const generatePlanSchema = z.object({
  month: z.union([z.number(), z.string()]),
  year: z.number().optional(),
  projectId: z.string().optional(),
  overrideExisting: z.boolean().optional().default(false),
  cycleName: z.string().optional(),
});

export const createPlanItemSchema = z.object({
  planId: z.string().min(1, 'Plan ID is required'),
  projectId: z.string().min(1, 'Project ID is required'),
  projectName: z.string().optional(),
  title: z.string().min(1, 'Title is required'),
  type: planItemTypeEnum,
  channel: planItemChannelEnum.default('BOTH'),
  scheduledDate: z.string().min(1, 'Scheduled date is required'),
  scheduledTime: z.string().default('18:00'),
  timezone: z.string().default('Asia/Kolkata'),
  isPaid: z.boolean().default(false),
  proposedBudget: z.number().min(0).default(0),
  topic: z.string().min(1, 'Topic is required'),
  creativeBrief: z.string().min(1, 'Creative brief is required'),
  copySnippet: z.string().optional().default(''),
  previewUrl: z.string().optional().default(''),
  targetAudience: z.string().optional().default(''),
  ctaText: z.string().optional().default(''),
});

export const updatePlanItemSchema = z.object({
  title: z.string().optional(),
  type: planItemTypeEnum.optional(),
  channel: planItemChannelEnum.optional(),
  scheduledDate: z.string().optional(),
  scheduledTime: z.string().optional(),
  timezone: z.string().optional(),
  isPaid: z.boolean().optional(),
  proposedBudget: z.number().min(0).optional(),
  topic: z.string().optional(),
  creativeBrief: z.string().optional(),
  copySnippet: z.string().optional(),
  previewUrl: z.string().optional(),
  targetAudience: z.string().optional(),
  ctaText: z.string().optional(),
  approvalStatus: z
    .enum(['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'CHANGES_REQUESTED'])
    .optional(),
  publishStatus: z
    .enum(['UNSCHEDULED', 'SCHEDULED', 'PUBLISHING', 'PUBLISHED', 'FAILED', 'PAUSED', 'CANCELLED'])
    .optional(),
  version: z.number().optional(), // Optimistic locking
});

export const reschedulePlanItemSchema = z.object({
  scheduledDate: z.string().min(1, 'Scheduled date is required'),
  scheduledTime: z.string().optional(),
  timezone: z.string().optional().default('Asia/Kolkata'),
  version: z.number().optional(),
});

export const approvePlanSchema = z.object({
  comments: z.string().optional().default('Plan approved.'),
});

export const requestChangesSchema = z.object({
  comments: z.string().min(1, 'Feedback comments are required when requesting changes'),
});

export type GeneratePlanInput = z.infer<typeof generatePlanSchema>;
export type CreatePlanItemInput = z.infer<typeof createPlanItemSchema>;
export type UpdatePlanItemInput = z.infer<typeof updatePlanItemSchema>;
export type ReschedulePlanItemInput = z.infer<typeof reschedulePlanItemSchema>;
export type ApprovePlanInput = z.infer<typeof approvePlanSchema>;
export type RequestChangesInput = z.infer<typeof requestChangesSchema>;
