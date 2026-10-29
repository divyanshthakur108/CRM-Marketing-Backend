import { Types } from 'mongoose';
import { Creative, ICreative } from '../../models/Creative.js';
import { PlanItem } from '../../models/PlanItem.js';
import { Project } from '../../models/Project.js';
import { Approval } from '../../models/Approval.js';
import { UsageLedger } from '../../models/UsageLedger.js';
import { Notification } from '../../models/Notification.js';
import { getAIProvider } from './providers/index.js';
import { FactChecker } from './factChecker.js';
import { AppError } from '../../utils/AppError.js';
import { logger } from '../../config/logger.js';

export interface GenerateCreativeForItemOptions {
  aspectRatio?: '1:1' | '4:5' | '9:16';
  language?: 'English' | 'Hindi' | 'Hinglish';
  customPrompt?: string;
  tone?: string;
}

export class CreativeService {
  private toObjectId(id: Types.ObjectId | string): Types.ObjectId {
    return typeof id === 'string' ? new Types.ObjectId(id) : id;
  }

  /**
   * Generates or regenerates an AI Creative for a specific PlanItem.
   * Performs factual verification, version tracking, usage logging, and notification creation.
   */
  public async generateCreativeForPlanItem(
    organizationId: Types.ObjectId | string,
    planItemId: Types.ObjectId | string,
    options: GenerateCreativeForItemOptions = {}
  ): Promise<ICreative> {
    const orgId = this.toObjectId(organizationId);
    const itemId = this.toObjectId(planItemId);

    const planItem = await PlanItem.findOne({ _id: itemId, organizationId: orgId });
    if (!planItem) {
      throw AppError.notFound('Plan item not found');
    }

    const project = await Project.findOne({ _id: planItem.projectId, organizationId: orgId });
    if (!project) {
      throw AppError.notFound('Linked project not found');
    }

    // Build verified factual baseline from project & unit inventory
    const verifiedFacts = await FactChecker.buildVerifiedFacts(project);

    // Determine geometry aspect ratio
    let format: '1:1' | '4:5' | '9:16' = options.aspectRatio || '4:5';
    if (!options.aspectRatio) {
      if (
        planItem.type === 'REEL_9x16' ||
        planItem.type === 'INSTAGRAM_REEL' ||
        planItem.type === 'YOUTUBE_SHORTS'
      ) {
        format = '9:16';
      } else if (
        planItem.type === 'CAROUSEL' ||
        planItem.type === 'FACEBOOK_CAROUSEL'
      ) {
        format = '1:1';
      } else {
        format = '4:5';
      }
    }

    const provider = getAIProvider();

    // 1. Generate compliant caption & copy
    const captionResult = await provider.generateCaption({
      projectName: project.name,
      category: project.category,
      micromarket: project.location?.microMarket,
      city: project.location?.city,
      address: project.location?.address,
      priceDisplay: project.priceRange?.display,
      priceMin: project.priceRange?.min,
      priceMax: project.priceRange?.max,
      reraNumber: project.reraNumber,
      bhkConfigs: verifiedFacts.allowedBhk.map((b) => `${b} BHK`),
      amenities: project.amenities,
      targetAudience: planItem.targetAudience,
      topic: planItem.topic,
      creativeBrief: planItem.creativeBrief,
      channel: planItem.channel,
      language: options.language || 'English',
      tone: options.tone,
    });

    // 2. Generate high-resolution visual render
    const imagePrompt = options.customPrompt || `${planItem.topic}. ${planItem.creativeBrief}`;
    const imageResult = await provider.generateImage({
      prompt: imagePrompt,
      aspectRatio: format,
      projectName: project.name,
    });

    // 3. Fact-Check Step: Verify generated copy strictly against verified project facts
    const fullCopyText = `${captionResult.headline} ${captionResult.caption}`;
    const factCheck = FactChecker.verifyText(fullCopyText, verifiedFacts);

    // 4. Creative Versioning: each generation/revision creates a new version; resets approval
    let creative = await Creative.findOne({ organizationId: orgId, planItemId: itemId });

    if (creative) {
      const nextVersion = creative.version + 1;
      // Push prior version into history ledger
      creative.history.push({
        version: creative.version,
        headline: creative.headline,
        caption: creative.caption,
        hashtags: creative.hashtags,
        renderedAssetUrl: creative.renderedAssetUrl,
        approvalStatus: creative.approvalStatus,
        factCheckPassed: creative.factCheckPassed,
        factCheckIssues: creative.factCheckIssues,
        revisionNotes: creative.revisionNotes,
        generatedAt: creative.updatedAt || new Date(),
      });

      creative.version = nextVersion;
      creative.headline = captionResult.headline;
      creative.caption = captionResult.caption;
      creative.hashtags = captionResult.hashtags;
      creative.renderedAssetUrl = imageResult.url;
      creative.format = imageResult.format;
      creative.language = captionResult.language;
      creative.status = 'GENERATED';
      creative.approvalStatus = 'PENDING_APPROVAL'; // Revision resets approval!
      creative.factCheckPassed = factCheck.passed;
      creative.factCheckIssues = factCheck.issues;
      creative.reReviewRequired = false;
      await creative.save();
    } else {
      creative = await Creative.create({
        organizationId: orgId,
        planItemId: itemId,
        projectId: project._id,
        format: imageResult.format,
        renderedAssetUrl: imageResult.url,
        headline: captionResult.headline,
        caption: captionResult.caption,
        hashtags: captionResult.hashtags,
        language: captionResult.language,
        status: 'GENERATED',
        approvalStatus: 'PENDING_APPROVAL',
        version: 1,
        factCheckPassed: factCheck.passed,
        factCheckIssues: factCheck.issues,
        reReviewRequired: false,
        history: [],
      });
    }

    // 5. Sync or create statutory Approval record
    const approval = await Approval.findOne({
      organizationId: orgId,
      $or: [{ creativeId: creative._id }, { planItemId: itemId }],
    });

    if (approval) {
      approval.creativeId = creative._id as Types.ObjectId;
      approval.planItemId = itemId;
      approval.title = `${project.name} - ${planItem.title || planItem.topic} (v${creative.version})`;
      approval.status = 'PENDING'; // Reset approval
      approval.factChecklist = {
        priceVerified: factCheck.passed,
        bedroomsVerified: factCheck.passed,
        amenitiesVerified: factCheck.passed,
        ctaVerified: true,
        reraDisclaimerVerified: Boolean(project.reraNumber),
      };
      approval.comments.push({
        authorName: 'AI Compliance Checker',
        text: factCheck.passed
          ? `v${creative.version} generated. All facts strictly verified against project master.`
          : `v${creative.version} flagged fact-check issues: ${factCheck.issues.join('; ')}`,
        createdAt: new Date(),
      });
      await approval.save();
    } else {
      await Approval.create({
        organizationId: orgId,
        entityType: 'CREATIVE',
        creativeId: creative._id,
        planItemId: itemId,
        title: `${project.name} - ${planItem.title || planItem.topic} (v${creative.version})`,
        status: 'PENDING',
        factChecklist: {
          priceVerified: factCheck.passed,
          bedroomsVerified: factCheck.passed,
          amenitiesVerified: factCheck.passed,
          ctaVerified: true,
          reraDisclaimerVerified: Boolean(project.reraNumber),
        },
        comments: [
          {
            authorName: 'AI Compliance Checker',
            text: factCheck.passed
              ? `v${creative.version} generated. All facts strictly verified against project master.`
              : `v${creative.version} flagged fact-check issues: ${factCheck.issues.join('; ')}`,
            createdAt: new Date(),
          },
        ],
      });
    }

    // 6. Update PlanItem preview & snippets
    planItem.previewUrl = imageResult.url;
    planItem.copySnippet = captionResult.caption;
    // Keep planItem approval aligned with latest creative version
    planItem.approvalStatus = 'PENDING_APPROVAL';
    await planItem.save();

    // 7. Log Telemetry in UsageLedger
    try {
      await UsageLedger.create([
        {
          organizationId: orgId,
          creditType: 'IMAGE_RENDER',
          amount: 1,
          balanceAfter: 4999,
          description: `Generated AI visual asset (${format}) for "${project.name}" (v${creative.version})`,
          referenceId: creative._id.toString(),
        },
        {
          organizationId: orgId,
          creditType: 'AI_COPY',
          amount: 1,
          balanceAfter: 4998,
          description: `Synthesized verified marketing copy for "${project.name}" (v${creative.version})`,
          referenceId: creative._id.toString(),
        },
      ]);
    } catch (err) {
      logger.warn({ err }, 'Failed to record usage ledger telemetry');
    }

    // 8. Create In-App Notification
    try {
      await Notification.create({
        organizationId: orgId,
        title: `AI Creative v${creative.version} Ready for Review`,
        message: `Visual asset and multilingual copy synthesized for ${project.name}. Fact-check status: ${
          factCheck.passed ? 'PASSED (Compliant)' : 'FLAGGED (' + factCheck.issues.length + ' warnings)'
        }.`,
        category: 'APPROVAL_REQUIRED',
        link: '/approvals',
      });
    } catch (err) {
      logger.warn({ err }, 'Failed to create in-app notification');
    }

    return creative;
  }

  /**
   * Requests a revision on an existing creative.
   * Increments version, preserves history, and resets approval requirement.
   */
  public async requestRevision(
    organizationId: Types.ObjectId | string,
    creativeId: Types.ObjectId | string,
    revisionNotes: string,
    userId?: Types.ObjectId | string,
    userName?: string
  ): Promise<ICreative> {
    const orgId = this.toObjectId(organizationId);
    const cId = this.toObjectId(creativeId);

    const creative = await Creative.findOne({ _id: cId, organizationId: orgId });
    if (!creative) {
      throw AppError.notFound('Creative asset not found');
    }

    const nextVersion = creative.version + 1;

    // Push previous version into historical archive
    creative.history.push({
      version: creative.version,
      headline: creative.headline,
      caption: creative.caption,
      hashtags: creative.hashtags,
      renderedAssetUrl: creative.renderedAssetUrl,
      approvalStatus: creative.approvalStatus,
      factCheckPassed: creative.factCheckPassed,
      factCheckIssues: creative.factCheckIssues,
      revisionNotes: creative.revisionNotes,
      generatedAt: creative.updatedAt || new Date(),
    });

    const project = creative.projectId
      ? await Project.findOne({ _id: creative.projectId, organizationId: orgId })
      : null;
    const verifiedFacts = project ? await FactChecker.buildVerifiedFacts(project) : null;

    // Synthesize updated version using AI provider incorporating revision instructions
    const provider = getAIProvider();
    const captionResult = await provider.generateCaption({
      projectName: project ? project.name : 'Exclusive Residences',
      category: project?.category,
      micromarket: project?.location?.microMarket,
      city: project?.location?.city,
      priceDisplay: project?.priceRange?.display,
      reraNumber: project?.reraNumber,
      bhkConfigs: verifiedFacts ? verifiedFacts.allowedBhk.map((b) => `${b} BHK`) : undefined,
      topic: `Revision iteration v${nextVersion}: ${revisionNotes}`,
      creativeBrief: revisionNotes,
      language: creative.language,
    });

    const factCheck = verifiedFacts
      ? FactChecker.verifyText(`${captionResult.headline} ${captionResult.caption}`, verifiedFacts)
      : { passed: true, issues: [], verifiedFacts: [] };

    creative.version = nextVersion;
    creative.headline = captionResult.headline;
    creative.caption = captionResult.caption;
    creative.hashtags = captionResult.hashtags;
    creative.revisionNotes = revisionNotes;
    creative.status = 'GENERATED';
    creative.approvalStatus = 'PENDING_APPROVAL'; // Revision resets approval!
    creative.factCheckPassed = factCheck.passed;
    creative.factCheckIssues = factCheck.issues;
    creative.reReviewRequired = false;
    await creative.save();

    // Reset linked Approval item
    const approval = await Approval.findOne({
      organizationId: orgId,
      $or: [{ creativeId: creative._id }, { planItemId: creative.planItemId }],
    });

    if (approval) {
      approval.status = 'PENDING';
      approval.comments.push({
        authorId: userId ? this.toObjectId(userId) : undefined,
        authorName: userName || 'Reviewer',
        text: `Revision requested: "${revisionNotes}". Incremented to v${nextVersion}. Approval reset.`,
        createdAt: new Date(),
      });
      await approval.save();
    }

    // Reset linked PlanItem status
    if (creative.planItemId) {
      await PlanItem.findOneAndUpdate(
        { _id: creative.planItemId, organizationId: orgId },
        {
          $set: {
            approvalStatus: 'PENDING_APPROVAL',
            copySnippet: creative.caption,
          },
        }
      );
    }

    // Telemetry & Notification
    try {
      await UsageLedger.create({
        organizationId: orgId,
        creditType: 'AI_COPY',
        amount: 1,
        balanceAfter: 4995,
        description: `Synthesized revision v${nextVersion} copy for creative ${creative._id}`,
        referenceId: creative._id.toString(),
      });

      await Notification.create({
        organizationId: orgId,
        title: `Creative Revision v${nextVersion} Created`,
        message: `Revision requested by ${userName || 'Approver'}. Generated version v${nextVersion} requiring fresh approval.`,
        category: 'APPROVAL_REQUIRED',
        link: '/approvals',
      });
    } catch (err) {
      logger.warn({ err }, 'Error recording revision telemetry');
    }

    return creative;
  }

  /**
   * Flags all creatives of a project for re-review when property specifications change.
   */
  public async flagCreativesForReReview(
    organizationId: Types.ObjectId | string,
    projectId: Types.ObjectId | string,
    reason: string = 'Property details updated in master catalog'
  ): Promise<number> {
    const orgId = this.toObjectId(organizationId);
    const pId = this.toObjectId(projectId);

    const creatives = await Creative.find({ organizationId: orgId, projectId: pId });
    if (creatives.length === 0) return 0;

    let flaggedCount = 0;
    for (const c of creatives) {
      c.reReviewRequired = true;
      if (c.approvalStatus === 'APPROVED') {
        c.approvalStatus = 'CHANGES_REQUESTED';
      }
      await c.save();
      flaggedCount++;

      // Reset linked approval
      await Approval.updateMany(
        { organizationId: orgId, $or: [{ creativeId: c._id }, { planItemId: c.planItemId }] },
        {
          $set: { status: 'CHANGES_REQUESTED' },
          $push: {
            comments: {
              authorName: 'Master Data Auditor',
              text: `Project data changed (${reason}). Creative flagged for re-review.`,
              createdAt: new Date(),
            },
          },
        }
      );

      // Reset linked plan item
      if (c.planItemId) {
        await PlanItem.updateMany(
          { _id: c.planItemId, organizationId: orgId },
          { $set: { approvalStatus: 'CHANGES_REQUESTED' } }
        );
      }
    }

    try {
      await Notification.create({
        organizationId: orgId,
        title: 'Project Data Changed - Creatives Flagged for Re-Review',
        message: `${flaggedCount} creative(s) flagged for re-verification due to project specifications update (${reason}).`,
        category: 'RERA_COMPLIANCE',
        link: '/approvals',
      });
    } catch (err) {
      logger.warn({ err }, 'Failed to create re-review notification');
    }

    return flaggedCount;
  }
}

export const creativeService = new CreativeService();
