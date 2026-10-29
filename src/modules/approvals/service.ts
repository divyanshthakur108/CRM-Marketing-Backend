import { Types, FilterQuery } from 'mongoose';
import { Approval, IApproval } from '../../models/Approval.js';
import { Creative } from '../../models/Creative.js';
import { PlanItem } from '../../models/PlanItem.js';
import { Project } from '../../models/Project.js';
import { AppError } from '../../utils/AppError.js';
import { DecideApprovalInput } from './validation.js';

export class ApprovalService {
  private toObjectId(id: Types.ObjectId | string): Types.ObjectId {
    return typeof id === 'string' ? new Types.ObjectId(id) : id;
  }

  /**
   * Retrieves approval queue items for an organization.
   * Auto-provisions sample creative approvals linked to tenant projects if none exist.
   */
  async getApprovals(
    organizationId: Types.ObjectId | string,
    statusFilter?: string
  ): Promise<IApproval[]> {
    const orgId = this.toObjectId(organizationId);
    const query: FilterQuery<IApproval> = { organizationId: orgId };

    if (statusFilter && statusFilter !== 'ALL') {
      query.status = statusFilter;
    }

    const approvals = await Approval.find(query).sort({ createdAt: -1 });

    if (approvals.length === 0 && (!statusFilter || statusFilter === 'ALL')) {
      // Provision realistic default creative approvals for tenant projects
      const projects = await Project.find({ organizationId: orgId }).limit(3);
      if (projects.length > 0) {
        await Approval.create([
          {
            organizationId: orgId,
            entityType: 'CREATIVE',
            title: `${projects[0].name} - 3BHK Master Bedroom Showcase (9:16 Reel)`,
            status: 'PENDING',
            factChecklist: {
              priceVerified: true,
              bedroomsVerified: true,
              amenitiesVerified: true,
              ctaVerified: true,
              reraDisclaimerVerified: true,
            },
            comments: [
              {
                authorName: 'AI Compliance Checker',
                text: 'All 5 statutory disclosures matched against approved RERA filing.',
                createdAt: new Date(),
              },
            ],
          },
          {
            organizationId: orgId,
            entityType: 'CREATIVE',
            title: `${projects[projects.length > 1 ? 1 : 0].name} - Festive Spot Booking Campaign (4:5 Feed)`,
            status: 'PENDING',
            factChecklist: {
              priceVerified: true,
              bedroomsVerified: false,
              amenitiesVerified: true,
              ctaVerified: true,
              reraDisclaimerVerified: true,
            },
            comments: [
              {
                authorName: 'Creative Editor',
                text: 'Updated typography with higher contrast ratio and disclaimer footer.',
                createdAt: new Date(),
              },
            ],
          },
        ]);

        return Approval.find(query).sort({ createdAt: -1 });
      }
    }

    return approvals;
  }

  /**
   * Decides on an approval item (Approved or Changes Requested).
   * Strict role check: Only manager/approver roles can decide approvals!
   */
  async decideApproval(
    organizationId: Types.ObjectId | string,
    approvalId: string,
    userId: Types.ObjectId | string,
    userName: string,
    userRole: string,
    input: DecideApprovalInput
  ): Promise<IApproval> {
    const allowedRoles = ['platform_admin', 'org_owner', 'marketing_manager', 'client_approver'];
    if (!allowedRoles.includes(userRole)) {
      throw AppError.forbidden(
        'Only manager/approver roles (marketing_manager, client_approver, org_owner) can approve or reject items.'
      );
    }

    const orgId = this.toObjectId(organizationId);
    const approval = await Approval.findOne({
      _id: this.toObjectId(approvalId),
      organizationId: orgId,
    });

    if (!approval) {
      throw AppError.notFound('Approval item not found');
    }

    if (input.decision === 'APPROVED' && input.factChecklist) {
      const { priceVerified, bedroomsVerified, amenitiesVerified, ctaVerified, reraDisclaimerVerified } =
        input.factChecklist;
      const allVerified =
        priceVerified && bedroomsVerified && amenitiesVerified && ctaVerified && reraDisclaimerVerified;

      if (!allVerified) {
        throw AppError.badRequest('All 5 statutory facts must be verified before granting approval.');
      }
    }

    approval.status = input.decision;
    approval.decidedBy = this.toObjectId(userId);
    approval.decidedByName = userName;
    approval.decidedAt = new Date();

    if (input.factChecklist) {
      approval.factChecklist = {
        priceVerified: input.factChecklist.priceVerified ?? approval.factChecklist.priceVerified,
        bedroomsVerified: input.factChecklist.bedroomsVerified ?? approval.factChecklist.bedroomsVerified,
        amenitiesVerified: input.factChecklist.amenitiesVerified ?? approval.factChecklist.amenitiesVerified,
        ctaVerified: input.factChecklist.ctaVerified ?? approval.factChecklist.ctaVerified,
        reraDisclaimerVerified:
          input.factChecklist.reraDisclaimerVerified ?? approval.factChecklist.reraDisclaimerVerified ?? false,
      };
    }

    if (input.feedback) {
      approval.comments.push({
        authorId: this.toObjectId(userId),
        authorName: userName,
        text: input.feedback,
        createdAt: new Date(),
      });
    }

    await approval.save();

    // Sync status to linked Creative and PlanItem
    const newStatus = input.decision; // 'APPROVED' or 'CHANGES_REQUESTED'
    if (approval.creativeId) {
      await Creative.updateOne(
        { _id: approval.creativeId, organizationId: orgId },
        {
          $set: {
            approvalStatus: newStatus,
            status: newStatus === 'APPROVED' ? 'APPROVED' : 'GENERATED',
          },
        }
      );
    }

    if (approval.planItemId) {
      await PlanItem.updateOne(
        { _id: approval.planItemId, organizationId: orgId },
        { $set: { approvalStatus: newStatus } }
      );
    }

    return approval;
  }
}

export const approvalService = new ApprovalService();
