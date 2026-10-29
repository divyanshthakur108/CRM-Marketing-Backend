import { Types } from 'mongoose';
import { Project, IProject } from '../../models/Project.js';
import { PropertyUnit, IPropertyUnit, IUnitChangeHistory } from '../../models/PropertyUnit.js';
import { MediaAsset } from '../../models/MediaAsset.js';
import { AuditLog } from '../../models/AuditLog.js';
import { AppError } from '../../utils/AppError.js';
import {
  CreateProjectInput,
  UpdateProjectInput,
  CreateUnitInput,
  UpdateUnitInput,
  isPlotType,
} from './validation.js';
import { creativeService } from '../ai/creativeService.js';
import { logger } from '../../config/logger.js';

export interface ProjectListQuery {
  category?: string;
  status?: string;
  search?: string;
  page?: number;
  limit?: number;
}

export interface UnitListQuery {
  status?: string;
  unitType?: string;
  search?: string;
}

class ProjectService {
  private toObjectId(id: Types.ObjectId | string): Types.ObjectId {
    return typeof id === 'string' ? new Types.ObjectId(id) : id;
  }

  private generateSlug(name: string): string {
    return name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  private async getUniqueSlug(organizationId: Types.ObjectId, baseName: string, excludeId?: Types.ObjectId): Promise<string> {
    const baseSlug = this.generateSlug(baseName) || 'project';
    let slug = baseSlug;
    let counter = 1;

    let isUnique = false;
    while (!isUnique) {
      const existing = await Project.findOne({
        organizationId,
        slug,
        ...(excludeId ? { _id: { $ne: excludeId } } : {}),
      });

      if (!existing) {
        isUnique = true;
      } else {
        slug = `${baseSlug}-${counter++}`;
      }
    }

    return slug;
  }

  public async listProjects(orgId: Types.ObjectId | string, query: ProjectListQuery = {}) {
    const organizationId = this.toObjectId(orgId);
    const filter: Record<string, unknown> = { organizationId };

    if (query.category) {
      filter.category = query.category.toUpperCase();
    }

    if (query.status) {
      filter.status = query.status.toUpperCase();
    }

    if (query.search) {
      filter.$or = [
        { name: { $regex: query.search, $options: 'i' } },
        { subtype: { $regex: query.search, $options: 'i' } },
        { 'location.city': { $regex: query.search, $options: 'i' } },
        { 'location.microMarket': { $regex: query.search, $options: 'i' } },
      ];
    }

    const projects = await Project.find(filter).sort({ updatedAt: -1 });
    
    // Attach unit count per project for dashboard overview
    const projectIds = projects.map((p) => p._id);
    const unitCounts = await PropertyUnit.aggregate([
      { $match: { organizationId, projectId: { $in: projectIds } } },
      { $group: { _id: '$projectId', totalUnits: { $sum: 1 } } },
    ]);

    const unitCountMap = new Map<string, number>();
    for (const uc of unitCounts) {
      unitCountMap.set(uc._id.toString(), uc.totalUnits);
    }

    const projectsWithCounts = projects.map((p) => {
      const doc = p.toObject();
      return {
        ...doc,
        totalUnits: unitCountMap.get(p._id.toString()) || 0,
      };
    });

    return projectsWithCounts;
  }

  public async getProjectById(orgId: Types.ObjectId | string, projectId: string): Promise<IProject> {
    const organizationId = this.toObjectId(orgId);
    if (!Types.ObjectId.isValid(projectId)) {
      throw AppError.notFound('Project not found');
    }

    const project = await Project.findOne({
      _id: projectId,
      organizationId,
    });

    if (!project) {
      throw AppError.notFound('Project not found or belongs to another organization');
    }

    return project;
  }

  public async createProject(orgId: Types.ObjectId | string, input: CreateProjectInput): Promise<IProject> {
    const organizationId = this.toObjectId(orgId);
    const slug = await this.getUniqueSlug(organizationId, input.name);

    const project = await Project.create({
      ...input,
      organizationId,
      slug,
    });

    return project;
  }

  public async updateProject(
    orgId: Types.ObjectId | string,
    projectId: string,
    input: UpdateProjectInput
  ): Promise<IProject> {
    const organizationId = this.toObjectId(orgId);
    const project = await this.getProjectById(organizationId, projectId);

    if (input.name && input.name !== project.name) {
      project.slug = await this.getUniqueSlug(organizationId, input.name, project._id as Types.ObjectId);
      project.name = input.name;
    }

    if (input.category) project.category = input.category;
    if (input.subtype) project.subtype = input.subtype;
    if (input.status) project.status = input.status;
    if (input.reraNumber !== undefined) project.reraNumber = input.reraNumber;
    if (input.coverImageUrl !== undefined) project.coverImageUrl = input.coverImageUrl;
    if (input.privateNotes !== undefined) project.privateNotes = input.privateNotes;

    if (input.location) {
      project.location = {
        ...project.location,
        ...input.location,
      };
    }

    if (input.priceRange) {
      project.priceRange = {
        ...project.priceRange,
        ...input.priceRange,
      };
    }

    if (input.amenities) project.amenities = input.amenities;
    if (input.details) {
      project.details = {
        ...project.details,
        ...input.details,
      };
    }

    if (input.ownerContacts) project.ownerContacts = input.ownerContacts;
    if (input.privateDocuments) project.privateDocuments = input.privateDocuments;

    await project.save();

    const hasSpecChanges = Boolean(
      input.priceRange || input.location || input.amenities || input.reraNumber || input.details
    );
    if (hasSpecChanges) {
      try {
        await creativeService.flagCreativesForReReview(
          organizationId,
          project._id as Types.ObjectId,
          'Project master specifications updated'
        );
      } catch {
        // Non-blocking
      }
    }

    return project;
  }

  public async deleteProject(orgId: Types.ObjectId | string, projectId: string): Promise<void> {
    const organizationId = this.toObjectId(orgId);
    const project = await this.getProjectById(organizationId, projectId);

    // Delete all units belonging to the project
    await PropertyUnit.deleteMany({ organizationId, projectId: project._id });
    await project.deleteOne();
  }

  /**
   * Returns project data sanitized for public ad rendering
   * Strips ownerContacts, privateDocuments, and privateNotes
   */
  public async getPublicAdProject(orgId: Types.ObjectId | string, projectId: string) {
    const organizationId = this.toObjectId(orgId);
    const project = await this.getProjectById(organizationId, projectId);
    const obj = project.toObject() as Partial<IProject>;

    delete obj.ownerContacts;
    delete obj.privateDocuments;
    delete obj.privateNotes;

    return obj;
  }

  // ================= UNIT METHODS =================

  public async listUnits(
    orgId: Types.ObjectId | string,
    projectId: string,
    query: UnitListQuery = {}
  ): Promise<IPropertyUnit[]> {
    const organizationId = this.toObjectId(orgId);
    await this.getProjectById(organizationId, projectId);

    const filter: Record<string, unknown> = {
      organizationId,
      projectId: new Types.ObjectId(projectId),
    };

    if (query.status) {
      filter.status = query.status.toUpperCase();
    }

    if (query.unitType) {
      filter.unitType = query.unitType;
    }

    if (query.search) {
      filter.$or = [
        { unitNumber: { $regex: query.search, $options: 'i' } },
        { tower: { $regex: query.search, $options: 'i' } },
      ];
    }

    return PropertyUnit.find(filter).sort({ unitNumber: 1 });
  }

  public async getUnitById(
    orgId: Types.ObjectId | string,
    projectId: string,
    unitId: string
  ): Promise<IPropertyUnit> {
    const organizationId = this.toObjectId(orgId);
    if (!Types.ObjectId.isValid(unitId)) {
      throw AppError.notFound('Unit not found');
    }

    const unit = await PropertyUnit.findOne({
      _id: unitId,
      projectId,
      organizationId,
    });

    if (!unit) {
      throw AppError.notFound('Unit not found in this project');
    }

    return unit;
  }

  public async createUnit(
    orgId: Types.ObjectId | string,
    projectId: string,
    input: CreateUnitInput
  ): Promise<IPropertyUnit> {
    const organizationId = this.toObjectId(orgId);
    const project = await this.getProjectById(organizationId, projectId);

    // Enforce per-category validation if project is a plot
    const isPlot = project.subtype.toLowerCase().includes('plot') || input.unitType.toLowerCase().includes('plot');
    if (isPlot) {
      if (input.floor !== undefined && input.floor !== null) {
        throw AppError.badRequest('Plots cannot specify floor details', 'VALIDATION_ERROR', { field: 'floor' });
      }
      const attrs = (input.attributes || {}) as Record<string, unknown>;
      if (attrs.bhk !== undefined || attrs.furnishing !== undefined) {
        throw AppError.badRequest('Plots cannot specify BHK or furnishing details', 'VALIDATION_ERROR', { field: 'attributes' });
      }
    }

    const existing = await PropertyUnit.findOne({
      organizationId,
      projectId: project._id,
      unitNumber: input.unitNumber.trim(),
    });

    if (existing) {
      throw AppError.conflict(`Unit number '${input.unitNumber}' already exists in this project`);
    }

    const unit = await PropertyUnit.create({
      ...input,
      organizationId,
      projectId: project._id,
      changeHistory: [],
    });

    return unit;
  }

  public async updateUnit(
    orgId: Types.ObjectId | string,
    projectId: string,
    unitId: string,
    input: UpdateUnitInput,
    userId?: string
  ): Promise<IPropertyUnit> {
    const organizationId = this.toObjectId(orgId);
    const unit = await this.getUnitById(organizationId, projectId, unitId);
    const historyEntries: IUnitChangeHistory[] = [];

    // Track price change in changeHistory
    if (input.price !== undefined && input.price !== unit.price) {
      historyEntries.push({
        field: 'price',
        oldValue: unit.price,
        newValue: input.price,
        changedBy: userId && Types.ObjectId.isValid(userId) ? new Types.ObjectId(userId) : undefined,
        timestamp: new Date(),
        reason: input.changeReason || 'Price updated',
      });
      unit.price = input.price;
    }

    // Track status/availability change in changeHistory
    if (input.status && input.status !== unit.status) {
      historyEntries.push({
        field: 'status',
        oldValue: unit.status,
        newValue: input.status,
        changedBy: userId && Types.ObjectId.isValid(userId) ? new Types.ObjectId(userId) : undefined,
        timestamp: new Date(),
        reason: input.changeReason || `Status changed from ${unit.status} to ${input.status}`,
      });
      unit.status = input.status;
    }

    if (input.unitNumber !== undefined) unit.unitNumber = input.unitNumber.trim();
    if (input.unitType !== undefined) unit.unitType = input.unitType;
    if (input.floor !== undefined) unit.floor = input.floor === null ? undefined : input.floor;
    if (input.tower !== undefined) unit.tower = input.tower;
    if (input.carpetAreaSqFt !== undefined) unit.carpetAreaSqFt = input.carpetAreaSqFt;
    if (input.superBuiltUpAreaSqFt !== undefined) unit.superBuiltUpAreaSqFt = input.superBuiltUpAreaSqFt;
    if (input.priceDisplay !== undefined) unit.priceDisplay = input.priceDisplay;

    if (input.attributes) {
      unit.attributes = {
        ...unit.attributes,
        ...input.attributes,
      };
    }

    if (historyEntries.length > 0) {
      unit.changeHistory = [...(unit.changeHistory || []), ...historyEntries];
    }

    await unit.save();

    if (input.price !== undefined || input.carpetAreaSqFt !== undefined || input.attributes) {
      try {
        await creativeService.flagCreativesForReReview(
          organizationId,
          projectId,
          'Unit inventory specifications updated'
        );
      } catch {
        // Non-blocking
      }
    }

    return unit;
  }

  public async deleteUnit(
    orgId: Types.ObjectId | string,
    projectId: string,
    unitId: string
  ): Promise<void> {
    const organizationId = this.toObjectId(orgId);
    const unit = await this.getUnitById(organizationId, projectId, unitId);
    await unit.deleteOne();
  }

  public async submitProject(
    orgId: Types.ObjectId | string,
    projectId: string,
    userId?: string,
    clientVersion?: number
  ): Promise<{ project: IProject; isAlreadyReady: boolean }> {
    const organizationId = this.toObjectId(orgId);
    const project = await this.getProjectById(organizationId, projectId);

    // 1. Optimistic Concurrency Check (409 on stale version)
    if (clientVersion !== undefined && clientVersion !== null) {
      if (project.version !== undefined && Number(clientVersion) !== Number(project.version)) {
        throw AppError.conflict(
          'Project has been modified by another user or session. Please reload the latest version.',
          'VERSION_CONFLICT'
        );
      }
    }

    // 2. Idempotency Check: Submitting an already-ready project returns 200 without duplicate changes
    if (project.status === 'ready' || project.status === 'READY') {
      return { project, isAlreadyReady: true };
    }

    // 3. Re-validate everything on the server
    const errors: Array<{ section: number; field: string; message: string }> = [];

    // Section 1: Basic Information
    if (!project.name || project.name.trim().length < 3) {
      errors.push({
        section: 1,
        field: 'name',
        message: 'Project name must be at least 3 characters',
      });
    }

    if (!project.category || !['RESIDENTIAL', 'COMMERCIAL', 'INDUSTRIAL'].includes(project.category.toUpperCase())) {
      errors.push({
        section: 1,
        field: 'category',
        message: 'Valid project category is required',
      });
    }

    if (!project.location?.address || project.location.address.trim().length < 3) {
      errors.push({
        section: 1,
        field: 'address',
        message: 'Street address is required (min 3 characters)',
      });
    }

    if (!project.location?.city || project.location.city.trim().length < 2) {
      errors.push({
        section: 1,
        field: 'city',
        message: 'City is required',
      });
    }

    if (!project.location?.pincode || project.location.pincode.trim().length < 3) {
      errors.push({
        section: 1,
        field: 'pincode',
        message: 'Postal code is required',
      });
    }

    const contactPhone =
      project.ownerContacts?.[0]?.phone ||
      ((project.details as Record<string, unknown>)?.contactNumber as string);
    if (!contactPhone || contactPhone.trim().length < 8) {
      errors.push({
        section: 1,
        field: 'contactNumber',
        message: 'Official contact phone number is required (min 8 digits)',
      });
    }

    if (!project.priceRange?.display || project.priceRange.display.trim().length === 0) {
      errors.push({
        section: 1,
        field: 'priceDisplay',
        message: 'Pricing range display is required',
      });
    }

    // Section 2: Property Specifications
    if (!project.subtype || project.subtype.trim().length === 0) {
      errors.push({
        section: 2,
        field: 'subtype',
        message: 'Property subtype specification is required',
      });
    }

    const details = (project.details || {}) as Record<string, unknown>;

    if (isPlotType(project.subtype)) {
      if (details.bhk || details.floor || details.totalFloors || details.furnishing) {
        errors.push({
          section: 2,
          field: 'subtype',
          message: 'Plots cannot specify BHK, floor, or furnishing details',
        });
      }
    } else if (project.category?.toUpperCase() === 'RESIDENTIAL') {
      if (!details.areaSqFt && !details.usableAreaSqFt && !details.carpetAreaSqFt) {
        errors.push({
          section: 2,
          field: 'areaSqFt',
          message: 'Carpet area is required for residential properties',
        });
      }
      if (!details.bhk) {
        errors.push({
          section: 2,
          field: 'bhk',
          message: 'BHK configuration is required for residential properties',
        });
      }
    } else if (project.category?.toUpperCase() === 'COMMERCIAL') {
      if (!details.usableAreaSqFt && !details.areaSqFt) {
        errors.push({
          section: 2,
          field: 'usableAreaSqFt',
          message: 'Usable carpet area is required for commercial properties',
        });
      }
    } else if (project.category?.toUpperCase() === 'INDUSTRIAL') {
      if (!details.industrialType) {
        errors.push({
          section: 2,
          field: 'industrialType',
          message: 'Industry classification is required for industrial properties',
        });
      }
    }

    // Section 3: Amenities & Features
    if (project.amenities !== undefined && !Array.isArray(project.amenities)) {
      errors.push({
        section: 3,
        field: 'amenities',
        message: 'Amenities must be an array of feature strings',
      });
    }

    // Section 4: Photos & Videos
    const mediaAssets = await MediaAsset.find({
      organizationId,
      projectId: project._id,
    }).lean();

    const hasApprovedCover = mediaAssets.some(
      (m) => m.isCover && (m.approvalStatus === 'APPROVED' || m.isApproved)
    );
    if (!hasApprovedCover) {
      errors.push({
        section: 4,
        field: 'coverImage',
        message: 'At least one approved cover image is required',
      });
    }

    const unclassified = mediaAssets.filter((m) => !m.category);
    if (unclassified.length > 0) {
      errors.push({
        section: 4,
        field: 'category',
        message: `${unclassified.length} file(s) are missing a category tag`,
      });
    }

    const unconsented = mediaAssets.filter((m) => {
      const asset = m as { rightsConsent?: { confirmed?: boolean }; rightsConsentConfirmed?: boolean };
      return asset.rightsConsent?.confirmed !== true && asset.rightsConsentConfirmed !== true;
    });
    if (unconsented.length > 0) {
      errors.push({
        section: 4,
        field: 'rightsConsent',
        message: 'Rights consent must be confirmed on every file used for marketing',
      });
    }

    const failedUploads = mediaAssets.filter(
      (m) => m.processingStatus === 'failed' || m.processingStatus === 'processing'
    );
    if (failedUploads.length > 0) {
      errors.push({
        section: 4,
        field: 'processingStatus',
        message: `${failedUploads.length} media file(s) are failed or pending processing and must be removed or completed`,
      });
    }

    if (errors.length > 0) {
      throw AppError.badRequest('Project validation failed', 'VALIDATION_ERROR', errors);
    }

    // 4. Update the project in one operation
    const nextVersion = (project.version || 1) + 1;
    const historyEntry = {
      action: 'SUBMIT_READY',
      fromStatus: project.status,
      toStatus: 'ready',
      version: project.version,
      changedBy: userId ? this.toObjectId(userId) : undefined,
      changedAt: new Date(),
      reason: 'Project specifications submitted and marked as ready',
      field: 'status',
      oldValue: project.status,
      newValue: 'ready',
    };

    const updated = await Project.findOneAndUpdate(
      { _id: project._id, organizationId },
      {
        $set: {
          status: 'ready',
          submittedAt: new Date(),
          submittedBy: userId ? this.toObjectId(userId) : undefined,
          version: nextVersion,
        },
        $push: {
          changeHistory: historyEntry,
        },
      },
      { new: true }
    );

    if (!updated) {
      throw AppError.internal('Database write failed during project submission');
    }

    // Write audit log
    await AuditLog.create({
      organizationId,
      userId: userId ? this.toObjectId(userId) : undefined,
      action: 'PROJECT_SUBMITTED',
      resourceType: 'Project',
      resourceId: project._id.toString(),
      details: {
        previousStatus: project.status,
        newStatus: 'ready',
        version: nextVersion,
        name: project.name,
      },
    });

    // Auto-generate poster + reel from client's approved project media
    try {
      const { creativeEngineService } = await import('../ai/creativeEngineService.js');
      await creativeEngineService.enqueueProjectCreatives(organizationId, project._id, userId);
    } catch (engineErr) {
      logger.error({ engineErr, projectId: project._id }, 'Failed to trigger creative engine on project submission');
    }

    return { project: updated, isAlreadyReady: false };
  }
}

export const projectService = new ProjectService();
