import { AppError } from '../../utils/AppError.js';
import { ICreative } from '../../models/Creative.js';

export interface ITargetingInput {
  minAge?: number;
  maxAge?: number;
  genders?: string[];
  zipCodes?: string[];
  pinCodes?: string[];
  radiusKm?: number;
  radiusMiles?: number;
  excludedDemographics?: string[];
  cities?: string[];
  interests?: string[];
}

export interface IHousingPolicyValidationResult {
  valid: boolean;
  violations: string[];
}

/**
 * Validates advertising targeting and launch parameters against Meta's Special Ad Category (HOUSING)
 * and Fair Housing anti-discrimination regulations.
 */
export function validateHousingPolicy(
  targeting: ITargetingInput = {},
  specialAdCategories: string[] = ['HOUSING'],
  status: string = 'PAUSED'
): IHousingPolicyValidationResult {
  const violations: string[] = [];

  // 1. Special Ad Category Enforcement
  if (!specialAdCategories.includes('HOUSING')) {
    violations.push('Special Ad Category "HOUSING" is mandatory for real estate advertising.');
  }

  // 2. Launch Status Enforcement: All campaigns must start in PAUSED status
  if (status !== 'PAUSED') {
    violations.push('Housing campaigns must strictly start in PAUSED status for compliance verification.');
  }

  // 3. Age Restrictions Banned (Must be 18 to 65+)
  if (targeting.minAge && targeting.minAge > 18) {
    violations.push(
      `Age restrictions are prohibited for Housing ads. Minimum age cannot exceed 18 (received: ${targeting.minAge}).`
    );
  }
  if (targeting.maxAge && targeting.maxAge < 65) {
    violations.push(
      `Age restrictions are prohibited for Housing ads. Maximum age cannot be less than 65+ (received: ${targeting.maxAge}).`
    );
  }

  // 4. Gender Restrictions Banned
  if (targeting.genders && targeting.genders.length > 0) {
    const hasOnlyOneGender =
      targeting.genders.includes('MALE') !== targeting.genders.includes('FEMALE');
    if (hasOnlyOneGender) {
      violations.push('Gender-based targeting is prohibited for Housing ads. All genders must be included.');
    }
  }

  // 5. ZIP Code / PIN Code Exclusion or Micro-targeting Banned (Redlining prevention)
  if (targeting.zipCodes && targeting.zipCodes.length > 0) {
    violations.push('ZIP code level targeting is prohibited for Housing ads under Fair Housing policies.');
  }
  if (targeting.pinCodes && targeting.pinCodes.length > 0) {
    violations.push('Postal PIN code level targeting is prohibited for Housing ads.');
  }

  // 6. Minimum Radius Enforcement (Must be at least 15 miles / ~24 km)
  if (targeting.radiusMiles && targeting.radiusMiles < 15) {
    violations.push('Location radius must be at least 15 miles for Housing ads.');
  }
  if (targeting.radiusKm && targeting.radiusKm < 24) {
    violations.push('Location radius must be at least 24 kilometers (~15 miles) for Housing ads.');
  }

  // 7. Demographic / Protected Characteristic Exclusions Banned
  if (targeting.excludedDemographics && targeting.excludedDemographics.length > 0) {
    violations.push(
      'Audience exclusions based on demographic or protected characteristics are strictly prohibited.'
    );
  }

  return {
    valid: violations.length === 0,
    violations,
  };
}

/**
 * Asserts housing policy compliance and throws an AppError(422) if violations are present.
 */
export function assertHousingPolicyCompliance(
  targeting: ITargetingInput = {},
  specialAdCategories: string[] = ['HOUSING'],
  status: string = 'PAUSED'
): void {
  const result = validateHousingPolicy(targeting, specialAdCategories, status);
  if (!result.valid) {
    throw new AppError(
      422,
      'HOUSING_POLICY_VIOLATION',
      `Housing Policy Compliance Failure: ${result.violations.join('; ')}`
    );
  }
}

/**
 * Validates that the linked creative is approved and that the daily budget conforms to limits.
 */
export function validateCampaignLaunchEligibility(
  creative: ICreative | null,
  dailyBudget: number,
  maxAllowedDailyBudget?: number
): void {
  if (!creative) {
    throw new AppError(422, 'CREATIVE_REQUIRED', 'A valid creative is required to launch an ad campaign');
  }

  if (creative.approvalStatus !== 'APPROVED') {
    throw new AppError(
      422,
      'UNAPPROVED_CREATIVE',
      `Creative must be APPROVED before launching a campaign (current status: ${creative.approvalStatus})`
    );
  }

  if (dailyBudget <= 0) {
    throw new AppError(422, 'INVALID_BUDGET', 'Daily budget must be greater than zero');
  }

  if (maxAllowedDailyBudget && dailyBudget > maxAllowedDailyBudget) {
    throw new AppError(
      422,
      'BUDGET_CAP_EXCEEDED',
      `Daily budget (₹${dailyBudget}) exceeds the remaining project budget cap (₹${maxAllowedDailyBudget})`
    );
  }
}
