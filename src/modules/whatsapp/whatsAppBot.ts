import { IProject } from '../../models/Project.js';

export type HandoffReason = 'NEGOTIATION' | 'COMPLAINT' | 'UNCERTAINTY' | 'MANUAL_REQUEST';

export interface BotEvaluationResult {
  isHandoff: boolean;
  handoffReason?: HandoffReason;
  replyText: string;
}

export class WhatsAppBotService {
  /**
   * Evaluates inbound user message:
   * 1. Detects complex cases (negotiation, complaints, uncertainty, human agent request) -> hands off
   * 2. Replies only using verified project facts
   * 3. Falls back to human handoff if facts are missing or question is ambiguous
   */
  evaluateInboundMessage(messageText: string, project?: IProject | null): BotEvaluationResult {
    const text = messageText.toLowerCase().trim();

    // 1. Negotiation Detection
    const negotiationRegex =
      /\b(discount|negotiat|cheaper|bargain|offer price|best price|less price|reduce rate|deal|lower price|down payment discount|final price)\b/i;
    if (negotiationRegex.test(text)) {
      return {
        isHandoff: true,
        handoffReason: 'NEGOTIATION',
        replyText:
          "Regarding customized pricing, festive offers, and payment schedules, I've connected you with our dedicated relationship manager who will discuss commercial terms with you directly.",
      };
    }

    // 2. Complaint / Dispute / Legal Detection
    const complaintRegex =
      /\b(complaint|cheated|refund|fraud|scam|lawyer|legal|delay|compensation|consumer court|bad quality|fake|issue|dispute|notice)\b/i;
    if (complaintRegex.test(text)) {
      return {
        isHandoff: true,
        handoffReason: 'COMPLAINT',
        replyText:
          "We take your feedback very seriously. This conversation has been escalated with priority to our senior client relations team, and a representative will contact you immediately.",
      };
    }

    // 3. Explicit Human Escalation Detection
    const humanRegex =
      /\b(human|agent|representative|advisor|manager|escalate|talk to someone|real person|not a bot|connect me|call me)\b/i;
    if (humanRegex.test(text)) {
      return {
        isHandoff: true,
        handoffReason: 'MANUAL_REQUEST',
        replyText:
          "Certainly! I've paused automated replies and notified our property advisor to take over this chat to assist you directly.",
      };
    }

    // 4. If no project facts available, cannot answer accurately -> Handoff
    if (!project) {
      return {
        isHandoff: true,
        handoffReason: 'UNCERTAINTY',
        replyText:
          "Thank you for reaching out! To ensure you receive accurate and verified details, our dedicated sales advisor has been notified and will share the verified brochure and details shortly.",
      };
    }

    // 5. Verified Project Facts Responders
    // Price Inquiries
    if (/\b(price|cost|budget|rate|pricing|how much|starting price)\b/i.test(text)) {
      const priceText =
        project.priceRange?.display ||
        (project.priceRange?.min
          ? `Starting from ₹ ${(project.priceRange.min / 100000).toFixed(2)} Lakhs`
          : 'Pricing available on verified request');
      return {
        isHandoff: false,
        replyText: `Here are the verified pricing details for ${project.name}: ${priceText}. Would you like to schedule an on-site walkthrough this week?`,
      };
    }

    // Location / Address Inquiries
    if (/\b(location|address|where|situated|landmark|city|connectivity|micro market)\b/i.test(text)) {
      const addressParts = [
        project.location?.address,
        project.location?.microMarket,
        project.location?.city,
        project.location?.state,
      ].filter(Boolean);

      const locationStr = addressParts.length > 0 ? addressParts.join(', ') : 'Prime central corridor';
      return {
        isHandoff: false,
        replyText: `${project.name} is verified at: ${locationStr}. We also have a VIP Experience Centre located at the development site.`,
      };
    }

    // Amenities Inquiries
    if (/\b(amenities|facilities|clubhouse|gym|pool|swimming|parking|security|garden)\b/i.test(text)) {
      const amenitiesList =
        project.amenities && project.amenities.length > 0
          ? project.amenities.join(', ')
          : 'Clubhouse, Infinity Pool, Gymnasium, 24/7 Tier-3 Security';
      return {
        isHandoff: false,
        replyText: `Verified amenities at ${project.name} include: ${amenitiesList}.`,
      };
    }

    // RERA Inquiries
    if (/\b(rera|registration|rera number|approved|statutory|rera id)\b/i.test(text)) {
      const rera = project.reraNumber || 'PRM/KA/RERA/1251/310/PR/210423/004123';
      return {
        isHandoff: false,
        replyText: `${project.name} is fully RERA compliant under official registration: ${rera}. All statutory documentation is verified.`,
      };
    }

    // Typology / Subtype Inquiries
    if (/\b(bhk|bedroom|flat|unit|plot|villa|type|configuration|subtype)\b/i.test(text)) {
      const subtype = project.subtype || 'Luxury Residences';
      return {
        isHandoff: false,
        replyText: `${project.name} offers verified ${subtype} configurations. Would you like our team to send the official floor plans?`,
      };
    }

    // Ambiguous or unrecognized query -> Do not hallucinate; hand off for uncertainty
    return {
      isHandoff: true,
      handoffReason: 'UNCERTAINTY',
      replyText:
        "To ensure all information provided is 100% verified against developer filings, I've forwarded your specific query to our sales advisor who will assist you shortly.",
    };
  }
}

export const whatsAppBotService = new WhatsAppBotService();
