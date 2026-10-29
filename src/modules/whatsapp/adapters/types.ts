export interface SendWhatsAppMessageParams {
  to: string;
  text?: string;
  templateName?: string;
  templateParams?: Record<string, string>;
  isPromotional?: boolean;
}

export interface WhatsAppMessageResult {
  success: boolean;
  messageId: string;
  status: 'sent' | 'delivered' | 'failed';
  to: string;
  timestamp: string;
}

export interface IWhatsAppAdapter {
  sendMessage(params: SendWhatsAppMessageParams): Promise<WhatsAppMessageResult>;
  verifyWebhookSignature(
    rawBody: string | Buffer,
    signatureHeader?: string,
    secret?: string
  ): boolean;
}
