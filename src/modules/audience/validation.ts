import { z } from 'zod';

export const createAudienceBriefSchema = z.object({
  projectId: z.string().optional(),
  name: z.string().min(2, 'Brief name must be at least 2 characters'),
  targetPersona: z.string().min(2, 'Target persona description is required'),
  locations: z.array(z.string()).default([]),
  ageRange: z
    .object({
      min: z.number().min(18).default(25),
      max: z.number().max(100).default(65),
    })
    .default({ min: 25, max: 65 }),
  incomeBracket: z.string().default('High Net-Worth Individuals'),
  interests: z.array(z.string()).default([]),
  housingAdPolicyAcknowledged: z.boolean().default(true),
});

export const updateAudienceBriefSchema = z.object({
  projectId: z.string().optional(),
  name: z.string().min(2).optional(),
  targetPersona: z.string().min(2).optional(),
  locations: z.array(z.string()).optional(),
  ageRange: z
    .object({
      min: z.number().min(18).optional(),
      max: z.number().max(100).optional(),
    })
    .optional(),
  incomeBracket: z.string().optional(),
  interests: z.array(z.string()).optional(),
  housingAdPolicyAcknowledged: z.boolean().optional(),
});

export type CreateAudienceBriefInput = z.infer<typeof createAudienceBriefSchema>;
export type UpdateAudienceBriefInput = z.infer<typeof updateAudienceBriefSchema>;
