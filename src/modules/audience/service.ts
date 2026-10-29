import { Types } from 'mongoose';
import { AudienceBrief, IAudienceBrief } from '../../models/AudienceBrief.js';
import { AppError } from '../../utils/AppError.js';
import { CreateAudienceBriefInput, UpdateAudienceBriefInput } from './validation.js';

class AudienceService {
  private toObjectId(id: Types.ObjectId | string): Types.ObjectId {
    return typeof id === 'string' ? new Types.ObjectId(id) : id;
  }

  public async listBriefs(
    orgId: Types.ObjectId | string,
    projectId?: string
  ): Promise<IAudienceBrief[]> {
    const organizationId = this.toObjectId(orgId);
    const filter: Record<string, unknown> = { organizationId };

    if (projectId && Types.ObjectId.isValid(projectId)) {
      filter.projectId = new Types.ObjectId(projectId);
    }

    return AudienceBrief.find(filter).sort({ updatedAt: -1 });
  }

  public async getBriefById(
    orgId: Types.ObjectId | string,
    briefId: string
  ): Promise<IAudienceBrief> {
    const organizationId = this.toObjectId(orgId);
    if (!Types.ObjectId.isValid(briefId)) {
      throw AppError.notFound('Audience brief not found');
    }

    const brief = await AudienceBrief.findOne({
      _id: briefId,
      organizationId,
    });

    if (!brief) {
      throw AppError.notFound('Audience brief not found or belongs to another organization');
    }

    return brief;
  }

  public async createBrief(
    orgId: Types.ObjectId | string,
    input: CreateAudienceBriefInput
  ): Promise<IAudienceBrief> {
    const organizationId = this.toObjectId(orgId);
    const brief = await AudienceBrief.create({
      ...input,
      organizationId,
      projectId: input.projectId && Types.ObjectId.isValid(input.projectId) ? new Types.ObjectId(input.projectId) : undefined,
    });

    return brief;
  }

  public async updateBrief(
    orgId: Types.ObjectId | string,
    briefId: string,
    input: UpdateAudienceBriefInput
  ): Promise<IAudienceBrief> {
    const organizationId = this.toObjectId(orgId);
    const brief = await this.getBriefById(organizationId, briefId);

    if (input.name) brief.name = input.name;
    if (input.targetPersona) brief.targetPersona = input.targetPersona;
    if (input.locations) brief.locations = input.locations;
    if (input.incomeBracket) brief.incomeBracket = input.incomeBracket;
    if (input.interests) brief.interests = input.interests;
    if (input.housingAdPolicyAcknowledged !== undefined) {
      brief.housingAdPolicyAcknowledged = input.housingAdPolicyAcknowledged;
    }
    if (input.projectId !== undefined) {
      brief.projectId = input.projectId && Types.ObjectId.isValid(input.projectId)
        ? new Types.ObjectId(input.projectId)
        : undefined;
    }
    if (input.ageRange) {
      brief.ageRange = {
        ...brief.ageRange,
        ...input.ageRange,
      };
    }

    await brief.save();
    return brief;
  }

  public async deleteBrief(
    orgId: Types.ObjectId | string,
    briefId: string
  ): Promise<void> {
    const organizationId = this.toObjectId(orgId);
    const brief = await this.getBriefById(organizationId, briefId);
    await brief.deleteOne();
  }
}

export const audienceService = new AudienceService();
