import { z } from 'zod';

export const mediaCategoryEnum = z.enum([
  'EXTERIOR',
  'INTERIOR',
  'ROOMS',
  'FLOOR_PLANS',
  'AMENITIES',
  'BROCHURE',
  'VIDEOS',
  'LOGO',
  'OTHER',
]);

export const patchMediaSchema = z.object({
  tags: z.array(z.string()).optional(),
  roomType: z.string().optional(),
  aspectRatio: z.enum(['1:1', '4:5', '9:16', '16:9', 'OTHER']).optional(),
  isApproved: z.boolean().optional(),
  approvalStatus: z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional(),
  category: mediaCategoryEnum.optional(),
  unitId: z.string().nullable().optional(),
  room: z.string().nullable().optional(),
  actualOrIllustrative: z.enum(['ACTUAL', 'ILLUSTRATIVE']).optional(),
  rightsConsent: z.boolean().optional(),
  isCover: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

export type PatchMediaInput = z.infer<typeof patchMediaSchema>;

