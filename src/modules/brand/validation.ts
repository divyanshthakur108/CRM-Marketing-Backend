import { z } from 'zod';

export const updateBrandSchema = z.object({
  logoUrl: z.string().optional(),
  watermarkUrl: z.string().optional(),
  primaryColor: z.string().regex(/^#([0-9a-fA-F]{3}){1,2}$/, 'Must be a valid hex color code').optional(),
  secondaryColor: z.string().regex(/^#([0-9a-fA-F]{3}){1,2}$/, 'Must be a valid hex color code').optional(),
  accentColor: z.string().regex(/^#([0-9a-fA-F]{3}){1,2}$/, 'Must be a valid hex color code').optional(),
  tone: z.string().min(2, 'Tone must be at least 2 characters').optional(),
  supportedLanguages: z.array(z.enum(['English', 'Hindi', 'Hinglish'])).min(1, 'At least one language is required').optional(),
  defaultDisclaimer: z.string().optional(),
});

export type UpdateBrandInput = z.infer<typeof updateBrandSchema>;
