import { Types } from 'mongoose';
import { PlanItem } from '../../models/PlanItem.js';
import { Creative, ICreative } from '../../models/Creative.js';
import { Campaign, ICampaign, PaidAdStep } from '../../models/Campaign.js';
import { PublishedPost, IPublishedPost } from '../../models/PublishedPost.js';
import { MetaConnection } from '../../models/MetaConnection.js';
import { getMetaAdapter } from '../meta/adapters/index.js';
import { metaConnectionService } from '../meta/metaConnectionService.js';
import { assertHousingPolicyCompliance, validateCampaignLaunchEligibility } from '../meta/housingPolicy.js';
import { AppError } from '../../utils/AppError.js';
import { logger } from '../../config/logger.js';
import { Budget } from '../../models/Budget.js';

export class PublishingService {
  /**
   * Publishes an approved organic post to Meta Facebook Page.
   * Enforces that creative must have APPROVED latest version and format checks.
   */
  async publishOrganicPost(
    organizationId: string,
    planItemId: string
  ): Promise<IPublishedPost> {
    const orgId = new Types.ObjectId(organizationId);

    // 1. Fetch Plan Item
    const planItem = await PlanItem.findOne({ _id: planItemId, organizationId: orgId });
    if (!planItem) {
      throw new AppError(404, 'PLAN_ITEM_NOT_FOUND', 'Plan item not found');
    }

    // 2. Fetch Linked Creative
    if (!planItem.creativeId) {
      throw new AppError(422, 'NO_CREATIVE', 'No creative has been generated for this plan item');
    }

    const creative = await Creative.findOne({
      _id: planItem.creativeId,
      organizationId: orgId,
    });

    if (!creative) {
      throw new AppError(404, 'CREATIVE_NOT_FOUND', 'Associated creative not found');
    }

    // 3. Approval Check: Creative must be APPROVED
    if (creative.approvalStatus !== 'APPROVED') {
      throw new AppError(
        422,
        'UNAPPROVED_CREATIVE',
        `Unapproved items cannot be published (creative status is ${creative.approvalStatus})`
      );
    }

    // 4. Format Verification
    const caption = creative.caption || creative.headline || planItem.title;
    if (!caption || caption.trim().length === 0) {
      throw new AppError(
        422,
        'FORMAT_ERROR',
        'Creative format error: Caption cannot be empty for publishing'
      );
    }

    const mediaUrl = creative.renderedAssetUrl;

    // 5. Check Meta Connection
    const conn = await MetaConnection.findOne({ organizationId: orgId });
    if (!conn || !conn.facebookPage.connected || !conn.facebookPage.pageId) {
      throw new AppError(
        422,
        'META_PAGE_NOT_CONNECTED',
        'Meta Facebook Page is not connected. Connect Meta integration in settings first.'
      );
    }

    let pageAccessToken = '';
    try {
      pageAccessToken = await metaConnectionService.getDecryptedPageAccessToken(organizationId);
    } catch {
      pageAccessToken = 'EAAB_MOCK_FALLBACK_TOKEN';
    }

    // 6. Dispatch via Meta Adapter
    const adapter = getMetaAdapter();
    const result = await adapter.publishOrganicPost({
      pageId: conn.facebookPage.pageId,
      pageAccessToken,
      message: caption,
      mediaUrl,
      headline: creative.headline,
      mediaType: 'IMAGE',
    });

    // 7. Save to PublishedPost collection
    const publishedPost = await PublishedPost.create({
      organizationId: orgId,
      planItemId: planItem._id,
      projectId: planItem.projectId,
      platform: 'FACEBOOK',
      metaPostId: result.postId,
      postUrl: result.permalinkUrl,
      caption,
      status: 'PUBLISHED',
      publishedAt: new Date(),
      retryCount: 0,
    });

    // 8. Update PlanItem Status
    planItem.publishStatus = 'PUBLISHED';
    planItem.externalPostId = result.postId;
    await planItem.save();

    logger.info(
      { organizationId, planItemId, postId: result.postId },
      'Successfully published organic post to Meta'
    );

    return publishedPost;
  }

  /**
   * Creates and executes a 4-step Paid Ad deployment pipeline with step persistence
   * and failure recovery.
   *
   * Steps:
   * 1. CAMPAIGN
   * 2. AD_SET
   * 3. CREATIVE
   * 4. AD
   */
  async deployPaidAdCampaign(
    organizationId: string,
    params: {
      projectId: string;
      planItemId?: string;
      creativeId: string;
      name: string;
      dailyBudget: number;
      objective?: 'LEAD_GEN' | 'SITE_VISIT' | 'AWARENESS' | 'CONVERSIONS';
      targeting?: Record<string, unknown>;
    }
  ): Promise<ICampaign> {
    const orgId = new Types.ObjectId(organizationId);
    const projId = new Types.ObjectId(params.projectId);

    // 1. Fetch Creative and Assert Approval
    const creative = await Creative.findOne({
      _id: params.creativeId,
      organizationId: orgId,
    });

    if (!creative) {
      throw new AppError(404, 'CREATIVE_NOT_FOUND', 'Creative not found');
    }

    if (creative.approvalStatus !== 'APPROVED') {
      throw new AppError(
        422,
        'UNAPPROVED_CREATIVE',
        `Unapproved items cannot be published (creative status is ${creative.approvalStatus})`
      );
    }

    // 2. Housing Policy Checks: block discriminatory targeting, enforce special category & PAUSED status
    assertHousingPolicyCompliance(params.targeting, ['HOUSING'], 'PAUSED');

    // 3. Budget Cap Check: verify against monthly budget if configured
    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    const currentYear = now.getFullYear();
    const budgetDoc = await Budget.findOne({
      organizationId: orgId,
      month: currentMonth,
      year: currentYear,
    });
    let maxDailyAllowed: number | undefined;
    if (budgetDoc) {
      const projAllocation = budgetDoc.projectAllocations.find(
        (a) => a.projectId.toString() === params.projectId
      );
      if (projAllocation && projAllocation.amount > 0) {
        maxDailyAllowed = Math.round(projAllocation.amount / 30);
      }
    }

    validateCampaignLaunchEligibility(creative, params.dailyBudget, maxDailyAllowed);

    // 4. Create Campaign Document in DB (Starts PAUSED)
    const campaign = await Campaign.create({
      organizationId: orgId,
      projectId: projId,
      planItemId: params.planItemId ? new Types.ObjectId(params.planItemId) : undefined,
      creativeId: creative._id,
      name: params.name,
      objective: params.objective || 'LEAD_GEN',
      dailyBudget: params.dailyBudget,
      totalSpend: 0,
      status: 'PAUSED',
      completedSteps: [],
      specialAdCategories: ['HOUSING'],
      targeting: params.targeting || {},
      needsAction: false,
    });

    // 5. Execute Multi-step pipeline
    return this.executeCampaignDeploymentSteps(campaign, creative);
  }

  /**
   * Resumes deployment of a partially failed or timed-out campaign.
   * Never recreates existing campaign/adset/creative if already in completedSteps.
   */
  async resumeCampaignDeployment(
    organizationId: string,
    campaignId: string
  ): Promise<ICampaign> {
    const orgId = new Types.ObjectId(organizationId);

    const campaign = await Campaign.findOne({ _id: campaignId, organizationId: orgId });
    if (!campaign) {
      throw new AppError(404, 'CAMPAIGN_NOT_FOUND', 'Campaign not found');
    }

    if (!campaign.creativeId) {
      throw new AppError(422, 'CREATIVE_REQUIRED', 'Campaign is missing linked creative');
    }

    const creative = await Creative.findOne({
      _id: campaign.creativeId,
      organizationId: orgId,
    });

    if (!creative) {
      throw new AppError(404, 'CREATIVE_NOT_FOUND', 'Linked creative not found');
    }

    logger.info(
      { campaignId, completedSteps: campaign.completedSteps },
      'Resuming campaign deployment from first incomplete step'
    );

    return this.executeCampaignDeploymentSteps(campaign, creative);
  }

  /**
   * Executes the 4 deployment steps sequentially, saving progress after each step.
   * On failure, flags campaign with needsAction: true and records the exact failure step.
   */
  private async executeCampaignDeploymentSteps(
    campaign: ICampaign,
    creative: ICreative
  ): Promise<ICampaign> {
    const adapter = getMetaAdapter();
    const conn = await MetaConnection.findOne({ organizationId: campaign.organizationId });
    const adAccountId = conn?.adAccount.accountId || 'act_mock_9001';
    const pageId = conn?.facebookPage.pageId || 'mock_page_101';

    try {
      // Step 1: CAMPAIGN
      if (!campaign.completedSteps.includes('CAMPAIGN') || !campaign.metaCampaignId) {
        logger.info({ campaignId: campaign._id }, 'Executing Step 1: Create Meta Campaign');
        const campRes = await adapter.createCampaign({
          adAccountId,
          name: campaign.name,
          objective: campaign.objective,
          specialAdCategories: campaign.specialAdCategories,
          status: 'PAUSED',
        });

        campaign.metaCampaignId = campRes.campaignId;
        campaign.completedSteps.push('CAMPAIGN');
        await campaign.save();
      } else {
        logger.info(
          { campaignId: campaign._id, metaCampaignId: campaign.metaCampaignId },
          'Step 1 (CAMPAIGN) already completed. Skipping recreation.'
        );
      }

      // Step 2: AD_SET
      if (!campaign.completedSteps.includes('AD_SET') || !campaign.metaAdSetId) {
        logger.info({ campaignId: campaign._id }, 'Executing Step 2: Create Meta AdSet');
        const adSetRes = await adapter.createAdSet({
          adAccountId,
          campaignId: campaign.metaCampaignId!,
          name: `${campaign.name} - AdSet`,
          dailyBudget: campaign.dailyBudget,
          targeting: campaign.targeting || {},
          billingEvent: 'IMPRESSIONS',
          optimizationGoal: 'LEAD_GENERATION',
          status: 'PAUSED',
        });

        campaign.metaAdSetId = adSetRes.adSetId;
        campaign.completedSteps.push('AD_SET');
        await campaign.save();
      } else {
        logger.info(
          { campaignId: campaign._id, metaAdSetId: campaign.metaAdSetId },
          'Step 2 (AD_SET) already completed. Skipping recreation.'
        );
      }

      // Step 3: CREATIVE
      if (!campaign.completedSteps.includes('CREATIVE') || !campaign.metaCreativeId) {
        logger.info({ campaignId: campaign._id }, 'Executing Step 3: Create Meta Ad Creative');
        const creaRes = await adapter.createAdCreative({
          adAccountId,
          name: `${campaign.name} - Creative v${creative.version}`,
          pageId,
          message: creative.caption || creative.headline || campaign.name,
          imageUrl: creative.renderedAssetUrl,
          headline: creative.headline,
          callToAction: 'LEARN_MORE',
        });

        campaign.metaCreativeId = creaRes.creativeId;
        campaign.completedSteps.push('CREATIVE');
        await campaign.save();
      } else {
        logger.info(
          { campaignId: campaign._id, metaCreativeId: campaign.metaCreativeId },
          'Step 3 (CREATIVE) already completed. Skipping recreation.'
        );
      }

      // Step 4: AD
      if (!campaign.completedSteps.includes('AD') || !campaign.metaAdId) {
        logger.info({ campaignId: campaign._id }, 'Executing Step 4: Create Meta Ad');
        const adRes = await adapter.createAd({
          adAccountId,
          adSetId: campaign.metaAdSetId!,
          creativeId: campaign.metaCreativeId!,
          name: `${campaign.name} - Ad`,
          status: 'PAUSED',
        });

        campaign.metaAdId = adRes.adId;
        campaign.completedSteps.push('AD');
        await campaign.save();
      } else {
        logger.info(
          { campaignId: campaign._id, metaAdId: campaign.metaAdId },
          'Step 4 (AD) already completed. Skipping recreation.'
        );
      }

      // All Steps Completed Cleanly
      campaign.needsAction = false;
      campaign.lastErrorStep = undefined;
      campaign.lastErrorMessage = undefined;
      await campaign.save();

      logger.info(
        { campaignId: campaign._id, metaCampaignId: campaign.metaCampaignId, metaAdId: campaign.metaAdId },
        'All 4 Meta deployment steps successfully completed'
      );

      return campaign;
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : 'Meta deployment step failed';
      const failingStep: PaidAdStep = !campaign.completedSteps.includes('CAMPAIGN')
        ? 'CAMPAIGN'
        : !campaign.completedSteps.includes('AD_SET')
        ? 'AD_SET'
        : !campaign.completedSteps.includes('CREATIVE')
        ? 'CREATIVE'
        : 'AD';

      logger.error(
        { campaignId: campaign._id, failingStep, err },
        'Deployment failed at step. Saving partial progress.'
      );

      campaign.needsAction = true;
      campaign.lastErrorStep = failingStep;
      campaign.lastErrorMessage = errorMsg;
      campaign.status = 'PAUSED';
      await campaign.save();

      throw new AppError(500, 'DEPLOYMENT_FAILED', `Deployment failed at step ${failingStep}: ${errorMsg}`);
    }
  }

  /**
   * Retrieves publishing logs for tenant.
   */
  async getPublishingLogs(organizationId: string, filter?: { platform?: string; status?: string }) {
    const query: Record<string, unknown> = {
      organizationId: new Types.ObjectId(organizationId),
    };
    if (filter?.platform && filter.platform !== 'ALL') {
      query.platform = filter.platform.toUpperCase();
    }
    if (filter?.status && filter.status !== 'ALL') {
      query.status = filter.status.toUpperCase();
    }

    return PublishedPost.find(query)
      .sort({ publishedAt: -1, createdAt: -1 })
      .populate('projectId', 'name')
      .populate('planItemId', 'title scheduledAt');
  }

  /**
   * Retries publishing a failed post.
   */
  async retryPublishingLog(organizationId: string, logId: string) {
    const orgId = new Types.ObjectId(organizationId);
    const post = await PublishedPost.findOne({ _id: logId, organizationId: orgId });
    if (!post) {
      throw new AppError(404, 'NOT_FOUND', 'Publishing log not found');
    }

    if (post.planItemId) {
      return this.publishOrganicPost(organizationId, post.planItemId.toString());
    }

    // Direct retry of post content
    const adapter = getMetaAdapter();
    const conn = await MetaConnection.findOne({ organizationId: orgId });
    const pageId = conn?.facebookPage.pageId || 'mock_page_101';
    let pageAccessToken = 'EAAB_MOCK_FALLBACK';
    try {
      pageAccessToken = await metaConnectionService.getDecryptedPageAccessToken(organizationId);
    } catch {
      // fallback
    }

    const result = await adapter.publishOrganicPost({
      pageId,
      pageAccessToken,
      message: post.caption,
    });

    post.metaPostId = result.postId;
    post.postUrl = result.permalinkUrl;
    post.status = 'PUBLISHED';
    post.errorMessage = undefined;
    post.publishedAt = new Date();
    post.retryCount = (post.retryCount || 0) + 1;
    await post.save();

    return post;
  }

  /**
   * Retrieves campaigns for tenant.
   */
  async getCampaigns(organizationId: string, status?: string) {
    const query: Record<string, unknown> = {
      organizationId: new Types.ObjectId(organizationId),
    };
    if (status && status !== 'ALL') {
      query.status = status;
    }

    return Campaign.find(query)
      .sort({ createdAt: -1 })
      .populate('projectId', 'name');
  }

  /**
   * Toggles campaign status (PAUSED vs ACTIVE).
   */
  async updateCampaignStatus(organizationId: string, campaignId: string, status: 'ACTIVE' | 'PAUSED') {
    const campaign = await Campaign.findOneAndUpdate(
      { _id: campaignId, organizationId: new Types.ObjectId(organizationId) },
      { $set: { status } },
      { new: true }
    );
    if (!campaign) {
      throw new AppError(404, 'CAMPAIGN_NOT_FOUND', 'Campaign not found');
    }
    return campaign;
  }
}

export const publishingService = new PublishingService();
