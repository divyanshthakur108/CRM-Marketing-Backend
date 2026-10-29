import { z } from 'zod';

/**
 * Onboarding Step 1: Company Details
 */
export const step1CompanySchema = z.object({
  companyName: z.string().min(2, 'Company name must be at least 2 characters'),
  legalEntityName: z.string().min(2, 'Legal entity name must be at least 2 characters').optional(),
  registrationNumber: z.string().optional(),
  contactPhone: z.string().min(7, 'Contact phone number is required'),
  contactEmail: z.string().email('Valid contact email is required').optional(),
  officeAddress: z.string().min(5, 'Office address is required'),
  city: z.string().min(2, 'City is required'),
  state: z.string().min(2, 'State is required'),
  pincode: z.string().optional(),
});

/**
 * Onboarding Step 2: Category & First Project
 */
export const step2ProjectSchema = z.object({
  developerCategory: z.string().min(2, 'Developer category is required'),
  firstProjectName: z.string().min(2, 'First project name is required'),
  projectType: z.string().min(2, 'Project type is required'),
  reraRegistrationNumber: z.string().min(4, 'Valid RERA registration number is required'),
  city: z.string().min(2, 'Project city is required'),
  expectedLaunchDate: z.string().optional(),
});

/**
 * Onboarding Step 3: Brand Guidelines
 */
export const step3BrandSchema = z.object({
  brandName: z.string().min(2, 'Brand name is required'),
  tagline: z.string().optional(),
  primaryColor: z.string().regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, 'Must be a valid hex color').optional(),
  secondaryColor: z.string().regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, 'Must be a valid hex color').optional(),
  logoUrl: z.string().optional(),
  disclaimerFormat: z.string().optional(),
});

/**
 * Onboarding Step 4: Marketing Goals & Monthly Budget
 */
export const step4MarketingSchema = z.object({
  primaryGoal: z.string().min(2, 'Primary marketing goal is required'),
  targetAudienceType: z.string().min(2, 'Target audience segment is required'),
  targetCpl: z.coerce.number().min(0, 'Target CPL must be a positive number'),
  monthlyBudget: z.coerce.number().min(1000, 'Monthly budget must be at least ₹1,000'),
  preferredChannels: z.array(z.string()).optional(),
});

export type Step1CompanyInput = z.infer<typeof step1CompanySchema>;
export type Step2ProjectInput = z.infer<typeof step2ProjectSchema>;
export type Step3BrandInput = z.infer<typeof step3BrandSchema>;
export type Step4MarketingInput = z.infer<typeof step4MarketingSchema>;

export const onboardingStepSchemas = {
  1: step1CompanySchema,
  2: step2ProjectSchema,
  3: step3BrandSchema,
  4: step4MarketingSchema,
} as const;

export type OnboardingStepNumber = 1 | 2 | 3 | 4;

export function validateStepData(step: number, data: unknown) {
  const schema = onboardingStepSchemas[step as OnboardingStepNumber];
  if (!schema) {
    throw new Error(`Invalid onboarding step: ${step}. Supported steps are 1 to 4.`);
  }
  return schema.parse(data);
}
