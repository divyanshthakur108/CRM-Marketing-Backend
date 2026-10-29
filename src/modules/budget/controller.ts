import { Request, Response } from 'express';
import { budgetService } from './service.js';
import { parseMonthParam, updateBudgetSchema } from './validation.js';
import { AppError } from '../../utils/AppError.js';

export class BudgetController {
  async getBudget(req: Request, res: Response): Promise<void> {
    const orgId = req.membership?.organizationId;
    if (!orgId) throw AppError.unauthorized('Organization context required');

    const monthParam = req.params.month;
    const yearQuery = req.query.year as string | undefined;
    const { month, year } = parseMonthParam(monthParam, yearQuery);

    const budget = await budgetService.getBudget(orgId, month, year);
    res.status(200).json({
      success: true,
      data: budget,
    });
  }

  async updateBudget(req: Request, res: Response): Promise<void> {
    const orgId = req.membership?.organizationId;
    if (!orgId) throw AppError.unauthorized('Organization context required');

    const monthParam = req.params.month;
    const yearQuery = req.query.year as string | undefined;
    const { month, year } = parseMonthParam(monthParam, yearQuery);

    const validated = updateBudgetSchema.parse(req.body);
    const budget = await budgetService.updateBudget(orgId, month, year, validated);

    res.status(200).json({
      success: true,
      data: budget,
    });
  }
}

export const budgetController = new BudgetController();
