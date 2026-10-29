import { z } from 'zod';

export const decideApprovalSchema = z.object({
  decision: z.enum(['APPROVED', 'CHANGES_REQUESTED']),
  factChecklist: z
    .object({
      priceVerified: z.boolean().default(false),
      bedroomsVerified: z.boolean().default(false),
      amenitiesVerified: z.boolean().default(false),
      ctaVerified: z.boolean().default(false),
      reraDisclaimerVerified: z.boolean().default(false),
    })
    .optional(),
  feedback: z.string().optional(),
});

export type DecideApprovalInput = z.infer<typeof decideApprovalSchema>;
