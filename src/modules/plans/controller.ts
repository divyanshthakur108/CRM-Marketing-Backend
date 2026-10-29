import { Request, Response } from 'express';
import { planService } from './service.js';
import {
  generatePlanSchema,
  createPlanItemSchema,
  updatePlanItemSchema,
  reschedulePlanItemSchema,
  approvePlanSchema,
  requestChangesSchema,
} from './validation.js';
import { AppError } from '../../utils/AppError.js';

export class PlanController {
  private getOrgId(req: Request): string | undefined {
    const raw = req.organizationId || (req.membership?.organizationId ? req.membership.organizationId.toString() : undefined);
    return raw;
  }

  async generatePlan(req: Request, res: Response): Promise<void> {
    const orgId = this.getOrgId(req);
    if (!orgId) throw AppError.unauthorized('Organization context required');

    const validated = generatePlanSchema.parse(req.body);
    const result = await planService.generateMonthlyPlan(orgId, validated);

    res.status(201).json({
      success: true,
      data: result,
      meta: {
        message: result.isExisting
          ? 'Found existing plan for this cycle.'
          : 'Draft monthly plan generated successfully.',
      },
    });
  }

  async getPlans(req: Request, res: Response): Promise<void> {
    const orgId = this.getOrgId(req);
    if (!orgId) {
      res.status(200).json({ success: true, data: [] });
      return;
    }

    const month = req.query.month ? parseInt(req.query.month as string, 10) : undefined;
    const year = req.query.year ? parseInt(req.query.year as string, 10) : undefined;

    const plans = await planService.getPlans(orgId, { month, year });
    res.status(200).json({
      success: true,
      data: plans,
    });
  }

  async getPlanById(req: Request, res: Response): Promise<void> {
    const orgId = this.getOrgId(req);
    if (!orgId) throw AppError.unauthorized('Organization context required');

    const result = await planService.getPlanById(orgId, req.params.id);
    res.status(200).json({
      success: true,
      data: result,
    });
  }

  async submitPlan(req: Request, res: Response): Promise<void> {
    const orgId = this.getOrgId(req);
    const userId = req.user?.userId;
    const userName = req.user?.email || 'User';
    if (!orgId || !userId) throw AppError.unauthorized('Auth context required');

    const plan = await planService.submitPlanForReview(orgId, req.params.id, userId, userName);
    res.status(200).json({
      success: true,
      data: plan,
      meta: { message: 'Plan submitted for review.' },
    });
  }

  async approvePlan(req: Request, res: Response): Promise<void> {
    const orgId = this.getOrgId(req);
    const userId = req.user?.userId;
    const userName = req.user?.email || 'User';
    const role = req.membership?.role || 'platform_admin';
    if (!orgId || !userId) throw AppError.unauthorized('Auth context required');

    const validated = approvePlanSchema.parse(req.body);
    const plan = await planService.approvePlan(orgId, req.params.id, userId, userName, role, validated.comments);

    res.status(200).json({
      success: true,
      data: plan,
      meta: { message: 'Plan officially approved.' },
    });
  }

  async requestChanges(req: Request, res: Response): Promise<void> {
    const orgId = this.getOrgId(req);
    const userId = req.user?.userId;
    const userName = req.user?.email || 'User';
    const role = req.membership?.role || 'platform_admin';
    if (!orgId || !userId) throw AppError.unauthorized('Auth context required');

    const validated = requestChangesSchema.parse(req.body);
    const plan = await planService.requestChangesOnPlan(orgId, req.params.id, userId, userName, role, validated.comments);

    res.status(200).json({
      success: true,
      data: plan,
      meta: { message: 'Changes requested on plan.' },
    });
  }

  // --- Plan Items ---

  async getPlanItems(req: Request, res: Response): Promise<void> {
    const orgId = this.getOrgId(req);
    if (!orgId) {
      res.status(200).json({
        success: true,
        data: [],
      });
      return;
    }

    const month = req.query.month ? parseInt(req.query.month as string, 10) : undefined;
    const year = req.query.year ? parseInt(req.query.year as string, 10) : undefined;
    const planId = req.query.planId as string | undefined;
    const projectId = req.query.projectId as string | undefined;

    const items = await planService.getPlanItems(orgId, { month, year, planId, projectId });
    res.status(200).json({
      success: true,
      data: items,
    });
  }

  async createPlanItem(req: Request, res: Response): Promise<void> {
    const orgId = this.getOrgId(req);
    if (!orgId) throw AppError.unauthorized('Organization context required');

    const validated = createPlanItemSchema.parse(req.body);
    const item = await planService.createPlanItem(orgId, validated);

    res.status(201).json({
      success: true,
      data: item,
    });
  }

  async updatePlanItem(req: Request, res: Response): Promise<void> {
    const orgId = this.getOrgId(req);
    if (!orgId) throw AppError.unauthorized('Organization context required');

    const validated = updatePlanItemSchema.parse(req.body);
    const item = await planService.updatePlanItem(orgId, req.params.id, validated);

    res.status(200).json({
      success: true,
      data: item,
    });
  }

  async reschedulePlanItem(req: Request, res: Response): Promise<void> {
    const orgId = this.getOrgId(req);
    if (!orgId) throw AppError.unauthorized('Organization context required');

    const validated = reschedulePlanItemSchema.parse(req.body);
    const item = await planService.reschedulePlanItem(orgId, req.params.id, validated);

    res.status(200).json({
      success: true,
      data: item,
      meta: { message: `Rescheduled to ${item.scheduledDate.toISOString().slice(0, 10)} ${item.scheduledTime}` },
    });
  }

  async pausePlanItem(req: Request, res: Response): Promise<void> {
    const orgId = this.getOrgId(req);
    if (!orgId) throw AppError.unauthorized('Organization context required');

    const item = await planService.pausePlanItem(orgId, req.params.id);
    res.status(200).json({
      success: true,
      data: item,
      meta: { message: 'Plan item paused' },
    });
  }

  async resumePlanItem(req: Request, res: Response): Promise<void> {
    const orgId = this.getOrgId(req);
    if (!orgId) throw AppError.unauthorized('Organization context required');

    const item = await planService.resumePlanItem(orgId, req.params.id);
    res.status(200).json({
      success: true,
      data: item,
      meta: { message: 'Plan item scheduled' },
    });
  }

  async cancelPlanItem(req: Request, res: Response): Promise<void> {
    const orgId = this.getOrgId(req);
    if (!orgId) throw AppError.unauthorized('Organization context required');

    const item = await planService.cancelPlanItem(orgId, req.params.id);
    res.status(200).json({
      success: true,
      data: item,
      meta: { message: 'Plan item cancelled' },
    });
  }

  async deletePlanItem(req: Request, res: Response): Promise<void> {
    const orgId = this.getOrgId(req);
    if (!orgId) throw AppError.unauthorized('Organization context required');

    const result = await planService.deletePlanItem(orgId, req.params.id);
    res.status(200).json(result);
  }
}

export const planController = new PlanController();
