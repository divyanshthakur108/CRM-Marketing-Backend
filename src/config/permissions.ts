export type UserRole =
  | 'platform_admin'
  | 'org_owner'
  | 'marketing_manager'
  | 'creative_contributor'
  | 'client_approver'
  | 'sales_agent'
  | 'viewer';

export type Permission =
  | 'org:manage'
  | 'org:read'
  | 'members:manage'
  | 'members:invite'
  | 'members:read'
  | 'projects:create'
  | 'projects:read'
  | 'projects:update'
  | 'projects:delete'
  | 'units:manage'
  | 'creatives:create'
  | 'creatives:read'
  | 'creatives:update'
  | 'creatives:approve'
  | 'creatives:delete'
  | 'media:read'
  | 'media:upload'
  | 'media:update'
  | 'media:delete'
  | 'campaigns:create'
  | 'campaigns:read'
  | 'campaigns:publish'
  | 'budget:read'
  | 'budget:write'
  | 'leads:read'
  | 'leads:write'
  | 'analytics:read'
  | 'brand:read'
  | 'brand:manage'
  | 'audience:read'
  | 'audience:create'
  | 'audience:update'
  | 'audience:delete'
  | 'plans:read'
  | 'plans:create'
  | 'plans:update'
  | 'plans:approve'
  | 'approvals:read'
  | 'approvals:decide';

/**
 * Standard Permission Matrix
 * Maps each tenant role to its allowed capabilities
 */
export const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  platform_admin: [
    'org:manage',
    'org:read',
    'members:manage',
    'members:invite',
    'members:read',
    'projects:create',
    'projects:read',
    'projects:update',
    'projects:delete',
    'units:manage',
    'creatives:create',
    'creatives:read',
    'creatives:update',
    'creatives:approve',
    'creatives:delete',
    'media:read',
    'media:upload',
    'media:update',
    'media:delete',
    'campaigns:create',
    'campaigns:read',
    'campaigns:publish',
    'budget:read',
    'budget:write',
    'leads:read',
    'leads:write',
    'analytics:read',
    'brand:read',
    'brand:manage',
    'audience:read',
    'audience:create',
    'audience:update',
    'audience:delete',
    'plans:read',
    'plans:create',
    'plans:update',
    'plans:approve',
    'approvals:read',
    'approvals:decide',
  ],

  org_owner: [
    'org:manage',
    'org:read',
    'members:manage',
    'members:invite',
    'members:read',
    'projects:create',
    'projects:read',
    'projects:update',
    'projects:delete',
    'units:manage',
    'creatives:create',
    'creatives:read',
    'creatives:update',
    'creatives:approve',
    'creatives:delete',
    'media:read',
    'media:upload',
    'media:update',
    'media:delete',
    'campaigns:create',
    'campaigns:read',
    'campaigns:publish',
    'budget:read',
    'budget:write',
    'leads:read',
    'leads:write',
    'analytics:read',
    'brand:read',
    'brand:manage',
    'audience:read',
    'audience:create',
    'audience:update',
    'audience:delete',
    'plans:read',
    'plans:create',
    'plans:update',
    'plans:approve',
    'approvals:read',
    'approvals:decide',
  ],

  marketing_manager: [
    'org:read',
    'members:read',
    'projects:create',
    'projects:read',
    'projects:update',
    'units:manage',
    'creatives:create',
    'creatives:read',
    'creatives:update',
    'creatives:approve',
    'media:read',
    'media:upload',
    'media:update',
    'media:delete',
    'campaigns:create',
    'campaigns:read',
    'campaigns:publish',
    'budget:read',
    'budget:write',
    'leads:read',
    'leads:write',
    'analytics:read',
    'brand:read',
    'brand:manage',
    'audience:read',
    'audience:create',
    'audience:update',
    'audience:delete',
    'plans:read',
    'plans:create',
    'plans:update',
    'plans:approve',
    'approvals:read',
    'approvals:decide',
  ],

  creative_contributor: [
    'projects:read',
    'creatives:create',
    'creatives:read',
    'creatives:update',
    'media:read',
    'media:upload',
    'media:update',
    'brand:read',
    'audience:read',
    'analytics:read',
    'plans:read',
    'plans:create',
    'plans:update',
    'approvals:read',
  ],

  client_approver: [
    'projects:read',
    'creatives:read',
    'creatives:approve',
    'media:read',
    'brand:read',
    'audience:read',
    'analytics:read',
    'plans:read',
    'plans:approve',
    'approvals:read',
    'approvals:decide',
  ],

  sales_agent: [
    'projects:read',
    'creatives:read',
    'media:read',
    'brand:read',
    'leads:read',
    'leads:write',
  ],

  viewer: [
    'projects:read',
    'creatives:read',
    'media:read',
    'brand:read',
    'audience:read',
    'campaigns:read',
    'leads:read',
    'analytics:read',
    'plans:read',
    'approvals:read',
  ],
};

/**
 * Normalizes any legacy or alias role string into standard UserRole
 */
export function normalizeRole(rawRole?: string): UserRole {
  if (!rawRole) return 'viewer';
  const r = rawRole.toLowerCase().trim();

  switch (r) {
    case 'platform_admin':
      return 'platform_admin';
    case 'org_owner':
    case 'owner':
    case 'admin':
    case 'org_admin':
      return 'org_owner';
    case 'marketing_manager':
    case 'org_manager':
      return 'marketing_manager';
    case 'creative_contributor':
    case 'creative_editor':
      return 'creative_contributor';
    case 'client_approver':
    case 'client_reviewer':
      return 'client_approver';
    case 'sales_agent':
    case 'agent':
      return 'sales_agent';
    case 'viewer':
    default:
      return 'viewer';
  }
}

/**
 * Checks if a normalized role possesses a given permission
 */
export function hasPermission(role: string, permission: Permission): boolean {
  const normalized = normalizeRole(role);
  const permissions = ROLE_PERMISSIONS[normalized] || [];
  return permissions.includes(permission);
}
