import { z } from 'zod';

export const createDemoRequestSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, 'Full Name must be at least 2 characters')
    .max(100, 'Full Name must be under 100 characters'),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email('Please enter a valid work email address'),
  phone: z
    .string()
    .trim()
    .min(8, 'Phone number must be at least 8 digits')
    .max(20, 'Phone number must not exceed 20 characters')
    .regex(/^[+0-9\s\-()]+$/, 'Please enter a valid phone number'),
  company: z
    .string()
    .trim()
    .min(2, 'Company or Brokerage name must be at least 2 characters')
    .max(150, 'Company name must be under 150 characters'),
  teamSize: z
    .string()
    .trim()
    .min(1, 'Please select your broker team size'),
  // Hidden honeypot field for bot spam detection
  hp_field: z.string().optional(),
});

export type CreateDemoRequestInput = z.infer<typeof createDemoRequestSchema>;
