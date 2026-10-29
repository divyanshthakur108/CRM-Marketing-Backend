import { z } from 'zod';

export const generateImageSchema = z.object({
  prompt: z.string().min(3, 'Prompt must be at least 3 characters long'),
  aspectRatio: z.enum(['1:1', '4:5', '9:16']).optional().default('4:5'),
  projectName: z.string().optional(),
  organizationId: z.string().optional(),
});

export type GenerateImageInput = z.infer<typeof generateImageSchema>;

export const generateCopySchema = z.object({
  projectName: z.string().min(2, 'Project name is required'),
  category: z.string().optional().default('Residential'),
  location: z.string().optional(),
  tone: z.string().optional(),
  language: z.enum(['English', 'Hindi', 'Hinglish']).optional().default('English'),
  organizationId: z.string().optional(),
});

export type GenerateCopyInput = z.infer<typeof generateCopySchema>;

export const generateCreativeSchema = z.object({
  planItemId: z.string().min(1, 'planItemId is required'),
  aspectRatio: z.enum(['1:1', '4:5', '9:16']).optional(),
  language: z.enum(['English', 'Hindi', 'Hinglish']).optional(),
  customPrompt: z.string().optional(),
  tone: z.string().optional(),
});

export type GenerateCreativeInput = z.infer<typeof generateCreativeSchema>;

export const requestRevisionSchema = z.object({
  revisionNotes: z.string().min(2, 'Revision notes must be at least 2 characters'),
});

export type RequestRevisionInput = z.infer<typeof requestRevisionSchema>;
