import { Router, Request, Response } from 'express';
import { metaWebhookService } from './metaWebhookService.js';
import { sendSuccess } from '../../utils/response.js';
import { AppError } from '../../utils/AppError.js';
import { asyncHandler } from '../../utils/asyncHandler.js';

export const webhooksRouter = Router();

/**
 * Meta Webhook Verification Handshake (GET)
 */
webhooksRouter.get('/meta-leads', (req: Request, res: Response) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  const verifyToken = process.env.META_WEBHOOK_VERIFY_TOKEN || 'realcrm_webhook_verify_token_2026';

  if (mode === 'subscribe' && token === verifyToken) {
    res.status(200).send(challenge);
    return;
  }

  res.status(403).json({ error: 'Webhook verification token mismatch' });
});

/**
 * Meta Webhook Inbound Lead Receiver (POST)
 */
webhooksRouter.post(
  '/meta-leads',
  asyncHandler(async (req: Request, res: Response) => {
    const signature = req.headers['x-hub-signature-256'] as string | undefined;

    // Verify signature
    const isValid = metaWebhookService.verifySignature(JSON.stringify(req.body), signature);
    if (!isValid) {
      throw AppError.forbidden('Invalid Meta webhook signature', 'INVALID_SIGNATURE');
    }

    const result = await metaWebhookService.processLeadWebhook(req.body);
    sendSuccess(res, result, 200, { message: result.message });
  })
);

/**
 * WhatsApp Webhook Verification Handshake (GET)
 */
webhooksRouter.get('/whatsapp', (req: Request, res: Response) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  const verifyToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || process.env.META_WEBHOOK_VERIFY_TOKEN || 'realcrm_webhook_verify_token_2026';

  if (mode === 'subscribe' && token === verifyToken) {
    res.status(200).send(challenge);
    return;
  }

  res.status(403).json({ error: 'WhatsApp webhook verification token mismatch' });
});

/**
 * WhatsApp Inbound Message Receiver (POST)
 */
webhooksRouter.post(
  '/whatsapp',
  asyncHandler(async (req: Request, res: Response) => {
    const signature = req.headers['x-hub-signature-256'] as string | undefined;

    // Verify signature using WhatsApp adapter
    const adapter = (await import('../whatsapp/adapters/index.js')).getWhatsAppAdapter();
    const isValid = adapter.verifyWebhookSignature(JSON.stringify(req.body), signature);
    if (!isValid) {
      throw AppError.forbidden('Invalid WhatsApp webhook signature', 'INVALID_SIGNATURE');
    }

    const { whatsAppService } = await import('../whatsapp/whatsAppService.js');
    const result = await whatsAppService.processInboundWebhook(req.body);
    sendSuccess(res, result, 200, { message: 'WhatsApp message processed' });
  })
);

