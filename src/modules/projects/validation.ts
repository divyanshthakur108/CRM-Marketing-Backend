import { z } from 'zod';

export const isPlotType = (typeStr?: string): boolean => {
  if (!typeStr) return false;
  const lower = typeStr.toLowerCase().trim();
  return lower.includes('plot') || lower.includes('land');
};

export const createProjectSchema = z
  .object({
    name: z.string().min(2, 'Project name must be at least 2 characters'),
    category: z.enum(['RESIDENTIAL', 'COMMERCIAL', 'INDUSTRIAL']),
    subtype: z.string().min(1, 'Subtype is required'),
    status: z.enum(['DRAFT', 'ACTIVE', 'SOLD_OUT', 'ARCHIVED']).default('DRAFT'),
    reraNumber: z.string().optional().default(''),
    location: z
      .object({
        address: z.string().optional().default(''),
        city: z.string().optional().default(''),
        microMarket: z.string().optional().default(''),
        state: z.string().optional().default(''),
        pincode: z.string().optional().default(''),
      })
      .optional()
      .default({
        address: '',
        city: '',
        microMarket: '',
        state: '',
        pincode: '',
      }),
    priceRange: z
      .object({
        min: z.number().default(0),
        max: z.number().default(0),
        display: z.string().default('Price on Request'),
      })
      .optional()
      .default({
        min: 0,
        max: 0,
        display: 'Price on Request',
      }),
    amenities: z.array(z.string()).optional().default([]),
    coverImageUrl: z.string().optional(),
    details: z.record(z.string(), z.unknown()).optional().default({}),
    ownerContacts: z
      .array(
        z.object({
          name: z.string(),
          phone: z.string(),
          email: z.string().email().or(z.literal('')).optional(),
          role: z.string().optional(),
        })
      )
      .optional()
      .default([]),
    privateDocuments: z
      .array(
        z.object({
          title: z.string(),
          url: z.string(),
          documentType: z.string().optional(),
        })
      )
      .optional()
      .default([]),
    privateNotes: z.string().optional(),
  })
  .refine(
    (data) => {
      // Per-category validation: Plots reject BHK, floor, and furnishing
      if (isPlotType(data.subtype)) {
        const details = (data.details || {}) as Record<string, unknown>;
        if (
          details.bhk !== undefined ||
          details.floor !== undefined ||
          details.totalFloors !== undefined ||
          details.furnishing !== undefined
        ) {
          return false;
        }
      }
      return true;
    },
    {
      message: 'Plots cannot specify BHK, floor, total floors, or furnishing details',
      path: ['details'],
    }
  );

export const updateProjectSchema = z
  .object({
    name: z.string().min(2).optional(),
    category: z.enum(['RESIDENTIAL', 'COMMERCIAL', 'INDUSTRIAL']).optional(),
    subtype: z.string().optional(),
    status: z.enum(['DRAFT', 'ACTIVE', 'SOLD_OUT', 'ARCHIVED']).optional(),
    reraNumber: z.string().optional(),
    location: z
      .object({
        address: z.string().optional(),
        city: z.string().optional(),
        microMarket: z.string().optional(),
        state: z.string().optional(),
        pincode: z.string().optional(),
      })
      .optional(),
    priceRange: z
      .object({
        min: z.number().optional(),
        max: z.number().optional(),
        display: z.string().optional(),
      })
      .optional(),
    amenities: z.array(z.string()).optional(),
    coverImageUrl: z.string().optional(),
    details: z.record(z.string(), z.unknown()).optional(),
    ownerContacts: z
      .array(
        z.object({
          name: z.string(),
          phone: z.string(),
          email: z.string().email().or(z.literal('')).optional(),
          role: z.string().optional(),
        })
      )
      .optional(),
    privateDocuments: z
      .array(
        z.object({
          title: z.string(),
          url: z.string(),
          documentType: z.string().optional(),
        })
      )
      .optional(),
    privateNotes: z.string().optional(),
  })
  .refine(
    (data) => {
      if (isPlotType(data.subtype) && data.details) {
        const details = data.details as Record<string, unknown>;
        if (
          details.bhk !== undefined ||
          details.floor !== undefined ||
          details.totalFloors !== undefined ||
          details.furnishing !== undefined
        ) {
          return false;
        }
      }
      return true;
    },
    {
      message: 'Plots cannot specify BHK, floor, total floors, or furnishing details',
      path: ['details'],
    }
  );

export const createUnitSchema = z
  .object({
    unitNumber: z.string().min(1, 'Unit number is required'),
    unitType: z.string().min(1, 'Unit type is required'),
    floor: z.number().optional(),
    tower: z.string().optional(),
    carpetAreaSqFt: z.number().min(1, 'Carpet area must be greater than 0'),
    superBuiltUpAreaSqFt: z.number().optional(),
    price: z.number().min(0, 'Price must be 0 or greater'),
    priceDisplay: z.string().optional(),
    status: z.enum(['AVAILABLE', 'BLOCKED', 'SOLD']).default('AVAILABLE'),
    attributes: z.record(z.string(), z.unknown()).optional().default({}),
  })
  .refine(
    (data) => {
      // Per-category validation: Plots reject BHK, floor, and furnishing
      if (isPlotType(data.unitType)) {
        if (data.floor !== undefined && data.floor !== null) {
          return false;
        }
        const attrs = (data.attributes || {}) as Record<string, unknown>;
        if (attrs.bhk !== undefined || attrs.furnishing !== undefined) {
          return false;
        }
      }
      return true;
    },
    {
      message: 'Plots cannot specify BHK, floor, or furnishing details',
      path: ['unitType'],
    }
  );

export const updateUnitSchema = z
  .object({
    unitNumber: z.string().min(1).optional(),
    unitType: z.string().min(1).optional(),
    floor: z.number().nullable().optional(),
    tower: z.string().optional(),
    carpetAreaSqFt: z.number().min(1).optional(),
    superBuiltUpAreaSqFt: z.number().optional(),
    price: z.number().min(0).optional(),
    priceDisplay: z.string().optional(),
    status: z.enum(['AVAILABLE', 'BLOCKED', 'SOLD']).optional(),
    attributes: z.record(z.string(), z.unknown()).optional(),
    changeReason: z.string().optional(),
  })
  .refine(
    (data) => {
      if (isPlotType(data.unitType)) {
        if (data.floor !== undefined && data.floor !== null) {
          return false;
        }
        const attrs = (data.attributes || {}) as Record<string, unknown>;
        if (attrs.bhk !== undefined || attrs.furnishing !== undefined) {
          return false;
        }
      }
      return true;
    },
    {
      message: 'Plots cannot specify BHK, floor, or furnishing details',
      path: ['unitType'],
    }
  );

export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
export type CreateUnitInput = z.infer<typeof createUnitSchema>;
export type UpdateUnitInput = z.infer<typeof updateUnitSchema>;
