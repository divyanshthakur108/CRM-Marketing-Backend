import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Request, Response } from 'express';
import { Types } from 'mongoose';
import { resolveTenant } from '../src/middleware/resolveTenant.js';
import { Organization } from '../src/models/Organization.js';
import { Membership } from '../src/models/Membership.js';
import { Project } from '../src/models/Project.js';

describe('resolveTenant Middleware', () => {
  const dummyAdminId = new Types.ObjectId().toString();
  const dummyOrgId = new Types.ObjectId().toString();
  const dummyProjectId = new Types.ObjectId().toString();

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('handles platform admin with x-organization-id: platform-root without CastError', async () => {
    const mockOrg = {
      _id: new Types.ObjectId(dummyOrgId),
      name: 'Default Org',
      status: 'ACTIVE',
    };

    vi.spyOn(Organization, 'findOne').mockReturnValue({
      sort: vi.fn().mockResolvedValue(mockOrg),
    } as any);

    vi.spyOn(Membership, 'findOne').mockReturnValue({
      sort: vi.fn().mockResolvedValue(null),
    } as any);

    vi.spyOn(Membership, 'findOneAndUpdate').mockResolvedValue({} as any);

    const req = {
      user: {
        userId: dummyAdminId,
        email: 'admin@realcrm.in',
        isPlatformAdmin: true,
      },
      headers: {
        'x-organization-id': 'platform-root',
      },
      query: {},
      body: {},
      originalUrl: '/api/v1/projects',
    } as unknown as Request;

    const res = {} as Response;
    let nextCalled = false;
    let nextError: unknown = null;

    const next = (err?: unknown) => {
      nextCalled = true;
      nextError = err;
    };

    await resolveTenant(req, res, next);

    expect(nextCalled).toBe(true);
    expect(nextError).toBeUndefined();
    expect(req.organizationId).toBe(dummyOrgId);
    expect(req.membership?.role).toBe('platform_admin');
    expect(Types.ObjectId.isValid(req.organizationId!)).toBe(true);
  });

  it('automatically resolves to the project organization when platform admin visits /projects/:id', async () => {
    const projectOrgId = new Types.ObjectId().toString();

    vi.spyOn(Project, 'findById').mockResolvedValue({
      _id: new Types.ObjectId(dummyProjectId),
      name: 'DLF Commercial Center',
      organizationId: new Types.ObjectId(projectOrgId),
    } as any);

    const req = {
      user: {
        userId: dummyAdminId,
        email: 'admin@realcrm.in',
        isPlatformAdmin: true,
      },
      headers: {
        'x-organization-id': 'platform-root',
      },
      params: {
        id: dummyProjectId,
      },
      query: {},
      body: {},
      originalUrl: `/api/v1/projects/${dummyProjectId}`,
    } as unknown as Request;

    const res = {} as Response;
    let nextCalled = false;
    let nextError: unknown = null;

    const next = (err?: unknown) => {
      nextCalled = true;
      nextError = err;
    };

    await resolveTenant(req, res, next);

    expect(nextCalled).toBe(true);
    expect(nextError).toBeUndefined();
    expect(req.organizationId).toBe(projectOrgId);
    expect(req.membership?.organizationId).toBe(projectOrgId);
    expect(req.membership?.role).toBe('platform_admin');
  });

  it('uses target organization directly when platform admin passes valid ObjectId', async () => {
    const targetOrgId = new Types.ObjectId().toString();
    const mockOrg = {
      _id: new Types.ObjectId(targetOrgId),
      name: 'Target Org',
      status: 'ACTIVE',
    };

    vi.spyOn(Organization, 'findById').mockResolvedValue(mockOrg as any);

    const req = {
      user: {
        userId: dummyAdminId,
        email: 'admin@realcrm.in',
        isPlatformAdmin: true,
      },
      headers: {
        'x-organization-id': targetOrgId,
      },
      query: {},
      body: {},
      originalUrl: '/api/v1/projects',
    } as unknown as Request;

    const res = {} as Response;
    let nextCalled = false;
    let nextError: unknown = null;

    const next = (err?: unknown) => {
      nextCalled = true;
      nextError = err;
    };

    await resolveTenant(req, res, next);

    expect(nextCalled).toBe(true);
    expect(nextError).toBeUndefined();
    expect(req.organizationId).toBe(targetOrgId);
    expect(req.membership?.organizationId).toBe(targetOrgId);
  });

  it('safely falls back to user default membership when normal user passes platform-root', async () => {
    const userOrgId = new Types.ObjectId().toString();
    const mockMembership = {
      _id: new Types.ObjectId(),
      organizationId: new Types.ObjectId(userOrgId),
      userId: new Types.ObjectId(),
      role: 'marketing_manager',
      status: 'ACTIVE',
    };

    vi.spyOn(Membership, 'findOne').mockReturnValue({
      sort: vi.fn().mockResolvedValue(mockMembership),
    } as any);

    const req = {
      user: {
        userId: new Types.ObjectId().toString(),
        email: 'agent@realcrm.in',
        isPlatformAdmin: false,
      },
      headers: {
        'x-organization-id': 'platform-root',
      },
      query: {},
      body: {},
      originalUrl: '/api/v1/projects',
    } as unknown as Request;

    const res = {} as Response;
    let nextCalled = false;
    let nextError: unknown = null;

    const next = (err?: unknown) => {
      nextCalled = true;
      nextError = err;
    };

    await resolveTenant(req, res, next);

    expect(nextCalled).toBe(true);
    expect(nextError).toBeUndefined();
    expect(req.organizationId).toBe(userOrgId);
    expect(req.membership?.role).toBe('marketing_manager');
  });
});

