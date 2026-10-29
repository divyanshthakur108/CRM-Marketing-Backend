import { Organization } from '../../models/Organization.js';
import { AppError } from '../../utils/AppError.js';
import { validateStepData } from '../../config/onboardingSteps.js';

export class OnboardingService {
  /**
   * 1. Get current onboarding progress and draft data
   */
  public async getOnboarding(organizationId: string) {
    const organization = await Organization.findById(organizationId);
    if (!organization) {
      throw AppError.notFound('Organization not found', 'ORGANIZATION_NOT_FOUND');
    }

    const onboarding = organization.onboarding || {
      status: 'pending',
      currentStep: 1,
      data: { step1: {}, step2: {}, step3: {}, step4: {} },
    };

    return {
      currentStep: onboarding.currentStep || 1,
      data: onboarding.data || {},
      status: onboarding.status || 'pending',
      submittedAt: onboarding.submittedAt,
    };
  }

  /**
   * 2. Save a specific step (1 to 4) as a draft
   */
  public async saveStep(organizationId: string, step: number, rawData: unknown) {
    if (step < 1 || step > 4) {
      throw AppError.badRequest(
        `Invalid step number '${step}'. Onboarding consists of steps 1 through 4.`,
        'INVALID_STEP_NUMBER'
      );
    }

    // Validate step data against config schema
    let validatedData: unknown;
    try {
      validatedData = validateStepData(step, rawData);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Step validation failed';
      throw AppError.badRequest(`Validation failed for step ${step}: ${msg}`, 'STEP_VALIDATION_ERROR');
    }

    const organization = await Organization.findById(organizationId);
    if (!organization) {
      throw AppError.notFound('Organization not found', 'ORGANIZATION_NOT_FOUND');
    }

    if (organization.onboarding?.status === 'completed') {
      throw AppError.badRequest(
        'Onboarding has already been submitted and completed',
        'ONBOARDING_ALREADY_COMPLETED'
      );
    }

    if (!organization.onboarding) {
      organization.onboarding = {
        status: 'pending',
        currentStep: 1,
        data: {},
      };
    }

    if (!organization.onboarding.data) {
      organization.onboarding.data = {};
    }

    // Save step draft data
    const stepKey = `step${step}` as keyof typeof organization.onboarding.data;
    organization.onboarding.data[stepKey] = validatedData as Record<string, unknown>;

    // Advance currentStep pointer if this step was completed
    if (organization.onboarding.currentStep <= step && step < 4) {
      organization.onboarding.currentStep = step + 1;
    }

    // Transition status to in_progress
    if (organization.onboarding.status === 'pending') {
      organization.onboarding.status = 'in_progress';
    }

    organization.markModified('onboarding');
    await organization.save();

    return {
      currentStep: organization.onboarding.currentStep,
      data: organization.onboarding.data,
      status: organization.onboarding.status,
    };
  }

  /**
   * 3. Submit completed onboarding (requires all 4 steps valid)
   */
  public async submitOnboarding(organizationId: string) {
    const organization = await Organization.findById(organizationId);
    if (!organization) {
      throw AppError.notFound('Organization not found', 'ORGANIZATION_NOT_FOUND');
    }

    if (organization.onboarding?.status === 'completed') {
      throw AppError.badRequest(
        'Onboarding has already been submitted and completed',
        'ONBOARDING_ALREADY_COMPLETED'
      );
    }

    const data = organization.onboarding?.data || {};

    // Validate all 4 steps are populated
    if (!data.step1 || !data.step2 || !data.step3 || !data.step4) {
      throw AppError.badRequest(
        'All 4 onboarding steps must be completed before final submission',
        'ONBOARDING_INCOMPLETE'
      );
    }

    // Validate each step conforms to its Zod schema
    try {
      validateStepData(1, data.step1);
      validateStepData(2, data.step2);
      validateStepData(3, data.step3);
      validateStepData(4, data.step4);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Validation error';
      throw AppError.badRequest(
        `Onboarding data verification failed: ${msg}`,
        'ONBOARDING_VALIDATION_ERROR'
      );
    }

    const submittedAt = new Date();
    organization.onboarding.status = 'completed';
    organization.onboarding.submittedAt = submittedAt;

    organization.markModified('onboarding');
    await organization.save();

    return {
      status: 'completed',
      submittedAt,
      message: 'Onboarding completed successfully',
    };
  }
}

export const onboardingService = new OnboardingService();
