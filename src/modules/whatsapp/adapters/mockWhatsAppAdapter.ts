import crypto from 'crypto';
import { IWhatsAppAdapter, SendWhatsAppMessageParams, WhatsAppMessageResult } from './types.js';
import { logger } from '../../../config/logger.js';

export class MockWhatsAppAdapter implements IWhatsAppAdapter {
  private messageCounter = 1000;

  async sendMessage(params: SendWhatsAppMessageParams): Promise<WhatsAppMessageResult> {
    this.messageCounter += 1;
    const messageId = `wamid.HBgM${Date.now()}MockWA${this.messageCounter}`;

    logger.info(
      {
        to: params.to,
        messageId,
        template: params.templateName,
        textPreview: params.text?.slice(0, 40),
        isPromotional: params.isPromotional,
      },
      '[MOCK WHATSAPP] Outbound message simulated successfully (no real network dispatch)'
    );

    return {
      success: true,
      messageId,
      status: 'delivered',
      to: params.to,
      timestamp: new Date().toISOString(),
    };
  }

  verifyWebhookSignature(
    rawBody: string | Buffer,
    signatureHeader?: string,
    secret?: string
  ): boolean {
    const appSecret =
      secret || process.env.META_APP_SECRET || 'realcrm_meta_webhook_secret_2026';

    if (!signatureHeader) {
      if (process.env.NODE_ENV === 'test' || process.env.WHATSAPP_ADAPTER === 'mock') {
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
      return crypto.timingSafeEqual(
        Buffer.from(signature, 'hex'),
        Buffer.from(digest, 'hex')
      );
    } catch {
      return false;
    }
  }
}

export const mockWhatsAppAdapter = new MockWhatsAppAdapter();
