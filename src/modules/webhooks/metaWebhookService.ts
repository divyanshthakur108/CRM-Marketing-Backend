import crypto from 'crypto';
import { Types } from 'mongoose';
import { Lead, ILead, computeLeadDedupeKey } from '../../models/Lead.js';
import { LeadActivity } from '../../models/LeadActivity.js';
import { MetaConnection } from '../../models/MetaConnection.js';
import { Organization } from '../../models/Organization.js';
import { logger } from '../../config/logger.js';
import { AppError } from '../../utils/AppError.js';

export interface MetaLeadgenChangeValue {
  leadgen_id: string;
  page_id?: string;
  form_id?: string;
  ad_id?: string;
  campaign_id?: string;
  created_time?: number;
  lead_data?: {
    name?: string;
    phone?: string;
    email?: string;
    projectName?: string;
    budget?: number;
    notes?: string;
  };
}

export interface DirectLeadWebhookPayload {
  organizationId?: string;
  leadgen_id: string;
  name: string;
  phone: string;
  email?: string;
  projectName?: string;
  projectId?: string;
  campaignId?: string;
  adId?: string;
  budget?: number;
  notes?: string;
}

export class MetaWebhookService {
  /**
   * Verifies the X-Hub-Signature-256 header sent by Meta
   */
  verifySignature(rawBody: string | Buffer, signatureHeader?: string, secret?: string): boolean {
    const appSecret = secret || process.env.META_APP_SECRET || 'realcrm_meta_webhook_secret_2026';
    if (!signatureHeader) {
      // In dev/test mode with no header provided
      if (process.env.NODE_ENV === 'test' || process.env.META_ADAPTER === 'mock') {
        return true;
      }
      return false;
    }

    const [algorithm, signature] = signatureHeader.split('=');
    if (algorithm !== 'sha256' || !signature) {
      return false;
    }

    const hmac = crypto.createHmac('sha256', appSecret);
    const bodyStr = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
    const digest = hmac.update(bodyStr).digest('hex');

    try {
      return crypto.timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(digest, 'hex'));
    } catch {
      return false;
    }
  }

  /**
   * Ingests Meta leadgen payload and strictly deduplicates repeated deliveries
   */
  async processLeadWebhook(payload: Record<string, unknown>): Promise<{
    success: boolean;
    deduplicated: boolean;
    lead?: ILead;
    leadId?: string;
    message: string;
  }> {
    logger.info({ payload }, 'Processing Meta leads webhook');

    // Handle standard Meta Graph API webhook format
    // { object: 'page', entry: [{ id, changes: [{ field: 'leadgen', value: { leadgen_id, ... } }] }] }
    let leadgenId = '';
    let pageId = '';
    let name = '';
    let phone = '';
    let email = '';
    let projectName = '';
    let budget: number | undefined;
    let explicitOrgId = '';

    if (payload.leadgen_id) {
      // Direct / normalized format
      const direct = payload as unknown as DirectLeadWebhookPayload;
      leadgenId = direct.leadgen_id;
      name = direct.name;
      phone = direct.phone;
      email = direct.email || '';
      projectName = direct.projectName || '';
      budget = direct.budget;
      explicitOrgId = direct.organizationId || '';
    } else if (Array.isArray(payload.entry)) {
      // Meta Graph API format
      const entry = payload.entry[0] as {
        id?: string;
        changes?: Array<{ field: string; value: MetaLeadgenChangeValue }>;
      };
      pageId = entry?.id || '';
      const change = entry?.changes?.[0];
      if (change?.field === 'leadgen' && change.value) {
        leadgenId = change.value.leadgen_id;
        pageId = change.value.page_id || pageId;
        const data = change.value.lead_data || {};
        name = data.name || `Meta Lead ${leadgenId}`;
        phone = data.phone || '+91 98000 00000';
        email = data.email || '';
        projectName = data.projectName || '';
        budget = data.budget;
      }
    }

    if (!leadgenId) {
      throw AppError.badRequest('Missing leadgen_id in webhook payload', 'INVALID_WEBHOOK_PAYLOAD');
    }

    if (!name || !phone) {
      name = name || `Meta Lead ${leadgenId}`;
      phone = phone || '+91 99999 99999';
    }

    // Resolve Target Organization
    let targetOrgId: Types.ObjectId | null = null;
    if (explicitOrgId && Types.ObjectId.isValid(explicitOrgId)) {
      targetOrgId = new Types.ObjectId(explicitOrgId);
    } else if (pageId) {
      const conn = await MetaConnection.findOne({ 'pages.id': pageId });
      if (conn) {
        targetOrgId = conn.organizationId;
      }
    }

    if (!targetOrgId) {
      // Fallback: match first active organization or default
      const defaultOrg = await Organization.findOne();
      if (defaultOrg) {
        targetOrgId = defaultOrg._id as Types.ObjectId;
      }
    }

    if (!targetOrgId) {
      throw AppError.badRequest('Could not resolve organization context for lead', 'ORG_NOT_RESOLVED');
    }

    const dedupeKey = computeLeadDedupeKey(phone, email);

    // DEDUPLICATION CHECK 1: Check by metaLeadId
    const existingByMetaId = await Lead.findOne({
      organizationId: targetOrgId,
      metaLeadId: leadgenId,
    });

    if (existingByMetaId) {
      logger.info(
        { organizationId: targetOrgId, leadgenId, leadId: existingByMetaId._id },
        'Meta webhook duplicate delivery detected via metaLeadId - Deduplicated successfully'
      );
      return {
        success: true,
        deduplicated: true,
        lead: existingByMetaId,
        leadId: existingByMetaId._id.toString(),
        message: 'Duplicate delivery acknowledged without duplicate lead creation (matched metaLeadId)',
      };
    }

    // DEDUPLICATION CHECK 2: Check by tenant-scoped normalized dedupeKey
    const existingByDedupe = await Lead.findOne({
      organizationId: targetOrgId,
      dedupeKey,
    });

    if (existingByDedupe) {
      // Update the existing lead with metaLeadId if missing
      if (!existingByDedupe.metaLeadId) {
        existingByDedupe.metaLeadId = leadgenId;
        await existingByDedupe.save();
      }

      await LeadActivity.create({
        organizationId: targetOrgId,
        leadId: existingByDedupe._id,
        authorName: 'Meta Ads Webhook',
        type: 'INBOUND_SUBMISSION',
        summary: `Repeat Meta ad form submission detected [Form ID: ${leadgenId}]. Contact history updated.`,
        details: { leadgenId, source: 'META_AD' },
      });

      logger.info(
        { organizationId: targetOrgId, dedupeKey, leadId: existingByDedupe._id },
        'Meta webhook duplicate delivery detected via dedupeKey - Deduplicated successfully'
      );

      return {
        success: true,
        deduplicated: true,
        lead: existingByDedupe,
        leadId: existingByDedupe._id.toString(),
        message: 'Duplicate delivery acknowledged without duplicate lead creation (matched dedupeKey)',
      };
    }

    // Create New Lead
    const newLead = await Lead.create({
      organizationId: targetOrgId,
      dedupeKey,
      name,
      phone,
      email: email || undefined,
      projectName: projectName || undefined,
      budget,
      budgetDisplay: budget ? `₹ ${(budget / 100000).toFixed(2)} L` : undefined,
      stage: 'New',
      source: 'META_AD',
      metaLeadId: leadgenId,
      consentGiven: true,
      consentTimestamp: new Date(),
      consentSource: 'META_LEADGEN_FORM',
      tags: ['Meta LeadGen', 'Digital Inbound'],
    });

    await LeadActivity.create({
      organizationId: targetOrgId,
      leadId: newLead._id,
      authorName: 'Meta Ads Webhook',
      type: 'INBOUND_SUBMISSION',
      summary: `Inbound buyer lead captured via Meta Ad Form (Lead ID: ${leadgenId})`,
      details: {
        leadgenId,
        pageId,
        consentSource: 'META_LEADGEN_FORM',
      },
    });

    logger.info(
      { organizationId: targetOrgId, leadId: newLead._id, leadgenId },
      'Successfully created new lead from Meta webhook'
    );

    return {
      success: true,
      deduplicated: false,
      lead: newLead,
      leadId: newLead._id.toString(),
      message: 'Lead created successfully from Meta webhook',
    };
  }
}

export const metaWebhookService = new MetaWebhookService();
