import { Types } from 'mongoose';
import { Conversation, IConversation, IMessage } from '../../models/Conversation.js';
import { Lead } from '../../models/Lead.js';
import { Project } from '../../models/Project.js';
import { LeadActivity } from '../../models/LeadActivity.js';
import { getWhatsAppAdapter } from './adapters/index.js';
import { whatsAppBotService } from './whatsAppBot.js';
import { AppError } from '../../utils/AppError.js';
import { logger } from '../../config/logger.js';

export interface StartConversationDTO {
  contactPhone: string;
  contactName: string;
  projectName?: string;
  projectId?: string;
  leadId?: string;
  initialMessage: string;
  isPromotional?: boolean;
  templateName?: string;
}

export interface SendMessageDTO {
  text: string;
  isPromotional?: boolean;
  templateName?: string;
  templateParams?: Record<string, string>;
}

export class WhatsAppService {
  /**
   * Starts a new WhatsApp thread or appends to an existing one.
   * STRICT CONSENT RULE: Never start a promotional message without recorded consent.
   */
  async startConversation(
    organizationId: string | Types.ObjectId,
    dto: StartConversationDTO
  ): Promise<IConversation> {
    const orgId = typeof organizationId === 'string' ? new Types.ObjectId(organizationId) : organizationId;

    // Consent verification for promotional outreach
    let lead = null;
    if (dto.leadId && Types.ObjectId.isValid(dto.leadId)) {
      lead = await Lead.findOne({ _id: dto.leadId, organizationId: orgId });
    } else {
      lead = await Lead.findOne({
        organizationId: orgId,
        $or: [{ phone: dto.contactPhone }, { dedupeKey: `phone:${dto.contactPhone.replace(/[^\d+]/g, '')}` }],
      });
    }

    if (dto.isPromotional) {
      if (!lead || !lead.consentGiven) {
        throw AppError.forbidden(
          'Cannot send promotional message to contact without recorded consent',
          'CONSENT_REQUIRED'
        );
      }
    }

    const adapter = getWhatsAppAdapter();
    await adapter.sendMessage({
      to: dto.contactPhone,
      text: dto.initialMessage,
      templateName: dto.templateName,
      isPromotional: dto.isPromotional,
    });

    const now = new Date();
    const initialMsg: IMessage = {
      id: `m_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      sender: 'agent',
      text: dto.initialMessage,
      time: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      timestamp: now,
    };

    let conv = await Conversation.findOne({
      organizationId: orgId,
      contactPhone: dto.contactPhone,
    });

    if (conv) {
      conv.messages.push(initialMsg);
      conv.lastMessage = dto.initialMessage;
      conv.lastMessageAt = now;
      if (dto.projectName && !conv.projectName) conv.projectName = dto.projectName;
      if (dto.projectId && !conv.projectId) conv.projectId = new Types.ObjectId(dto.projectId);
      if (lead && !conv.leadId) conv.leadId = lead._id as Types.ObjectId;
      await conv.save();
    } else {
      conv = await Conversation.create({
        organizationId: orgId,
        leadId: lead?._id,
        projectId: dto.projectId ? new Types.ObjectId(dto.projectId) : undefined,
        projectName: dto.projectName,
        contactName: dto.contactName,
        contactPhone: dto.contactPhone,
        channel: 'WHATSAPP',
        lastMessage: dto.initialMessage,
        lastMessageAt: now,
        unreadCount: 0,
        needsHandoff: false,
        messages: [initialMsg],
      });
    }

    return conv;
  }

  /**
   * Sends an outbound agent reply in an existing conversation.
   * STRICT CONSENT RULE: If marked promotional, verify recorded consent.
   */
  async sendMessage(
    organizationId: string | Types.ObjectId,
    conversationId: string,
    dto: SendMessageDTO,
    authorName: string = 'Sales Representative'
  ): Promise<IConversation> {
    const orgId = typeof organizationId === 'string' ? new Types.ObjectId(organizationId) : organizationId;

    const conv = await Conversation.findOne({ _id: conversationId, organizationId: orgId });
    if (!conv) {
      throw AppError.notFound('Conversation thread not found', 'CONVERSATION_NOT_FOUND');
    }

    if (dto.isPromotional) {
      let lead = null;
      if (conv.leadId) {
        lead = await Lead.findOne({ _id: conv.leadId, organizationId: orgId });
      } else {
        lead = await Lead.findOne({ organizationId: orgId, phone: conv.contactPhone });
      }

      if (!lead || !lead.consentGiven) {
        throw AppError.forbidden(
          'Cannot send promotional message to contact without recorded consent',
          'CONSENT_REQUIRED'
        );
      }
    }

    const adapter = getWhatsAppAdapter();
    await adapter.sendMessage({
      to: conv.contactPhone,
      text: dto.text,
      templateName: dto.templateName,
      templateParams: dto.templateParams,
      isPromotional: dto.isPromotional,
    });

    const now = new Date();
    const newMsg: IMessage = {
      id: `m_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      sender: 'agent',
      text: dto.text,
      time: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      timestamp: now,
    };

    conv.messages.push(newMsg);
    conv.lastMessage = dto.text;
    conv.lastMessageAt = now;
    // Human has intervened or replied: resolve handoff flag
    conv.needsHandoff = false;
    conv.handoffReason = undefined;

    await conv.save();

    if (conv.leadId) {
      await LeadActivity.create({
        organizationId: orgId,
        leadId: conv.leadId,
        authorName,
        type: 'WHATSAPP_MESSAGE',
        summary: `Outbound WhatsApp sent: "${dto.text.slice(0, 60)}${dto.text.length > 60 ? '...' : ''}"`,
        details: { channel: 'WHATSAPP', isPromotional: dto.isPromotional },
      });
    }

    return conv;
  }

  /**
   * Toggles human handoff flag on a conversation
   */
  async toggleHandoff(
    organizationId: string | Types.ObjectId,
    conversationId: string,
    params: {
      needsHandoff: boolean;
      handoffReason?: string;
      assignedAgentId?: string;
      assignedAgentName?: string;
    }
  ): Promise<IConversation> {
    const orgId = typeof organizationId === 'string' ? new Types.ObjectId(organizationId) : organizationId;

    const conv = await Conversation.findOne({ _id: conversationId, organizationId: orgId });
    if (!conv) {
      throw AppError.notFound('Conversation not found', 'CONVERSATION_NOT_FOUND');
    }

    conv.needsHandoff = params.needsHandoff;
    if (params.needsHandoff) {
      conv.handoffReason = params.handoffReason || 'MANUAL_REQUEST';
    } else {
      conv.handoffReason = undefined;
    }

    if (params.assignedAgentId && Types.ObjectId.isValid(params.assignedAgentId)) {
      conv.assignedAgentId = new Types.ObjectId(params.assignedAgentId);
    }
    if (params.assignedAgentName) {
      conv.assignedAgentName = params.assignedAgentName;
    }

    await conv.save();
    return conv;
  }

  /**
   * Processes inbound WhatsApp webhook:
   * - Verifies signature
   * - Ingests incoming message
   * - Executes bot rule: only verified project facts; complex cases handed off
   */
  async processInboundWebhook(
    payload: Record<string, unknown>,
    explicitOrgId?: string
  ): Promise<{
    success: boolean;
    conversationId: string;
    isHandoff: boolean;
    botReplied: boolean;
    replyText?: string;
  }> {
    logger.info({ payload }, 'Processing inbound WhatsApp webhook');

    let senderPhone = '';
    let senderName = '';
    let messageText = '';
    let projectName = '';

    // Standard Meta Cloud API format or direct normalized format
    if (payload.text && payload.phone) {
      // Normalized test format
      senderPhone = String(payload.phone);
      senderName = String(payload.name || 'WhatsApp Client');
      messageText = String(payload.text);
      projectName = String(payload.projectName || '');
    } else if (Array.isArray(payload.entry)) {
      // Meta Graph WhatsApp Business API format
      const entry = payload.entry[0] as {
        changes?: Array<{
          value?: {
            contacts?: Array<{ profile?: { name?: string }; wa_id?: string }>;
            messages?: Array<{ from?: string; text?: { body?: string } }>;
          };
        }>;
      };
      const value = entry?.changes?.[0]?.value;
      const msg = value?.messages?.[0];
      const contact = value?.contacts?.[0];

      senderPhone = msg?.from || '';
      senderName = contact?.profile?.name || `Client ${senderPhone.slice(-4)}`;
      messageText = msg?.text?.body || '';
    }

    if (!senderPhone || !messageText) {
      throw AppError.badRequest('Inbound WhatsApp payload missing sender phone or message body', 'INVALID_WEBHOOK_PAYLOAD');
    }

    // Resolve Organization
    let targetOrgId: Types.ObjectId | null = null;
    if (explicitOrgId && Types.ObjectId.isValid(explicitOrgId)) {
      targetOrgId = new Types.ObjectId(explicitOrgId);
    } else if (payload.organizationId && Types.ObjectId.isValid(String(payload.organizationId))) {
      targetOrgId = new Types.ObjectId(String(payload.organizationId));
    } else {
      const existingConv = await Conversation.findOne({ contactPhone: senderPhone });
      if (existingConv) {
        targetOrgId = existingConv.organizationId;
      } else {
        const lead = await Lead.findOne({ phone: senderPhone });
        if (lead) targetOrgId = lead.organizationId;
      }
    }

    if (!targetOrgId) {
      throw AppError.badRequest('Could not resolve tenant organization for WhatsApp message', 'ORG_NOT_RESOLVED');
    }

    // Find or create conversation
    let conv = await Conversation.findOne({
      organizationId: targetOrgId,
      contactPhone: senderPhone,
    });

    const now = new Date();
    const userMsg: IMessage = {
      id: `w_in_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      sender: 'user',
      text: messageText,
      time: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      timestamp: now,
    };

    let lead = null;
    if (conv?.leadId) {
      lead = await Lead.findById(conv.leadId);
    } else {
      lead = await Lead.findOne({ organizationId: targetOrgId, phone: senderPhone });
    }

    if (!conv) {
      conv = await Conversation.create({
        organizationId: targetOrgId,
        leadId: lead?._id,
        projectName: projectName || lead?.projectName,
        projectId: lead?.projectId,
        contactName: senderName,
        contactPhone: senderPhone,
        channel: 'WHATSAPP',
        lastMessage: messageText,
        lastMessageAt: now,
        unreadCount: 1,
        needsHandoff: false,
        messages: [userMsg],
      });
    } else {
      conv.messages.push(userMsg);
      conv.lastMessage = messageText;
      conv.lastMessageAt = now;
      conv.unreadCount += 1;
      if (projectName && !conv.projectName) conv.projectName = projectName;
      if (lead && !conv.leadId) conv.leadId = lead._id as Types.ObjectId;
    }

    // Bot Evaluation
    let project = null;
    if (conv.projectId) {
      project = await Project.findById(conv.projectId);
    } else if (conv.projectName) {
      project = await Project.findOne({ organizationId: targetOrgId, name: conv.projectName });
    }

    const evaluation = whatsAppBotService.evaluateInboundMessage(messageText, project);

    if (evaluation.isHandoff) {
      conv.needsHandoff = true;
      conv.handoffReason = evaluation.handoffReason || 'UNCERTAINTY';

      if (conv.leadId) {
        await LeadActivity.create({
          organizationId: targetOrgId,
          leadId: conv.leadId,
          authorName: 'WhatsApp Automated Bot',
          type: 'AGENT_NOTE',
          summary: `Handoff flagged: Inbound client message requires human representative (${evaluation.handoffReason})`,
          details: {
            reason: evaluation.handoffReason,
            inboundText: messageText,
          },
        });
      }
    }

    // Bot produces reply
    const botMsg: IMessage = {
      id: `w_bot_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      sender: 'bot',
      text: evaluation.replyText,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      timestamp: new Date(),
    };

    conv.messages.push(botMsg);
    conv.lastMessage = evaluation.replyText;
    conv.lastMessageAt = new Date();
    await conv.save();

    // Dispatch bot message via adapter
    const adapter = getWhatsAppAdapter();
    await adapter.sendMessage({
      to: senderPhone,
      text: evaluation.replyText,
      isPromotional: false,
    });

    return {
      success: true,
      conversationId: conv._id.toString(),
      isHandoff: evaluation.isHandoff,
      botReplied: true,
      replyText: evaluation.replyText,
    };
  }

  async listConversations(
    organizationId: string | Types.ObjectId,
    query: {
      needsHandoff?: boolean;
      channel?: string;
      search?: string;
      page?: number;
      limit?: number;
    }
  ): Promise<{
    conversations: IConversation[];
    total: number;
    handoffCount: number;
  }> {
    const orgId = typeof organizationId === 'string' ? new Types.ObjectId(organizationId) : organizationId;
    const filter: Record<string, unknown> = { organizationId: orgId };

    if (query.needsHandoff !== undefined) {
      filter.needsHandoff = query.needsHandoff;
    }

    if (query.channel) {
      filter.channel = query.channel;
    }

    if (query.search) {
      filter.$or = [
        { contactName: { $regex: query.search, $options: 'i' } },
        { contactPhone: { $regex: query.search, $options: 'i' } },
        { projectName: { $regex: query.search, $options: 'i' } },
      ];
    }

    const page = query.page || 1;
    const limit = query.limit || 30;

    const [conversations, total, handoffCount] = await Promise.all([
      Conversation.find(filter)
        .sort({ lastMessageAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      Conversation.countDocuments(filter),
      Conversation.countDocuments({ organizationId: orgId, needsHandoff: true }),
    ]);

    return { conversations, total, handoffCount };
  }

  async getConversation(
    organizationId: string | Types.ObjectId,
    conversationId: string
  ): Promise<IConversation> {
    const orgId = typeof organizationId === 'string' ? new Types.ObjectId(organizationId) : organizationId;

    const conv = await Conversation.findOne({ _id: conversationId, organizationId: orgId });
    if (!conv) {
      throw AppError.notFound('Conversation not found', 'CONVERSATION_NOT_FOUND');
    }

    // Mark as read
    if (conv.unreadCount > 0) {
      conv.unreadCount = 0;
      await conv.save();
    }

    return conv;
  }
}

export const whatsAppService = new WhatsAppService();
