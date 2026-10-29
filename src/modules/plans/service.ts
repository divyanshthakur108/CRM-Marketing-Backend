import { Types, FilterQuery } from 'mongoose';
import { Plan, IPlan } from '../../models/Plan.js';
import {
  PlanItem,
  IPlanItem,
  PlanItemType,
  PlanItemChannel,
  ApprovalStatus,
  PublishStatus,
} from '../../models/PlanItem.js';
import { Project } from '../../models/Project.js';
import { Budget } from '../../models/Budget.js';
import { Approval } from '../../models/Approval.js';
import { AppError } from '../../utils/AppError.js';
import { parseMonthParam } from '../budget/validation.js';
import {
  GeneratePlanInput,
  CreatePlanItemInput,
  UpdatePlanItemInput,
  ReschedulePlanItemInput,
} from './validation.js';
import { rollingScheduler } from '../../scheduler/rollingScheduler.js';
import { jobQueue } from '../../queue/jobQueue.js';

export class PlanService {
  private toObjectId(id: Types.ObjectId | string): Types.ObjectId {
    if (typeof id !== 'string') return id;
    if (!Types.ObjectId.isValid(id)) {
      throw AppError.badRequest(`Invalid identifier format: ${id}`);
    }
    return new Types.ObjectId(id);
  }

  /**
   * Generates a monthly marketing plan using a deterministic rule-based scheduler.
   * Spreads items evenly across strategic calendar days per project and budget.
   */
  async generateMonthlyPlan(
    organizationId: Types.ObjectId | string,
    params: GeneratePlanInput
  ): Promise<{ plan: IPlan; items: IPlanItem[]; isExisting?: boolean }> {
    const orgId = this.toObjectId(organizationId);
    const { month, year } = parseMonthParam(String(params.month), params.year ? String(params.year) : undefined);

    // 1. Resolve target projects
    let projects = [];
    if (params.projectId && Types.ObjectId.isValid(params.projectId)) {
      const proj = await Project.findOne({ _id: this.toObjectId(params.projectId), organizationId: orgId });
      if (proj) projects.push(proj);
    }

    if (projects.length === 0) {
      projects = await Project.find({ organizationId: orgId }).limit(10);
    }

    if (projects.length === 0) {
      throw AppError.badRequest('No projects found in this organization. Please create at least one project before generating a plan.');
    }

    // 2. Check if a plan already exists
    const query: FilterQuery<IPlan> = {
      organizationId: orgId,
      month,
      year,
    };
    if (params.projectId) {
      query.projectId = this.toObjectId(params.projectId);
    }

    const existingPlan = await Plan.findOne(query);
    if (existingPlan && !params.overrideExisting) {
      const existingItems = await PlanItem.find({
        organizationId: orgId,
        planId: existingPlan._id,
      }).sort({ scheduledDate: 1 });

      return {
        plan: existingPlan,
        items: existingItems,
        isExisting: true,
      };
    }

    // 3. Read budget for the month to calculate project allocations
    const budget = await Budget.findOne({ organizationId: orgId, month, year });
    const totalBudget = budget?.overallCap || 500000;

    // 4. Create or replace the Plan
    let plan = existingPlan;
    if (plan && params.overrideExisting) {
      await PlanItem.deleteMany({ organizationId: orgId, planId: plan._id });
      plan.status = 'DRAFT';
      plan.version += 1;
    } else {
      const monthNames = [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'
      ];
      const cycleName =
        params.cycleName ||
        `${monthNames[month - 1]} ${year} Marketing Acceleration Plan`;

      plan = new Plan({
        organizationId: orgId,
        projectId: params.projectId ? this.toObjectId(params.projectId) : projects[0]._id,
        cycleName,
        month,
        year,
        status: 'DRAFT',
        version: 1,
        allocatedBudget: totalBudget,
        strategySummary: `Omni-channel marketing schedule across ${projects.length} project(s) targeting organic engagement and high-intent buyer leads with ₹${totalBudget.toLocaleString()} allocation.`,
      });
    }

    await plan.save();

    // 5. Rule-based scheduling templates
    const strategicDays = [2, 5, 7, 9, 12, 14, 16, 19, 21, 23, 26, 28];
    const formats: ('POST_4x5' | 'REEL_9x16' | 'CAROUSEL' | 'PAID_AD' | 'INSTAGRAM_REEL' | 'FACEBOOK_CAROUSEL' | 'LINKEDIN_POST' | 'WHATSAPP_BROADCAST')[] = [
      'INSTAGRAM_REEL',
      'FACEBOOK_CAROUSEL',
      'POST_4x5',
      'PAID_AD',
      'LINKEDIN_POST',
      'WHATSAPP_BROADCAST',
      'REEL_9x16',
      'CAROUSEL',
    ];

    const channels: ('INSTAGRAM' | 'FACEBOOK' | 'BOTH' | 'LINKEDIN' | 'WHATSAPP')[] = [
      'INSTAGRAM',
      'FACEBOOK',
      'BOTH',
      'LINKEDIN',
      'WHATSAPP',
      'BOTH',
    ];

    const contentThemes = [
      {
        topic: 'Architectural Showcase: Virtual Tour & Skyline Views',
        brief: 'High-production visual tour highlighting bespoke finishes, elevation architecture, and panoramic city views.',
        copy: 'Step inside luxury like never before. Experience grand layouts and panoramic balconies in every home.',
        cta: 'Book Exclusive Preview',
      },
      {
        topic: 'Floor Plan Deep-Dive: Spacious Living & Vaastu Compliance',
        brief: 'Exploded 3D floor plan graphics detailing carpet area efficiency, zero-dead-space design, and optimal natural lighting.',
        copy: 'Designed for generational living. See how every square foot maximizes elegance and natural ventilation.',
        cta: 'Download Floor Plans',
      },
      {
        topic: 'Location Advantage: Metro Connectivity & Top Tier Hubs',
        brief: 'Infographic carousel illustrating driving distances to key IT hubs, international schools, and metro corridors.',
        copy: 'Cut your daily commute in half. Located at the epicenter of growth, work, and premier leisure.',
        cta: 'Explore Location Map',
      },
      {
        topic: 'Early Bird Festive Incentives & Spot Booking Benefits',
        brief: 'High-conversion promotional creative with bold typography outlining zero stamp duty and payment flexibilities.',
        copy: 'Special festival release: Zero stamp duty for the first 15 buyers this month. Terms apply.',
        cta: 'Claim Limited Offer',
      },
      {
        topic: 'Clubhouse & Lifestyle Amenities Walkthrough',
        brief: 'Reel emphasizing 50,000 sq.ft. clubhouse, temperature-controlled pool, squash courts, and rooftop yoga deck.',
        copy: 'Resort living every single day. Over 40+ world-class amenities curated for your family wellness.',
        cta: 'Schedule Clubhouse Tour',
      },
      {
        topic: 'Investor Perspective: Rental Yields & Infrastructure Boom',
        brief: 'Data-driven carousel outlining annual appreciation trends, upcoming arterial corridors, and expected rental yields.',
        copy: 'Why top HNIs and NRIs are investing here: 14% CAGR appreciation track record and strong rental demand.',
        cta: 'Download Investment Deck',
      },
      {
        topic: 'Sample Residence Walkthrough: Premium Italian Marble & Kitchens',
        brief: 'Macro aesthetic walkthrough focusing on imported marble flooring, German fittings, and automation systems.',
        copy: 'Fittings that define perfection. Experience homes crafted with European design sensibilities.',
        cta: 'Schedule Private Walkthrough',
      },
      {
        topic: 'RERA Compliance & Construction Milestones',
        brief: 'Trust and compliance post highlighting verified RERA registrations, sanctioned approvals, and on-time progress.',
        copy: '100% peace of mind. RERA registered, transparent approvals, and construction advancing ahead of schedule.',
        cta: 'Verify RERA Details',
      },
    ];

    const itemsToCreate = [];
    const timezone = 'Asia/Kolkata';

    for (let i = 0; i < strategicDays.length; i++) {
      const day = strategicDays[i];
      const project = projects[i % projects.length];
      const theme = contentThemes[i % contentThemes.length];
      const format = formats[i % formats.length];
      const channel = channels[i % channels.length];
      const isPaid = format === 'PAID_AD' || i % 3 === 0;
      const proposedBudget = isPaid ? Math.round(totalBudget / 8) : 0;
      const time = i % 2 === 0 ? '18:00' : '11:00';

      const [hours, minutes] = time.split(':').map(Number);
      const scheduledDate = new Date(Date.UTC(year, month - 1, day, hours, minutes));

      itemsToCreate.push({
        organizationId: orgId,
        planId: plan._id,
        projectId: project._id,
        projectName: project.name,
        title: `${project.name} - ${theme.topic.split(':')[0]}`,
        type: format,
        channel,
        scheduledDate,
        scheduledTime: time,
        scheduledAt: scheduledDate,
        timezone,
        version: 1,
        isPaid,
        proposedBudget,
        topic: theme.topic,
        creativeBrief: theme.brief,
        copySnippet: theme.copy,
        previewUrl: '',
        targetAudience: 'Affluent Professionals, HNIs & First-time Luxury Buyers',
        ctaText: theme.cta,
        approvalStatus: 'DRAFT',
        publishStatus: 'SCHEDULED',
      });
    }

    const createdItems = (await PlanItem.insertMany(itemsToCreate)) as unknown as IPlanItem[];

    plan.itemsCount = createdItems.length;
    await plan.save();

    return {
      plan,
      items: createdItems,
      isExisting: false,
    };
  }

  /**
   * Lists plans for an organization.
   */
  async getPlans(organizationId: Types.ObjectId | string, filters: { month?: number; year?: number } = {}) {
    const orgId = this.toObjectId(organizationId);
    const query: FilterQuery<IPlan> = { organizationId: orgId };

    if (filters.month) query.month = filters.month;
    if (filters.year) query.year = filters.year;

    return Plan.find(query).sort({ year: -1, month: -1, createdAt: -1 });
  }

  /**
   * Gets a plan by ID along with its items and approval history.
   */
  async getPlanById(organizationId: Types.ObjectId | string, planId: string) {
    const orgId = this.toObjectId(organizationId);
    const plan = await Plan.findOne({ _id: this.toObjectId(planId), organizationId: orgId });
    if (!plan) throw AppError.notFound('Plan not found');

    const items = await PlanItem.find({ organizationId: orgId, planId: plan._id }).sort({ scheduledDate: 1 });
    const approvals = await Approval.find({ organizationId: orgId, planId: plan._id }).sort({ createdAt: -1 });

    return {
      plan,
      items,
      approvals,
    };
  }

  /**
   * Retrieves plan items for calendar display.
   */
  async getPlanItems(
    organizationId: Types.ObjectId | string,
    filters: { month?: number; year?: number; planId?: string; projectId?: string }
  ) {
    const orgId = this.toObjectId(organizationId);
    const query: FilterQuery<IPlanItem> = { organizationId: orgId };

    if (filters.planId) query.planId = this.toObjectId(filters.planId);
    if (filters.projectId) query.projectId = this.toObjectId(filters.projectId);

    if (filters.month && filters.year) {
      const startDate = new Date(Date.UTC(filters.year, filters.month - 1, 1));
      const endDate = new Date(Date.UTC(filters.year, filters.month, 1));
      query.scheduledDate = { $gte: startDate, $lt: endDate };
    }

    return PlanItem.find(query).sort({ scheduledDate: 1, scheduledTime: 1 });
  }

  /**
   * Creates a single new plan item.
   */
  async createPlanItem(organizationId: Types.ObjectId | string, data: CreatePlanItemInput) {
    const orgId = this.toObjectId(organizationId);
    const planId = this.toObjectId(data.planId);
    const projectId = this.toObjectId(data.projectId);

    const plan = await Plan.findOne({ _id: planId, organizationId: orgId });
    if (!plan) throw AppError.notFound('Plan not found');

    let projectName = data.projectName;
    if (!projectName) {
      const proj = await Project.findOne({ _id: projectId, organizationId: orgId });
      if (proj) projectName = proj.name;
    }

    const scheduledDate = new Date(data.scheduledDate);
    const [hours, minutes] = (data.scheduledTime || '18:00').split(':').map(Number);
    const scheduledAt = new Date(scheduledDate);
    scheduledAt.setHours(hours || 18, minutes || 0, 0, 0);

    const item = new PlanItem({
      organizationId: orgId,
      planId,
      projectId,
      projectName: projectName || 'Project',
      title: data.title,
      type: data.type,
      channel: data.channel || 'BOTH',
      scheduledDate,
      scheduledTime: data.scheduledTime || '18:00',
      scheduledAt,
      timezone: data.timezone || 'Asia/Kolkata',
      version: 1,
      isPaid: data.isPaid || false,
      proposedBudget: data.proposedBudget || 0,
      topic: data.topic,
      creativeBrief: data.creativeBrief,
      copySnippet: data.copySnippet || '',
      previewUrl: data.previewUrl || '',
      targetAudience: data.targetAudience || '',
      ctaText: data.ctaText || '',
      approvalStatus: 'DRAFT',
      publishStatus: 'SCHEDULED',
    });

    await item.save();
    await Plan.updateOne({ _id: planId }, { $inc: { itemsCount: 1 } });

    return item;
  }

  /**
   * Updates an item with optimistic locking (version mismatch prevention).
   */
  async updatePlanItem(
    organizationId: Types.ObjectId | string,
    itemId: string,
    data: UpdatePlanItemInput
  ) {
    const orgId = this.toObjectId(organizationId);
    const item = await PlanItem.findOne({ _id: this.toObjectId(itemId), organizationId: orgId });
    if (!item) throw AppError.notFound('Plan item not found');

    // Optimistic concurrency check
    if (data.version !== undefined && item.version !== data.version) {
      throw AppError.conflict(
        `Stale update rejected: Version mismatch (Client: ${data.version}, Server: ${item.version}). Item has been modified by another session.`,
        'CONCURRENT_UPDATE_CONFLICT'
      );
    }

    if (data.title !== undefined) item.title = data.title;
    if (data.type !== undefined) item.type = data.type as PlanItemType;
    if (data.channel !== undefined) item.channel = data.channel as PlanItemChannel;
    if (data.topic !== undefined) item.topic = data.topic;
    if (data.creativeBrief !== undefined) item.creativeBrief = data.creativeBrief;
    if (data.copySnippet !== undefined) item.copySnippet = data.copySnippet;
    if (data.previewUrl !== undefined) item.previewUrl = data.previewUrl;
    if (data.targetAudience !== undefined) item.targetAudience = data.targetAudience;
    if (data.ctaText !== undefined) item.ctaText = data.ctaText;
    if (data.isPaid !== undefined) item.isPaid = data.isPaid;
    if (data.proposedBudget !== undefined) item.proposedBudget = data.proposedBudget;
    if (data.approvalStatus !== undefined) item.approvalStatus = data.approvalStatus as ApprovalStatus;
    if (data.publishStatus !== undefined) item.publishStatus = data.publishStatus as PublishStatus;

    if (data.scheduledDate || data.scheduledTime || data.timezone) {
      if (data.scheduledDate) item.scheduledDate = new Date(data.scheduledDate);
      if (data.scheduledTime) item.scheduledTime = data.scheduledTime;
      if (data.timezone) item.timezone = data.timezone;

      const [hours, minutes] = (item.scheduledTime || '18:00').split(':').map(Number);
      const scheduledAt = new Date(item.scheduledDate);
      scheduledAt.setHours(hours || 18, minutes || 0, 0, 0);
      item.scheduledAt = scheduledAt;
    }

    item.version += 1;
    await item.save();

    // If cancelled or paused, cancel any pending rendering jobs
    if (item.publishStatus === 'CANCELLED' || item.publishStatus === 'PAUSED') {
      try {
        await jobQueue.cancelPendingJobsForPlanItem(
          orgId,
          item._id,
          `Item ${item.publishStatus.toLowerCase()}`
        );
      } catch {
        // Non-blocking
      }
    } else if (data.scheduledDate) {
      try {
        await rollingScheduler.handleItemRescheduled(
          orgId,
          item._id,
          item.scheduledAt || item.scheduledDate
        );
      } catch {
        // Non-blocking
      }
    }

    return item;
  }

  /**
   * Reschedules an item, updating scheduledDate, scheduledTime, and scheduledAt.
   * Returns the updated item and new status.
   */
  async reschedulePlanItem(
    organizationId: Types.ObjectId | string,
    itemId: string,
    data: ReschedulePlanItemInput
  ) {
    const orgId = this.toObjectId(organizationId);
    const item = await PlanItem.findOne({ _id: this.toObjectId(itemId), organizationId: orgId });
    if (!item) throw AppError.notFound('Plan item not found');

    if (data.version !== undefined && item.version !== data.version) {
      throw AppError.conflict(
        `Stale reschedule rejected: Version mismatch (Client: ${data.version}, Server: ${item.version}).`,
        'CONCURRENT_UPDATE_CONFLICT'
      );
    }

    item.scheduledDate = new Date(data.scheduledDate);
    if (data.scheduledTime) item.scheduledTime = data.scheduledTime;
    if (data.timezone) item.timezone = data.timezone;

    const [hours, minutes] = (item.scheduledTime || '18:00').split(':').map(Number);
    const scheduledAt = new Date(item.scheduledDate);
    scheduledAt.setHours(hours || 18, minutes || 0, 0, 0);
    item.scheduledAt = scheduledAt;

    if (item.publishStatus === 'UNSCHEDULED') {
      item.publishStatus = 'SCHEDULED';
    }

    item.version += 1;
    await item.save();

    // Recalculate job eligibility: cancel stale jobs if outside window, or enqueue if within window
    try {
      await rollingScheduler.handleItemRescheduled(
        orgId,
        item._id,
        item.scheduledAt || item.scheduledDate
      );
    } catch {
      // Non-blocking
    }

    return item;
  }

  /**
   * Pauses an item.
   */
  async pausePlanItem(organizationId: Types.ObjectId | string, itemId: string) {
    return this.updatePlanItem(organizationId, itemId, { publishStatus: 'PAUSED' });
  }

  /**
   * Resumes a paused item.
   */
  async resumePlanItem(organizationId: Types.ObjectId | string, itemId: string) {
    return this.updatePlanItem(organizationId, itemId, { publishStatus: 'SCHEDULED' });
  }

  /**
   * Cancels an item.
   */
  async cancelPlanItem(organizationId: Types.ObjectId | string, itemId: string) {
    return this.updatePlanItem(organizationId, itemId, { publishStatus: 'CANCELLED' });
  }

  /**
   * Deletes a plan item and decrements plan itemsCount.
   */
  async deletePlanItem(organizationId: Types.ObjectId | string, itemId: string) {
    const orgId = this.toObjectId(organizationId);
    const item = await PlanItem.findOneAndDelete({ _id: this.toObjectId(itemId), organizationId: orgId });
    if (!item) throw AppError.notFound('Plan item not found');

    await Plan.updateOne({ _id: item.planId }, { $inc: { itemsCount: -1 } });
    return { success: true, message: 'Plan item deleted' };
  }

  /**
   * Submits a plan for review: draft -> in_review.
   */
  async submitPlanForReview(
    organizationId: Types.ObjectId | string,
    planId: string,
    userId: Types.ObjectId | string,
    userName: string
  ) {
    const orgId = this.toObjectId(organizationId);
    const plan = await Plan.findOne({ _id: this.toObjectId(planId), organizationId: orgId });
    if (!plan) throw AppError.notFound('Plan not found');

    plan.status = 'IN_REVIEW';
    await plan.save();

    await PlanItem.updateMany(
      { organizationId: orgId, planId: plan._id },
      { $set: { approvalStatus: 'PENDING_APPROVAL' } }
    );

    // Record in Approvals
    await Approval.create({
      organizationId: orgId,
      entityType: 'PLAN',
      planId: plan._id,
      title: plan.cycleName,
      status: 'PENDING',
      comments: [
        {
          authorId: this.toObjectId(userId),
          authorName: userName,
          text: 'Plan submitted for official stakeholder review and sign-off.',
        },
      ],
    });

    return plan;
  }

  /**
   * Approves a plan: in_review / draft -> approved.
   * Strict role check: Only manager/approver roles can approve!
   */
  async approvePlan(
    organizationId: Types.ObjectId | string,
    planId: string,
    userId: Types.ObjectId | string,
    userName: string,
    userRole: string,
    comments = 'Plan approved. Creative generation and media buy unlocked.'
  ) {
    const allowedRoles = ['platform_admin', 'org_owner', 'marketing_manager', 'client_approver'];
    if (!allowedRoles.includes(userRole)) {
      throw AppError.forbidden('Only manager/approver roles (marketing_manager, client_approver, org_owner) can approve marketing plans.');
    }

    const orgId = this.toObjectId(organizationId);
    const plan = await Plan.findOne({ _id: this.toObjectId(planId), organizationId: orgId });
    if (!plan) throw AppError.notFound('Plan not found');

    plan.status = 'APPROVED';
    plan.approvedBy = this.toObjectId(userId);
    plan.approvedAt = new Date();
    await plan.save();

    await PlanItem.updateMany(
      { organizationId: orgId, planId: plan._id },
      { $set: { approvalStatus: 'APPROVED' } }
    );

    // Record decision in approvals collection
    await Approval.create({
      organizationId: orgId,
      entityType: 'PLAN',
      planId: plan._id,
      title: plan.cycleName,
      status: 'APPROVED',
      decidedBy: this.toObjectId(userId),
      decidedByName: userName,
      decidedAt: new Date(),
      factChecklist: {
        priceVerified: true,
        bedroomsVerified: true,
        amenitiesVerified: true,
        ctaVerified: true,
        reraDisclaimerVerified: true,
      },
      comments: [
        {
          authorId: this.toObjectId(userId),
          authorName: userName,
          text: comments,
        },
      ],
    });

    return plan;
  }

  /**
   * Requests changes on a plan: in_review -> changes_requested.
   * Strict role check: Only manager/approver roles can request changes!
   */
  async requestChangesOnPlan(
    organizationId: Types.ObjectId | string,
    planId: string,
    userId: Types.ObjectId | string,
    userName: string,
    userRole: string,
    comments: string
  ) {
    const allowedRoles = ['platform_admin', 'org_owner', 'marketing_manager', 'client_approver'];
    if (!allowedRoles.includes(userRole)) {
      throw AppError.forbidden('Only manager/approver roles can request changes on marketing plans.');
    }

    const orgId = this.toObjectId(organizationId);
    const plan = await Plan.findOne({ _id: this.toObjectId(planId), organizationId: orgId });
    if (!plan) throw AppError.notFound('Plan not found');

    plan.status = 'CHANGES_REQUESTED';
    await plan.save();

    await PlanItem.updateMany(
      { organizationId: orgId, planId: plan._id },
      { $set: { approvalStatus: 'CHANGES_REQUESTED' } }
    );

    // Record in approvals
    await Approval.create({
      organizationId: orgId,
      entityType: 'PLAN',
      planId: plan._id,
      title: plan.cycleName,
      status: 'CHANGES_REQUESTED',
      decidedBy: this.toObjectId(userId),
      decidedByName: userName,
      decidedAt: new Date(),
      comments: [
        {
          authorId: this.toObjectId(userId),
          authorName: userName,
          text: comments,
        },
      ],
    });

    return plan;
  }
}

export const planService = new PlanService();
