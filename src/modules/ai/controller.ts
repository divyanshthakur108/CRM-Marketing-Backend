import { Request, Response } from 'express';
import { aiModuleService } from './service.js';
import { creativeService } from './creativeService.js';
import { creativeEngineService } from './creativeEngineService.js';
import { rollingScheduler } from '../../scheduler/rollingScheduler.js';
import { Creative } from '../../models/Creative.js';
import { Project } from '../../models/Project.js';
import { PropertyUnit } from '../../models/PropertyUnit.js';
import { Approval } from '../../models/Approval.js';
import { Job } from '../../models/Job.js';
import { sendSuccess } from '../../utils/response.js';
import { AppError } from '../../utils/AppError.js';
import {
  GenerateImageInput,
  GenerateCopyInput,
  GenerateCreativeInput,
  RequestRevisionInput,
} from './validation.js';
import { getAIProvider, GeminiAIProvider } from './providers/index.js';
import { env } from '../../config/env.js';
import { OCCASIONS } from './occasionEngine.js';
import { presenterWalkthroughService } from './presenterWalkthroughService.js';
import { captionService } from './captionService.js';
import { aiStudioService } from './aiStudioService.js';

export class AiController {
  public getAiHealth = async (_req: Request, res: Response): Promise<void> => {
    const provider = getAIProvider();
    if (provider.name === 'gemini') {
      const health = await (provider as GeminiAIProvider).checkHealth();
      sendSuccess(res, health);
      return;
    }

    sendSuccess(res, {
      configured: true,
      provider: 'mock',
      imageModel: 'mock-image-engine-v1',
      videoModel: 'mock-video-engine-v1',
      costPerImageUsd: 0,
      costPerVideoSecondUsd: 0,
      dailyCapUsd: env.AI_DAILY_COST_CAP_USD,
      maxVideoSecondsPerReel: env.AI_MAX_VIDEO_SECONDS_PER_REEL,
    });
  };

  public estimateCost = async (req: Request, res: Response): Promise<void> => {
    const orgId = req.organizationId;
    if (!orgId) throw AppError.unauthorized('Organization required');

    const { clipCount = 5, secondsPerClip = 5, imageCount = 0 } = req.body || {};
    const estimate = creativeEngineService.calculateCostEstimate({
      clipCount,
      secondsPerClip,
      imageCount,
    });

    const capCheck = await creativeEngineService.checkDailyCostCap(orgId, estimate.totalCostUsd);

    sendSuccess(res, {
      ...estimate,
      dailyCapUsd: capCheck.capUsd,
      dailyUsageSoFarUsd: capCheck.dailySpentUsd,
      remainingDailyCapUsd: Math.max(
        0,
        parseFloat((capCheck.capUsd - capCheck.dailySpentUsd).toFixed(2))
      ),
      canProceed: capCheck.allowed,
    });
  };

  public enhancePhoto = async (req: Request, res: Response): Promise<void> => {
    const organizationId = req.organizationId;
    if (!organizationId) throw AppError.unauthorized('Organization required');

    const role = req.membership?.role;
    const isPrivileged =
      req.user?.isPlatformAdmin || role === 'org_owner' || role === 'marketing_manager';
    if (!isPrivileged) {
      throw AppError.forbidden(
        'Only organization owners and marketing managers can trigger paid AI enhancements',
        'PAID_AI_PERMISSION_DENIED'
      );
    }

    const { mediaAssetId, prompt } = req.body || {};
    if (!mediaAssetId) {
      throw AppError.badRequest('mediaAssetId is required');
    }

    const result = await creativeEngineService.enhancePhotoBackground({
      organizationId,
      mediaAssetId,
      prompt,
    });

    sendSuccess(res, result, 200, {
      message: 'Photo enhanced successfully with AI. Original photo preserved.',
    });
  };

  public generateImage = async (req: Request, res: Response): Promise<void> => {
    const orgId = req.organizationId?.toString() || req.body.organizationId;
    const input = { ...(req.body as GenerateImageInput), organizationId: orgId };
    const result = await aiModuleService.generateImage(input);
    sendSuccess(res, result, 200, {
      message: result.isMockFallback
        ? 'Generated high-resolution architectural render via deterministic engine'
        : 'Generated image successfully with Google Gemini AI',
    });
  };

  public generateCopy = async (req: Request, res: Response): Promise<void> => {
    const orgId = req.organizationId?.toString() || req.body.organizationId;
    const input = { ...(req.body as GenerateCopyInput), organizationId: orgId };
    const result = await aiModuleService.generateCopy(input);
    sendSuccess(res, result, 200, {
      message: 'Generated marketing copy and hashtags successfully',
    });
  };

  public getCreatives = async (req: Request, res: Response): Promise<void> => {
    const organizationId = req.organizationId;
    if (!organizationId) throw AppError.unauthorized('Organization required');

    const { projectId, planItemId, status, approvalStatus } = req.query;
    const filter: Record<string, unknown> = { organizationId };

    if (projectId) filter.projectId = projectId;
    if (planItemId) filter.planItemId = planItemId;
    if (status) filter.status = status;
    if (approvalStatus) filter.approvalStatus = approvalStatus;

    const creatives = await Creative.find(filter)
      .populate('projectId', 'name category location coverImageUrl')
      .populate('unitId', 'unitNumber unitType price priceDisplay')
      .sort({ updatedAt: -1 });

    sendSuccess(res, creatives);
  };

  public getCreativeById = async (req: Request, res: Response): Promise<void> => {
    const organizationId = req.organizationId;
    if (!organizationId) throw AppError.unauthorized('Organization required');

    const creative = await Creative.findOne({
      _id: req.params.id,
      organizationId,
    })
      .populate('projectId', 'name category location coverImageUrl')
      .populate('unitId', 'unitNumber unitType price priceDisplay');

    if (!creative) throw AppError.notFound('Creative asset not found');

    sendSuccess(res, creative);
  };

  public generateCreative = async (req: Request, res: Response): Promise<void> => {
    const organizationId = req.organizationId;
    if (!organizationId) throw AppError.unauthorized('Organization required');

    const { planItemId, aspectRatio, language, customPrompt, tone } =
      req.body as GenerateCreativeInput;

    const creative = await creativeService.generateCreativeForPlanItem(
      organizationId,
      planItemId,
      {
        aspectRatio,
        language,
        customPrompt,
        tone,
      }
    );

    sendSuccess(res, creative, 201, {
      message: `Creative version v${creative.version} generated successfully`,
    });
  };

  public requestRevision = async (req: Request, res: Response): Promise<void> => {
    const organizationId = req.organizationId;
    if (!organizationId) throw AppError.unauthorized('Organization required');

    const { revisionNotes } = req.body as RequestRevisionInput;
    const creative = await creativeService.requestRevision(
      organizationId,
      req.params.id,
      revisionNotes,
      req.user?.userId,
      req.user?.email || 'Reviewer'
    );

    sendSuccess(res, creative, 200, {
      message: `Revision v${creative.version} synthesized. Requires fresh approval.`,
    });
  };

  /**
   * Manual trigger to generate creative posters and reels for a project
   * Mode A: 'template' (default, free)
   * Mode B: 'ai_motion' (opt-in, paid, requires org_owner/marketing_manager)
   */
  public triggerProjectCreatives = async (req: Request, res: Response): Promise<void> => {
    const organizationId = req.organizationId;
    if (!organizationId) throw AppError.unauthorized('Organization required');

    const { id: projectId } = req.params;
    const { mode = 'template', selectedAssetIds, factsSnapshot, stylePreset } = req.body || {};

    if (mode === 'ai_motion') {
      const role = req.membership?.role;
      const isPrivileged =
        req.user?.isPlatformAdmin || role === 'org_owner' || role === 'marketing_manager';
      if (!isPrivileged) {
        throw AppError.forbidden(
          'Only organization owners and marketing managers can trigger paid AI generation',
          'PAID_AI_PERMISSION_DENIED'
        );
      }

      const result = await creativeEngineService.generateAiMotionReel({
        organizationId,
        projectId,
        selectedAssetIds,
        factsSnapshot,
        userId: req.user?.userId,
      });

      sendSuccess(res, result, 201, {
        message: 'AI motion reel synthesized successfully and submitted for review',
      });
      return;
    }

    const result = await creativeEngineService.enqueueProjectCreatives(
      organizationId,
      projectId,
      req.user?.userId,
      { stylePreset }
    );

    if (!result.success) {
      if (result.reason === 'INSUFFICIENT_CREDITS') {
        throw AppError.badRequest('Insufficient credits to generate creatives', 'INSUFFICIENT_CREDITS');
      }
      throw AppError.badRequest(result.reason || 'Failed to trigger creative generation');
    }

    sendSuccess(res, { ...result, mode: 'template' }, 200, {
      message: `Enqueued ${result.jobCount} creative generation job(s) for synthesis`,
    });
  };

  /**
   * Client approval with mandatory fact checklist verification
   */
  public approveCreative = async (req: Request, res: Response): Promise<void> => {
    const rawOrgId = req.organizationId || req.membership?.organizationId;
    const creative = await Creative.findOne({
      _id: req.params.id,
      ...(rawOrgId ? { organizationId: rawOrgId } : {}),
    });
    if (!creative) throw AppError.notFound('Creative asset not found');

    // Keep Approve disabled until the rendered file exists
    if (creative.generatedBy === 'ai' && (!creative.renderedAssetUrl || creative.files.length === 0)) {
      throw AppError.badRequest(
        'Cannot approve AI creative before rendering is completed and file exists',
        'FILE_NOT_READY'
      );
    }

    const organizationId = creative.organizationId;
    const factChecklist = req.body?.factChecklist || req.body?.checklist || {};
    const requiredChecklist = [
      'projectName',
      'unitType',
      'price',
      'location',
      'amenities',
      'contactDetails',
    ];

    const missingOrUnchecked = requiredChecklist.filter(
      (k) => !factChecklist || factChecklist[k] !== true
    );

    if (missingOrUnchecked.length > 0) {
      throw AppError.badRequest(
        `All fact checklist items must be verified before approval. Missing: ${missingOrUnchecked.join(', ')}`,
        'CHECKLIST_INCOMPLETE'
      );
    }

    creative.approvalStatus = 'APPROVED';
    creative.status = 'approved';
    creative.reReviewRequired = false;
    await creative.save();

    // Update or create linked Approval record
    await Approval.findOneAndUpdate(
      { organizationId, creativeId: creative._id },
      {
        $set: {
          status: 'APPROVED',
          entityType: 'CREATIVE',
          decidedBy: req.user?.userId ? req.user.userId : undefined,
          decidedByName: req.user?.email || 'Approver',
          decidedAt: new Date(),
          factChecklist: {
            projectName: true,
            unitType: true,
            price: true,
            location: true,
            amenities: true,
            contactDetails: true,
          },
        },
      },
      { upsert: true, new: true }
    );

    sendSuccess(res, creative, 200, {
      message: `Creative approved successfully. Now available for Calendar items and Ads.`,
    });
  };

  /**
   * Request changes with mandatory comment
   */
  public requestChanges = async (req: Request, res: Response): Promise<void> => {
    const rawOrgId = req.organizationId || req.membership?.organizationId;
    const creative = await Creative.findOne({
      _id: req.params.id,
      ...(rawOrgId ? { organizationId: rawOrgId } : {}),
    });
    if (!creative) throw AppError.notFound('Creative asset not found');

    const organizationId = creative.organizationId;
    const { comment } = req.body || {};
    if (!comment || typeof comment !== 'string' || comment.trim().length === 0) {
      throw AppError.badRequest('Comment is required when requesting changes', 'COMMENT_REQUIRED');
    }

    creative.approvalStatus = 'CHANGES_REQUESTED';
    creative.status = 'changes_requested';
    creative.revisionNotes = comment.trim();
    await creative.save();

    await Approval.findOneAndUpdate(
      { organizationId, creativeId: creative._id },
      {
        $set: {
          status: 'CHANGES_REQUESTED',
          entityType: 'CREATIVE',
        },
        $push: {
          comments: {
            authorName: req.user?.email || 'Client Approver',
            text: comment.trim(),
            createdAt: new Date(),
          },
        },
      },
      { upsert: true }
    );

    sendSuccess(res, creative, 200, {
      message: 'Changes requested successfully with reviewer feedback.',
    });
  };

  /**
   * Reject creative
   */
  public rejectCreative = async (req: Request, res: Response): Promise<void> => {
    const rawOrgId = req.organizationId || req.membership?.organizationId;
    const creative = await Creative.findOne({
      _id: req.params.id,
      ...(rawOrgId ? { organizationId: rawOrgId } : {}),
    });
    if (!creative) throw AppError.notFound('Creative asset not found');

    const { reason } = req.body || {};
    creative.approvalStatus = 'REJECTED';
    creative.status = 'rejected';
    if (reason) creative.revisionNotes = reason;
    await creative.save();

    sendSuccess(res, creative, 200, {
      message: 'Creative rejected.',
    });
  };

  /**
   * Regenerate creative (uses credits; produces new version)
   */
  public regenerateCreative = async (req: Request, res: Response): Promise<void> => {
    const rawOrgId = req.organizationId || req.membership?.organizationId;
    const creative = await Creative.findOne({
      _id: req.params.id,
      ...(rawOrgId ? { organizationId: rawOrgId } : {}),
    });
    if (!creative) throw AppError.notFound('Creative asset not found');

    if (!creative.projectId) {
      throw AppError.badRequest('Creative has no linked project');
    }

    const prevVersion = creative.version;
    const nextVer = prevVersion + 1;

    // Archive the OLD version into history before bumping
    creative.history.unshift({
      version: prevVersion,
      headline: creative.headline,
      caption: creative.caption,
      hashtags: creative.hashtags,
      renderedAssetUrl: creative.renderedAssetUrl,
      files: creative.files,
      sourceAssetIds: creative.sourceAssetIds,
      factsSnapshot: creative.factsSnapshot,
      generatedBy: creative.generatedBy,
      status: creative.status,
      cost: creative.cost || 1,
      approvalStatus: creative.approvalStatus,
      generatedAt: creative.updatedAt || new Date(),
    });

    // Bump version and reset approval state — old approvals NEVER carry over
    creative.version = nextVer;
    creative.status = 'ready_for_review';
    creative.approvalStatus = 'PENDING_APPROVAL';
    creative.reReviewRequired = false;
    creative.factCheckPassed = false;
    creative.factCheckIssues = [];
    creative.revisionNotes = undefined;

    if (creative.type === 'REEL') {
      await creativeEngineService.renderReelForCreative(creative);
    } else {
      await creativeEngineService.renderPosterForCreative(creative);
    }

    sendSuccess(res, creative, 200, {
      message: `Synthesized version v${nextVer}. Fresh approval required.`,
    });
  };


  /**
   * Set hero photo for project or specific unit
   */
  public setHeroPhoto = async (req: Request, res: Response): Promise<void> => {
    const organizationId = req.organizationId;
    if (!organizationId) throw AppError.unauthorized('Organization required');

    const { projectId, heroAssetId, unitId } = req.body || {};
    if (!projectId || !heroAssetId) {
      throw AppError.badRequest('projectId and heroAssetId are required');
    }

    if (unitId) {
      await PropertyUnit.findOneAndUpdate(
        { _id: unitId, organizationId, projectId },
        { $set: { heroAssetId } }
      );
    } else {
      await Project.findOneAndUpdate(
        { _id: projectId, organizationId },
        { $set: { heroAssetId } }
      );
    }

    sendSuccess(res, { success: true }, 200, {
      message: 'Hero photo preference updated successfully',
    });
  };

  public triggerScheduler = async (req: Request, res: Response): Promise<void> => {
    const referenceDate = req.body.referenceDate ? new Date(req.body.referenceDate) : undefined;
    const result = await rollingScheduler.runRollingScheduler(referenceDate);

    sendSuccess(res, result, 200, {
      message: 'Rolling creative scheduler triggered successfully',
    });
  };

  public getJobs = async (req: Request, res: Response): Promise<void> => {
    const organizationId = req.organizationId;
    if (!organizationId) throw AppError.unauthorized('Organization required');

    const { status, jobType } = req.query;
    const filter: Record<string, unknown> = { organizationId };
    if (status) filter.status = status;
    if (jobType) filter.jobType = jobType;

    const jobs = await Job.find(filter).sort({ createdAt: -1 }).limit(50);
    sendSuccess(res, jobs);
  };

  /**
   * Extends existing client property video with seamless AI continuation
   * (Condition 1 & 3)
   */
  public extendVideo = async (req: Request, res: Response): Promise<void> => {
    const organizationId = req.organizationId;
    if (!organizationId) throw AppError.unauthorized('Organization required');

    const { id: projectId } = req.params;
    const { mediaAssetId, continuationPrompt, durationSeconds } = req.body || {};

    if (!mediaAssetId) {
      throw AppError.badRequest('mediaAssetId is required to extend video');
    }

    const result = await creativeEngineService.extendVideo({
      organizationId,
      projectId,
      mediaAssetId,
      continuationPrompt,
      durationSeconds: durationSeconds ? parseInt(durationSeconds, 10) : undefined,
      userId: req.user?.userId,
    });

    sendSuccess(res, result, 201, {
      message: 'Video continuation synthesized and scheduled for review successfully',
    });
  };

  /**
   * Generates Occasion & Festival themed creative assets (Posters + Reel)
   * (Condition 2, 3 & 4)
   */
  public generateOccasion = async (req: Request, res: Response): Promise<void> => {
    const organizationId = req.organizationId;
    if (!organizationId) throw AppError.unauthorized('Organization required');

    const { id: projectId } = req.params;
    const { occasion, customOffer, customHeadline } = req.body || {};

    if (!occasion) {
      throw AppError.badRequest(
        'Occasion is required (e.g., diwali, holi, new_year, independence_day, monsoon, promotional_offer)'
      );
    }

    const result = await creativeEngineService.generateOccasionCreativeSet({
      organizationId,
      projectId,
      occasion,
      customOffer,
      customHeadline,
      userId: req.user?.userId,
    });

    sendSuccess(res, result, 201, {
      message: 'Occasion creative set (posters + reel) synthesized and scheduled for review successfully',
    });
  };

  /**
   * Returns list of supported occasions/festivals with full styling and default copy
   */
  public getOccasions = async (_req: Request, res: Response): Promise<void> => {
    sendSuccess(res, Object.values(OCCASIONS));
  };

  /**
   * Generates a complete 9:16 Presenter Walkthrough Video with voiceover narration & avatar badge
   */
  public generatePresenterVideo = async (req: Request, res: Response): Promise<void> => {
    const organizationId = req.organizationId;
    if (!organizationId) throw AppError.unauthorized('Organization required');

    const { id: projectId } = req.params;
    const { unitId, language, stylePreset, presenterAssetId, selectedAssetIds } = req.body || {};

    const creative = await presenterWalkthroughService.generatePresenterWalkthroughVideo({
      organizationId,
      projectId,
      unitId,
      userId: req.user?.userId,
      language: language || 'Hinglish',
      stylePreset: stylePreset || 'HERITAGE_LUXURY',
      presenterAssetId,
      selectedAssetIds,
    });

    sendSuccess(res, creative, 201, {
      message: 'Presenter Walkthrough Video synthesized successfully and submitted for review',
    });
  };

  /**
   * Generates 5-Step AI Captions & Ad Copy variants
   */
  public generateCaptions = async (req: Request, res: Response): Promise<void> => {
    const organizationId = req.organizationId;
    if (!organizationId) throw AppError.unauthorized('Organization required');

    const { id: projectId } = req.params;
    const { unitId, stylePreset } = req.body || {};

    const project = await Project.findOne({ _id: projectId, organizationId });
    if (!project) throw AppError.notFound('Project not found');

    const unit = unitId ? await PropertyUnit.findOne({ _id: unitId, organizationId }) : null;
    const details = (project.details || {}) as Record<string, any>;

    const result = await captionService.generateCaptions({
      projectName: project.name || 'Luxury Residences',
      category: project.category,
      subtype: project.subtype,
      city: project.location?.city || details.city || 'Mohali',
      state: project.location?.state || details.state || 'Punjab',
      sectorOrLocation: details.sector || project.location?.address || 'Sector 66 / Airport Road',
      bhk: unit?.unitType || details.bhk ? `${details.bhk} BHK` : '3 BHK',
      areaSqFt: unit?.carpetAreaSqFt || unit?.superBuiltUpAreaSqFt || details.carpetAreaSqFt || '1850',
      priceDisplay: unit?.price ? `₹ ${(unit.price / 10000000).toFixed(2)} Cr*` : details.priceRange || '₹ 1.25 Cr Onwards',
      amenities: project.amenities || ['Clubhouse', 'Swimming Pool', 'Security'],
      reraNumber: project.reraNumber,
      salesPhone: project.ownerContacts?.[0]?.phone || '+91 77103-80077',
      salesOfficeName: project.ownerContacts?.[0]?.name || 'Experience Centre',
      stylePreset: stylePreset || 'HERITAGE_LUXURY',
    });

    sendSuccess(res, result, 200, {
      message: 'Captions generated successfully',
    });
  };

  /**
   * AI Studio: Vision Analysis of Client Uploaded Photos
   */
  public analyzeStudioProperty = async (req: Request, res: Response): Promise<void> => {
    const organizationId = req.organizationId;
    if (!organizationId) throw AppError.unauthorized('Organization required');

    const { projectId } = req.params;
    const vision = await aiStudioService.analyzePropertyPhotos(organizationId, projectId);
    sendSuccess(res, vision, 200, { message: 'Property photos analyzed successfully' });
  };

  /**
   * AI Studio: Generate 10-15 Fresh Images for Property
   */
  public generateStudioImages = async (req: Request, res: Response): Promise<void> => {
    const organizationId = req.organizationId;
    if (!organizationId) throw AppError.unauthorized('Organization required');

    const { projectId } = req.params;
    const { targetCount = 15, stylePreset = 'HERITAGE_LUXURY' } = req.body || {};

    const batch = await aiStudioService.generateBatchImages(organizationId, projectId, {
      targetCount: Number(targetCount),
      stylePreset,
    });

    sendSuccess(res, batch, 201, {
      message: `Generated 15-Shot AI Marketing Image Suite (v${batch.version})`,
    });
  };

  /**
   * AI Studio: Regenerate Single Image in Batch
   */
  public regenerateStudioImage = async (req: Request, res: Response): Promise<void> => {
    const organizationId = req.organizationId;
    if (!organizationId) throw AppError.unauthorized('Organization required');

    const { batchId } = req.params;
    const { imageId } = req.body || {};
    if (!imageId) throw AppError.badRequest('imageId is required');

    const updatedImage = await aiStudioService.regenerateSingleImage(organizationId, batchId, imageId);
    sendSuccess(res, updatedImage, 200, { message: 'Image re-rendered successfully with fresh perspective' });
  };

  /**
   * AI Studio: Update Selection of Images
   */
  public updateStudioSelection = async (req: Request, res: Response): Promise<void> => {
    const organizationId = req.organizationId;
    if (!organizationId) throw AppError.unauthorized('Organization required');

    const { batchId } = req.params;
    const { selectedImageIds = [] } = req.body || {};

    const batch = await aiStudioService.updateImageSelection(organizationId, batchId, selectedImageIds);
    sendSuccess(res, batch, 200, { message: 'Image selection updated' });
  };

  /**
   * AI Studio: Generate AI Reel from Selected Images
   */
  public generateStudioReel = async (req: Request, res: Response): Promise<void> => {
    const organizationId = req.organizationId;
    if (!organizationId) throw AppError.unauthorized('Organization required');

    const { batchId } = req.params;
    const { variationStyle = 'CINEMATIC_SHOWCASE', selectedImageIds } = req.body || {};

    const reel = await aiStudioService.generateAiReel(
      organizationId,
      batchId,
      variationStyle,
      selectedImageIds
    );

    sendSuccess(res, reel, 201, { message: 'AI Reel synthesized successfully' });
  };

  /**
   * AI Studio: Get Batches for a Project
   */
  public getStudioBatches = async (req: Request, res: Response): Promise<void> => {
    const organizationId = req.organizationId;
    if (!organizationId) throw AppError.unauthorized('Organization required');

    const { projectId } = req.params;
    const batches = await aiStudioService.getBatches(organizationId, projectId);
    sendSuccess(res, batches);
  };

  /**
   * AI Studio: Get Batch By ID
   */
  public getStudioBatchById = async (req: Request, res: Response): Promise<void> => {
    const organizationId = req.organizationId;
    if (!organizationId) throw AppError.unauthorized('Organization required');

    const { batchId } = req.params;
    const batch = await aiStudioService.getBatchById(organizationId, batchId);
    sendSuccess(res, batch);
  };

  /**
   * AI Studio: Approve or Reject a Studio Reel
   */
  public setStudioReelApproval = async (req: Request, res: Response): Promise<void> => {
    const organizationId = req.organizationId;
    if (!organizationId) throw AppError.unauthorized('Organization required');

    const { batchId, reelId } = req.params;
    const { status } = req.body || {};
    if (!status || !['APPROVED', 'REJECTED'].includes(status)) {
      throw AppError.badRequest('status must be APPROVED or REJECTED');
    }

    const reel = await aiStudioService.setReelApproval(organizationId, batchId, reelId, status);
    sendSuccess(res, reel, 200, { message: `Reel status updated to ${status}` });
  };
}

export const aiController = new AiController();
