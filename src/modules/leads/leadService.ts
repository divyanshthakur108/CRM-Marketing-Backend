import { Types } from 'mongoose';
import { Lead, ILead, computeLeadDedupeKey, LeadStage } from '../../models/Lead.js';
import { LeadActivity, ILeadActivity } from '../../models/LeadActivity.js';
import { Project } from '../../models/Project.js';
import { User } from '../../models/User.js';
import { AppError } from '../../utils/AppError.js';
import { logger } from '../../config/logger.js';

export interface CreateLeadDto {
  name: string;
  phone: string;
  email?: string;
  projectId?: string;
  projectName?: string;
  budget?: number;
  budgetDisplay?: string;
  stage?: LeadStage;
  assignedTo?: string;
  assignedAgentName?: string;
  source?: 'META_AD' | 'WHATSAPP' | 'DIRECT' | 'PORTAL' | 'MANUAL';
  notes?: string;
  consentGiven?: boolean;
  consentSource?: string;
  tags?: string[];
}

export type UpdateLeadDto = Partial<CreateLeadDto>;

export interface LeadFilterQuery {
  stage?: LeadStage;
  projectId?: string;
  assignedTo?: string;
  source?: 'META_AD' | 'WHATSAPP' | 'DIRECT' | 'PORTAL' | 'MANUAL';
  search?: string;
  page?: number;
  limit?: number;
}

export class LeadService {
  /**
   * Retrieves paginated leads scoped to the tenant with stage count summaries
   */
  async listLeads(organizationId: string, filter: LeadFilterQuery) {
    const orgId = new Types.ObjectId(organizationId);
    const query: Record<string, unknown> = { organizationId: orgId };

    if (filter.stage) {
      query.stage = filter.stage;
    }

    if (filter.projectId && Types.ObjectId.isValid(filter.projectId)) {
      query.projectId = new Types.ObjectId(filter.projectId);
    }

    if (filter.assignedTo && Types.ObjectId.isValid(filter.assignedTo)) {
      query.assignedTo = new Types.ObjectId(filter.assignedTo);
    }

    if (filter.source) {
      query.source = filter.source;
    }

    if (filter.search) {
      const searchRegex = new RegExp(filter.search.trim(), 'i');
      query.$or = [
        { name: searchRegex },
        { phone: searchRegex },
        { email: searchRegex },
        { projectName: searchRegex },
      ];
    }

    const page = filter.page || 1;
    const limit = filter.limit || 20;
    const skip = (page - 1) * limit;

    const [leads, total, stageAgg] = await Promise.all([
      Lead.find(query).sort({ updatedAt: -1 }).skip(skip).limit(limit).lean(),
      Lead.countDocuments(query),
      Lead.aggregate([
        { $match: { organizationId: orgId } },
        { $group: { _id: '$stage', count: { $sum: 1 } } },
      ]),
    ]);

    const stageCounts: Record<string, number> = {
      New: 0,
      Contacted: 0,
      Qualified: 0,
      'Visit scheduled': 0,
      'Visit done': 0,
      Negotiation: 0,
      'Won/Lost': 0,
    };

    stageAgg.forEach((item: { _id: string; count: number }) => {
      if (item._id && stageCounts[item._id] !== undefined) {
        stageCounts[item._id] = item.count;
      }
    });

    return {
      leads,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
      },
      stageCounts,
    };
  }

  /**
   * Fetches a single lead and its historical activity timeline
   */
  async getLeadById(organizationId: string, leadId: string) {
    if (!Types.ObjectId.isValid(leadId)) {
      throw AppError.badRequest('Invalid lead ID format', 'INVALID_ID');
    }

    const orgId = new Types.ObjectId(organizationId);
    const lead = await Lead.findOne({ _id: leadId, organizationId: orgId }).lean();

    if (!lead) {
      throw AppError.notFound('Lead not found or inaccessible', 'LEAD_NOT_FOUND');
    }

    const timeline = await LeadActivity.find({
      organizationId: orgId,
      leadId: lead._id,
    })
      .sort({ createdAt: -1 })
      .lean();

    return {
      lead,
      timeline,
    };
  }

  /**
   * Creates a new lead, enforcing organization-level uniqueness via dedupeKey
   */
  async createLead(
    organizationId: string,
    dto: CreateLeadDto,
    authorName = 'Sales Agent',
    authorId?: string
  ): Promise<ILead> {
    const orgId = new Types.ObjectId(organizationId);
    const dedupeKey = computeLeadDedupeKey(dto.phone, dto.email);

    // 1. Check for duplicate lead within this tenant
    const existing = await Lead.findOne({ organizationId: orgId, dedupeKey });
    if (existing) {
      throw AppError.conflict(
        `A lead with phone "${dto.phone}" or email "${dto.email || ''}" already exists in this organization`,
        'LEAD_DUPLICATE'
      );
    }

    // 2. Resolve project name if projectId provided
    let projectName = dto.projectName;
    let projectObjId: Types.ObjectId | undefined;
    if (dto.projectId && Types.ObjectId.isValid(dto.projectId)) {
      projectObjId = new Types.ObjectId(dto.projectId);
      if (!projectName) {
        const project = await Project.findOne({ _id: projectObjId, organizationId: orgId });
        if (project) projectName = project.name;
      }
    }

    // 3. Resolve assigned agent name if assignedTo provided
    let assignedAgentName = dto.assignedAgentName;
    let assignedObjId: Types.ObjectId | undefined;
    if (dto.assignedTo && Types.ObjectId.isValid(dto.assignedTo)) {
      assignedObjId = new Types.ObjectId(dto.assignedTo);
      if (!assignedAgentName) {
        const agent = await User.findById(assignedObjId);
        if (agent) assignedAgentName = agent.fullName;
      }
    }

    // 4. Create Lead document
    const lead = await Lead.create({
      organizationId: orgId,
      dedupeKey,
      name: dto.name,
      phone: dto.phone,
      email: dto.email || undefined,
      projectId: projectObjId,
      projectName,
      budget: dto.budget,
      budgetDisplay: dto.budgetDisplay || (dto.budget ? `₹ ${(dto.budget / 100000).toFixed(2)} L` : undefined),
      stage: dto.stage || 'New',
      assignedTo: assignedObjId,
      assignedAgentName,
      source: dto.source || 'DIRECT',
      notes: dto.notes,
      consentGiven: dto.consentGiven ?? true,
      consentTimestamp: new Date(),
      consentSource: dto.consentSource || 'DIRECT_FORM',
      tags: dto.tags || [],
    });

    // 5. Create initial activity timeline log
    await LeadActivity.create({
      organizationId: orgId,
      leadId: lead._id,
      authorId: authorId && Types.ObjectId.isValid(authorId) ? new Types.ObjectId(authorId) : undefined,
      authorName,
      type: 'STAGE_PROGRESSION',
      summary: `Lead created at stage "${lead.stage}" via ${lead.source}`,
      details: {
        source: lead.source,
        initialStage: lead.stage,
        consentSource: lead.consentSource,
      },
    });

    logger.info(
      { organizationId, leadId: lead._id, dedupeKey },
      'Successfully created lead and logged initial activity'
    );

    return lead;
  }

  /**
   * Updates lead attributes, stage progression, or owner assignment with automatic activity logs
   */
  async updateLead(
    organizationId: string,
    leadId: string,
    dto: UpdateLeadDto,
    authorName = 'Sales Agent',
    authorId?: string
  ): Promise<ILead> {
    if (!Types.ObjectId.isValid(leadId)) {
      throw AppError.badRequest('Invalid lead ID format', 'INVALID_ID');
    }

    const orgId = new Types.ObjectId(organizationId);
    const lead = await Lead.findOne({ _id: leadId, organizationId: orgId });

    if (!lead) {
      throw AppError.notFound('Lead not found or inaccessible', 'LEAD_NOT_FOUND');
    }

    const previousStage = lead.stage;
    const previousAssignedTo = lead.assignedTo?.toString();

    // Recompute dedupeKey if phone or email changed
    if (dto.phone || dto.email) {
      const newDedupeKey = computeLeadDedupeKey(dto.phone || lead.phone, dto.email || lead.email);
      if (newDedupeKey !== lead.dedupeKey) {
        const conflict = await Lead.findOne({
          organizationId: orgId,
          dedupeKey: newDedupeKey,
          _id: { $ne: lead._id },
        });
        if (conflict) {
          throw AppError.conflict(
            'Another lead in this organization already possesses this phone or email',
            'LEAD_DUPLICATE'
          );
        }
        lead.dedupeKey = newDedupeKey;
      }
    }

    if (dto.name) lead.name = dto.name;
    if (dto.phone) lead.phone = dto.phone;
    if (dto.email !== undefined) lead.email = dto.email || undefined;
    if (dto.budget !== undefined) lead.budget = dto.budget;
    if (dto.budgetDisplay !== undefined) lead.budgetDisplay = dto.budgetDisplay;
    if (dto.notes !== undefined) lead.notes = dto.notes;
    if (dto.consentGiven !== undefined) lead.consentGiven = dto.consentGiven;
    if (dto.tags !== undefined) lead.tags = dto.tags;

    // Resolve project update
    if (dto.projectId !== undefined) {
      if (dto.projectId && Types.ObjectId.isValid(dto.projectId)) {
        lead.projectId = new Types.ObjectId(dto.projectId);
        const project = await Project.findOne({ _id: lead.projectId, organizationId: orgId });
        if (project) lead.projectName = project.name;
      } else {
        lead.projectId = undefined;
        lead.projectName = undefined;
      }
    }

    // Resolve owner assignment update
    if (dto.assignedTo !== undefined) {
      if (dto.assignedTo && Types.ObjectId.isValid(dto.assignedTo)) {
        lead.assignedTo = new Types.ObjectId(dto.assignedTo);
        const agent = await User.findById(lead.assignedTo);
        lead.assignedAgentName = agent ? agent.fullName : dto.assignedAgentName || 'Assigned Agent';
      } else {
        lead.assignedTo = undefined;
        lead.assignedAgentName = undefined;
      }
    }

    // Apply stage update
    if (dto.stage && dto.stage !== previousStage) {
      lead.stage = dto.stage;
    }

    await lead.save();

    const activityAuthorId =
      authorId && Types.ObjectId.isValid(authorId) ? new Types.ObjectId(authorId) : undefined;

    // Log stage transition activity
    if (dto.stage && dto.stage !== previousStage) {
      await LeadActivity.create({
        organizationId: orgId,
        leadId: lead._id,
        authorId: activityAuthorId,
        authorName,
        type: 'STAGE_PROGRESSION',
        summary: `Lead stage updated from "${previousStage}" to "${lead.stage}"`,
        details: { from: previousStage, to: lead.stage },
      });
    }

    // Log reassignment activity
    if (dto.assignedTo !== undefined && lead.assignedTo?.toString() !== previousAssignedTo) {
      await LeadActivity.create({
        organizationId: orgId,
        leadId: lead._id,
        authorId: activityAuthorId,
        authorName,
        type: 'AGENT_NOTE',
        summary: lead.assignedAgentName
          ? `Lead assigned to agent ${lead.assignedAgentName}`
          : 'Lead reassigned to unassigned pool',
        details: { assignedTo: lead.assignedTo, agentName: lead.assignedAgentName },
      });
    }

    return lead;
  }

  /**
   * Appends an activity timeline entry (call log, note, visit update)
   */
  async addTimelineEntry(
    organizationId: string,
    leadId: string,
    type: 'STAGE_PROGRESSION' | 'CALL_LOG' | 'AGENT_NOTE' | 'WHATSAPP_MESSAGE' | 'SITE_VISIT_BOOKED',
    summary: string,
    details: Record<string, unknown> = {},
    authorName = 'Sales Agent',
    authorId?: string
  ): Promise<ILeadActivity> {
    if (!Types.ObjectId.isValid(leadId)) {
      throw AppError.badRequest('Invalid lead ID format', 'INVALID_ID');
    }

    const orgId = new Types.ObjectId(organizationId);
    const lead = await Lead.findOne({ _id: leadId, organizationId: orgId });
    if (!lead) {
      throw AppError.notFound('Lead not found or inaccessible', 'LEAD_NOT_FOUND');
    }

    const activity = await LeadActivity.create({
      organizationId: orgId,
      leadId: lead._id,
      authorId: authorId && Types.ObjectId.isValid(authorId) ? new Types.ObjectId(authorId) : undefined,
      authorName,
      type,
      summary,
      details,
    });

    // Touch lastContactedAt on calls or messages
    if (type === 'CALL_LOG' || type === 'WHATSAPP_MESSAGE') {
      lead.lastContactedAt = new Date();
      await lead.save();
    }

    return activity;
  }

  /**
   * Deletes a lead and its activities within the tenant boundary
   */
  async deleteLead(organizationId: string, leadId: string): Promise<void> {
    if (!Types.ObjectId.isValid(leadId)) {
      throw AppError.badRequest('Invalid lead ID format', 'INVALID_ID');
    }

    const orgId = new Types.ObjectId(organizationId);
    const lead = await Lead.findOneAndDelete({ _id: leadId, organizationId: orgId });

    if (!lead) {
      throw AppError.notFound('Lead not found or inaccessible', 'LEAD_NOT_FOUND');
    }

    await LeadActivity.deleteMany({ organizationId: orgId, leadId: lead._id });
    logger.info({ organizationId, leadId }, 'Lead and associated activities deleted cleanly');
  }
}

export const leadService = new LeadService();
