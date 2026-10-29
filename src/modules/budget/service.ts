import { Types } from 'mongoose';
import { Budget, IBudget } from '../../models/Budget.js';
import { Project } from '../../models/Project.js';
import { AppError } from '../../utils/AppError.js';
import { UpdateBudgetInput } from './validation.js';

export class BudgetService {
  private toObjectId(id: Types.ObjectId | string): Types.ObjectId {
    return typeof id === 'string' ? new Types.ObjectId(id) : id;
  }

  /**
   * Retrieves budget for an organization and month.
   * If not created yet, provisions an initial template with the tenant's current projects.
   */
  async getBudget(
    organizationId: Types.ObjectId | string,
    month: number,
    year: number
  ): Promise<IBudget | Record<string, unknown>> {
    const orgId = this.toObjectId(organizationId);

    const existing = await Budget.findOne({
      organizationId: orgId,
      month,
      year,
    });

    if (existing) {
      return existing;
    }

    // Default template provisioned with existing active projects
    const projects = await Project.find({ organizationId: orgId }).select('_id name');
    const defaultAllocations = projects.map((p) => ({
      projectId: p._id,
      projectName: p.name,
      amount: 0,
      metaAds: 0,
      googleAds: 0,
      linkedinAds: 0,
      directWhatsapp: 0,
    }));

    return {
      organizationId: orgId,
      month,
      year,
      overallCap: 500000,
      currency: 'INR',
      projectAllocations: defaultAllocations,
      isTemplate: true,
    };
  }

  /**
   * Updates or creates the monthly budget with strict cap enforcement.
   * Rejects allocations that exceed the cap with 409 Conflict.
   */
  async updateBudget(
    organizationId: Types.ObjectId | string,
    month: number,
    year: number,
    data: UpdateBudgetInput
  ): Promise<IBudget> {
    const orgId = this.toObjectId(organizationId);

    // Calculate sum of project allocations
    const totalAllocated = data.projectAllocations.reduce((sum: number, item: { amount: number }) => sum + item.amount, 0);

    // Strict cap check: allocations cannot exceed overallCap
    if (totalAllocated > data.overallCap) {
      throw AppError.conflict(
        `Allocations exceed budget cap. Total allocated is ₹${totalAllocated.toLocaleString()}, but overall cap is ₹${data.overallCap.toLocaleString()}.`,
        'BUDGET_CAP_EXCEEDED'
      );
    }

    // Resolve project names if missing
    const resolvedAllocations = await Promise.all(
      data.projectAllocations.map(async (item) => {
        let name = item.projectName;
        if (!name && Types.ObjectId.isValid(item.projectId)) {
          const proj = await Project.findOne({
            _id: this.toObjectId(item.projectId),
            organizationId: orgId,
          }).select('name');
          if (proj) name = proj.name;
        }

        return {
          projectId: this.toObjectId(item.projectId),
          projectName: name || 'Project',
          amount: item.amount,
          metaAds: item.metaAds ?? 0,
          googleAds: item.googleAds ?? 0,
          linkedinAds: item.linkedinAds ?? 0,
          directWhatsapp: item.directWhatsapp ?? 0,
        };
      })
    );

    const updated = await Budget.findOneAndUpdate(
      {
        organizationId: orgId,
        month,
        year,
      },
      {
        $set: {
          overallCap: data.overallCap,
          currency: data.currency || 'INR',
          projectAllocations: resolvedAllocations,
        },
      },
      {
        new: true,
        upsert: true,
        runValidators: true,
      }
    );

    return updated;
  }
}

export const budgetService = new BudgetService();
