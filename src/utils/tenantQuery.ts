import { FilterQuery, Types } from 'mongoose';
import { AppError } from './AppError.js';

export type TenantId = string | Types.ObjectId;

/**
 * Validates and injects organizationId into any Mongoose query filter.
 * Guarantees that cross-tenant leaks are impossible.
 */
export function tenantFilter<T = unknown>(
  organizationId: TenantId,
  filter: FilterQuery<T> = {}
): FilterQuery<T> & { organizationId: TenantId } {
  if (!organizationId) {
    throw AppError.forbidden(
      'Tenant isolation violation: organizationId is required for this query',
      'MISSING_TENANT_SCOPE'
    );
  }

  return {
    ...filter,
    organizationId,
  };
}

/**
 * Validates that a resource belongs to the requesting tenant.
 * Throws HTTP 403 Forbidden on tenant mismatch.
 */
export function assertTenantResource(
  resource: { organizationId?: TenantId | null } | null | undefined,
  requestingOrgId: TenantId
): void {
  if (!resource) {
    throw AppError.notFound('Requested resource not found', 'RESOURCE_NOT_FOUND');
  }

  const resourceOrgId = resource.organizationId?.toString();
  const requestingId = requestingOrgId?.toString();

  if (!resourceOrgId || resourceOrgId !== requestingId) {
    throw AppError.forbidden(
      'Cross-tenant access forbidden: you do not have permission to access this resource',
      'CROSS_TENANT_FORBIDDEN'
    );
  }
}

/**
 * Injects organizationId into document payload before creation.
 */
export function tenantPayload<T extends Record<string, unknown>>(
  organizationId: TenantId,
  data: T
): T & { organizationId: TenantId } {
  if (!organizationId) {
    throw AppError.forbidden(
      'Tenant isolation violation: organizationId is required to create this record',
      'MISSING_TENANT_SCOPE'
    );
  }

  return {
    ...data,
    organizationId,
  };
}
