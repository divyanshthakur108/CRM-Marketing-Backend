import { Request, Response } from 'express';
import { onboardingService } from './service.js';
import { sendSuccess } from '../../utils/response.js';
import { AppError } from '../../utils/AppError.js';

export class OnboardingController {
  private assertOrgOwner(req: Request) {
    if (req.user?.isPlatformAdmin) {
      return;
    }
    const role = req.membership?.role;
    if (role !== 'org_owner') {
      throw AppError.forbidden(
        'Only organization owners can access or modify onboarding',
        'ORG_OWNER_REQUIRED'
      );
    }
  }

  public getOnboarding = async (req: Request, res: Response): Promise<void> => {
    if (!req.organizationId) {
      throw AppError.badRequest('Organization context is required', 'MISSING_ORG_CONTEXT');
    }
    this.assertOrgOwner(req);

    const result = await onboardingService.getOnboarding(req.organizationId);
    sendSuccess(res, result, 200);
  };

  public saveStep = async (req: Request, res: Response): Promise<void> => {
    if (!req.organizationId) {
      throw AppError.badRequest('Organization context is required', 'MISSING_ORG_CONTEXT');
    }
    this.assertOrgOwner(req);

    const step = parseInt(req.params.step, 10);
    if (isNaN(step)) {
      throw AppError.badRequest('Step must be a valid integer between 1 and 4', 'INVALID_STEP');
    }

    const result = await onboardingService.saveStep(req.organizationId, step, req.body);
    sendSuccess(res, result, 200, { message: `Onboarding step ${step} saved as draft` });
  };

  public submitOnboarding = async (req: Request, res: Response): Promise<void> => {
    if (!req.organizationId) {
      throw AppError.badRequest('Organization context is required', 'MISSING_ORG_CONTEXT');
    }
    this.assertOrgOwner(req);

    const result = await onboardingService.submitOnboarding(req.organizationId);
    sendSuccess(res, result, 200, { message: result.message });
  };
}

export const onboardingController = new OnboardingController();
