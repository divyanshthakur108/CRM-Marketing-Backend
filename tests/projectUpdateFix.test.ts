import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Types } from 'mongoose';
import { projectService } from '../src/modules/projects/service.js';
import { Project } from '../src/models/Project.js';
import { creativeService } from '../src/modules/ai/creativeService.js';
import { errorHandler } from '../src/middleware/errorHandler.js';
import { Request, Response } from 'express';

describe('Project Update & Tenant ID Safety', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(creativeService, 'flagCreativesForReReview').mockResolvedValue(0);
  });

  it('allows platform admin to retrieve and update project regardless of orgId being non-ObjectId', async () => {
    const mockProjectId = new Types.ObjectId().toString();
    const mockOrgId = new Types.ObjectId();

    const mockProjectDoc: any = {
      _id: new Types.ObjectId(mockProjectId),
      name: 'DLF',
      slug: 'dlf',
      category: 'COMMERCIAL',
      subtype: 'Office',
      status: 'ACTIVE',
      organizationId: mockOrgId,
      location: { address: 'mohali', city: 'CHANDIGARH' },
      priceRange: { min: 15000000, max: 35000000, display: '₹ 1.5 Cr - ₹ 3.5 Cr' },
      details: {},
      save: vi.fn().mockResolvedValue(true),
      markModified: vi.fn(),
    };

    vi.spyOn(Project, 'findById').mockResolvedValue(mockProjectDoc);

    // Call updateProject with orgId as 'platform-root' (which was causing BSONError before the fix)
    const result = await projectService.updateProject(
      'platform-root',
      mockProjectId,
      {
        name: 'DLF',
        category: 'COMMERCIAL',
        subtype: 'Office',
        status: 'ACTIVE',
        location: {
          address: 'mohali',
          city: 'CHANDIGARH',
          pincode: '144224',
        },
      },
      true // isPlatformAdmin
    );

    expect(result).toBeDefined();
    expect(mockProjectDoc.save).toHaveBeenCalled();
    expect(mockProjectDoc.location.pincode).toBe('144224');
  });

  it('errorHandler maps Mongoose ValidationError to 400 VALIDATION_ERROR instead of 500', () => {
    const err: any = new Error('Validation failed');
    err.name = 'ValidationError';
    err.errors = {
      priceRange: { message: 'Pricing range is required' },
    };

    const req = { id: 'req-1', method: 'PATCH', originalUrl: '/api/v1/projects/123' } as Request;
    let statusCode = 0;
    let jsonPayload: any = null;
    const res = {
      status: (code: number) => {
        statusCode = code;
        return {
          json: (data: any) => {
            jsonPayload = data;
          },
        };
      },
    } as unknown as Response;

    errorHandler(err, req, res, () => {});

    expect(statusCode).toBe(400);
    expect(jsonPayload.success).toBe(false);
    expect(jsonPayload.error.code).toBe('VALIDATION_ERROR');
    expect(jsonPayload.error.details).toEqual([
      { field: 'priceRange', message: 'Pricing range is required' },
    ]);
  });

  it('errorHandler maps MongoDB Duplicate Key error (11000) to 409 DUPLICATE_RESOURCE instead of 500', () => {
    const err: any = new Error('E11000 duplicate key error');
    err.code = 11000;
    err.keyValue = { slug: 'dlf' };

    const req = { id: 'req-2', method: 'PATCH', originalUrl: '/api/v1/projects/123' } as Request;
    let statusCode = 0;
    let jsonPayload: any = null;
    const res = {
      status: (code: number) => {
        statusCode = code;
        return {
          json: (data: any) => {
            jsonPayload = data;
          },
        };
      },
    } as unknown as Response;

    errorHandler(err, req, res, () => {});

    expect(statusCode).toBe(409);
    expect(jsonPayload.success).toBe(false);
    expect(jsonPayload.error.code).toBe('DUPLICATE_RESOURCE');
    expect(jsonPayload.error.message).toContain('slug');
  });
});
