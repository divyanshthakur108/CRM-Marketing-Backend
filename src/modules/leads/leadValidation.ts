import { z } from 'zod';

export const leadStageEnum = z.enum([
  'New',
  'Contacted',
  'Qualified',
  'Visit scheduled',
  'Visit done',
  'Negotiation',
  'Won/Lost',
]);

export const leadSourceEnum = z.enum([
  'META_AD',
  'WHATSAPP',
  'DIRECT',
  'PORTAL',
  'MANUAL',
]);

export const createLeadSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').trim(),
  phone: z.string().min(7, 'Phone number must be at least 7 digits').trim(),
  email: z.string().email('Invalid email address').optional().or(z.literal('')),
  projectId: z.string().optional(),
  projectName: z.string().optional(),
  budget: z.number().nonnegative().optional(),
  budgetDisplay: z.string().optional(),
  stage: leadStageEnum.default('New'),
  assignedTo: z.string().optional(),
  assignedAgentName: z.string().optional(),
  source: leadSourceEnum.default('DIRECT'),
  notes: z.string().optional(),
  consentGiven: z.boolean().default(true),
  consentSource: z.string().default('DIRECT_FORM'),
  tags: z.array(z.string()).default([]),
});

export const updateLeadSchema = z.object({
  name: z.string().min(2).optional(),
  phone: z.string().min(7).optional(),
  email: z.string().email().optional().or(z.literal('')),
  projectId: z.string().optional(),
  projectName: z.string().optional(),
  budget: z.number().nonnegative().optional(),
  budgetDisplay: z.string().optional(),
  stage: leadStageEnum.optional(),
  assignedTo: z.string().optional(),
  assignedAgentName: z.string().optional(),
  source: leadSourceEnum.optional(),
  notes: z.string().optional(),
  consentGiven: z.boolean().optional(),
  consentSource: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

export const leadQuerySchema = z.object({
  stage: leadStageEnum.optional(),
  projectId: z.string().optional(),
  assignedTo: z.string().optional(),
  source: leadSourceEnum.optional(),
  search: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export const addTimelineEntrySchema = z.object({
  type: z.enum([
    'STAGE_PROGRESSION',
    'CALL_LOG',
    'AGENT_NOTE',
    'WHATSAPP_MESSAGE',
    'SITE_VISIT_BOOKED',
    'INBOUND_SUBMISSION',
    'ASSIGNMENT',
  ]),
  summary: z.string().min(2, 'Summary must be at least 2 characters'),
  details: z.record(z.string(), z.unknown()).default({}),
});
