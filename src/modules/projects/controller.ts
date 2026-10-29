import { Request, Response } from 'express';
import { projectService } from './service.js';
import {
  createProjectSchema,
  updateProjectSchema,
  createUnitSchema,
  updateUnitSchema,
} from './validation.js';
import { AppError } from '../../utils/AppError.js';

class ProjectController {
  public listProjects = async (req: Request, res: Response): Promise<void> => {
    if (!req.membership) {
      throw AppError.forbidden('Organization membership required');
    }

    const { category, status, search, page, limit } = req.query;
    const projects = await projectService.listProjects(req.membership.organizationId, {
      category: category as string,
      status: status as string,
      search: search as string,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });

    res.status(200).json({
      success: true,
      data: projects,
    });
  };

  public getProject = async (req: Request, res: Response): Promise<void> => {
    if (!req.membership) {
      throw AppError.forbidden('Organization membership required');
    }

    const project = await projectService.getProjectById(
      req.membership.organizationId,
      req.params.id
    );

    res.status(200).json({
      success: true,
      data: project,
    });
  };

  public createProject = async (req: Request, res: Response): Promise<void> => {
    if (!req.membership) {
      throw AppError.forbidden('Organization membership required');
    }

    const validated = createProjectSchema.parse(req.body);
    const project = await projectService.createProject(req.membership.organizationId, validated);

    res.status(201).json({
      success: true,
      data: project,
      message: 'Project created successfully',
    });
  };

  public updateProject = async (req: Request, res: Response): Promise<void> => {
    if (!req.membership) {
      throw AppError.forbidden('Organization membership required');
    }

    const validated = updateProjectSchema.parse(req.body);
    const project = await projectService.updateProject(
      req.membership.organizationId,
      req.params.id,
      validated
    );

    res.status(200).json({
      success: true,
      data: project,
      message: 'Project updated successfully',
    });
  };

  public deleteProject = async (req: Request, res: Response): Promise<void> => {
    if (!req.membership) {
      throw AppError.forbidden('Organization membership required');
    }

    await projectService.deleteProject(req.membership.organizationId, req.params.id);

    res.status(200).json({
      success: true,
      message: 'Project deleted successfully',
    });
  };

  public getPublicAdProject = async (req: Request, res: Response): Promise<void> => {
    if (!req.membership) {
      throw AppError.forbidden('Organization membership required');
    }

    const sanitized = await projectService.getPublicAdProject(
      req.membership.organizationId,
      req.params.id
    );

    res.status(200).json({
      success: true,
      data: sanitized,
    });
  };

  // ================= UNITS =================

  public listUnits = async (req: Request, res: Response): Promise<void> => {
    if (!req.membership) {
      throw AppError.forbidden('Organization membership required');
    }

    const { status, unitType, search } = req.query;
    const units = await projectService.listUnits(
      req.membership.organizationId,
      req.params.id,
      {
        status: status as string,
        unitType: unitType as string,
        search: search as string,
      }
    );

    res.status(200).json({
      success: true,
      data: units,
    });
  };

  public getUnit = async (req: Request, res: Response): Promise<void> => {
    if (!req.membership) {
      throw AppError.forbidden('Organization membership required');
    }

    const unit = await projectService.getUnitById(
      req.membership.organizationId,
      req.params.id,
      req.params.unitId
    );

    res.status(200).json({
      success: true,
      data: unit,
    });
  };

  public createUnit = async (req: Request, res: Response): Promise<void> => {
    if (!req.membership) {
      throw AppError.forbidden('Organization membership required');
    }

    const validated = createUnitSchema.parse(req.body);
    const unit = await projectService.createUnit(
      req.membership.organizationId,
      req.params.id,
      validated
    );

    res.status(201).json({
      success: true,
      data: unit,
      message: 'Unit created successfully',
    });
  };

  public updateUnit = async (req: Request, res: Response): Promise<void> => {
    if (!req.membership) {
      throw AppError.forbidden('Organization membership required');
    }

    const validated = updateUnitSchema.parse(req.body);
    const unit = await projectService.updateUnit(
      req.membership.organizationId,
      req.params.id,
      req.params.unitId,
      validated,
      req.user?.userId
    );

    res.status(200).json({
      success: true,
      data: unit,
      message: 'Unit updated successfully',
    });
  };

  public deleteUnit = async (req: Request, res: Response): Promise<void> => {
    if (!req.membership) {
      throw AppError.forbidden('Organization membership required');
    }

    await projectService.deleteUnit(
      req.membership.organizationId,
      req.params.id,
      req.params.unitId
    );

    res.status(200).json({
      success: true,
      message: 'Unit deleted successfully',
    });
  };

  public submitProject = async (req: Request, res: Response): Promise<void> => {
    if (!req.membership) {
      throw AppError.forbidden('Organization membership required');
    }

    const { version } = req.body || {};
    const memberUserId = req.membership.userId ? String(req.membership.userId) : undefined;
    const userId = req.user?.userId || memberUserId;
    const result = await projectService.submitProject(
      req.membership.organizationId,
      req.params.id,
      userId,
      version !== undefined && version !== null ? Number(version) : undefined
    );

    res.status(200).json({
      success: true,
      data: result.project,
      message: result.isAlreadyReady
        ? 'Project is already marked as ready'
        : 'Project saved and marked ready',
    });
  };
}

export const projectController = new ProjectController();
