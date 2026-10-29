import { z } from 'zod';

export const startConversationSchema = z.object({
  contactPhone: z.string().min(7, 'Phone number must be at least 7 digits').trim(),
  contactName: z.string().min(2, 'Contact name is required').trim(),
  projectName: z.string().optional(),
  projectId: z.string().optional(),
  leadId: z.string().optional(),
  initialMessage: z.string().min(1, 'Initial message is required'),
  isPromotional: z.boolean().default(false),
  templateName: z.string().optional(),
});

export const sendMessageSchema = z.object({
  text: z.string().min(1, 'Message text is required'),
  isPromotional: z.boolean().default(false),
  templateName: z.string().optional(),
  templateParams: z.record(z.string(), z.string()).optional(),
});

export const handoffToggleSchema = z.object({
  needsHandoff: z.boolean(),
  handoffReason: z.string().optional(),
  assignedAgentId: z.string().optional(),
  assignedAgentName: z.string().optional(),
});

export const conversationQuerySchema = z.object({
  needsHandoff: z
    .enum(['true', 'false'])
    .transform((val) => val === 'true')
    .optional(),
  channel: z.enum(['WHATSAPP', 'SMS', 'WEB_CHAT']).optional(),
  search: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(30),
});
