import { z } from 'zod';

export const createOrgSchema = z.object({
  organizationName: z.string().min(2, 'Organization name must be at least 2 characters').trim(),
  clientName: z.string().min(2, 'Client name must be at least 2 characters').trim(),
  clientEmail: z.string().email('Valid client email is required').toLowerCase().trim(),
});

export const updateOrgStatusSchema = z.object({
  status: z.enum(['active', 'disabled', 'ACTIVE', 'DISABLED', 'SUSPENDED', 'TRIAL']),
});

export const listOrgsQuerySchema = z.object({
  search: z.string().optional(),
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(10),
});

export type CreateOrgInput = z.infer<typeof createOrgSchema>;
export type UpdateOrgStatusInput = z.infer<typeof updateOrgStatusSchema>;
export type ListOrgsQueryInput = z.infer<typeof listOrgsQuerySchema>;
