import { Request, Response } from 'express';
import { whatsAppService } from './whatsAppService.js';
import {
  startConversationSchema,
  sendMessageSchema,
  handoffToggleSchema,
  conversationQuerySchema,
} from './whatsAppValidation.js';
import { sendSuccess } from '../../utils/response.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { AppError } from '../../utils/AppError.js';

export class WhatsAppController {
  list = asyncHandler(async (req: Request, res: Response) => {
    const orgId = req.user?.organizationId;
    if (!orgId) throw AppError.unauthorized('Missing tenant organization context');

    const query = conversationQuerySchema.parse(req.query);
    const result = await whatsAppService.listConversations(orgId, query);

    sendSuccess(res, result, 200);
  });

  get = asyncHandler(async (req: Request, res: Response) => {
    const orgId = req.user?.organizationId;
    if (!orgId) throw AppError.unauthorized('Missing tenant organization context');

    const conversation = await whatsAppService.getConversation(orgId, req.params.id);
    sendSuccess(res, conversation, 200);
  });

  start = asyncHandler(async (req: Request, res: Response) => {
    const orgId = req.user?.organizationId;
    if (!orgId) throw AppError.unauthorized('Missing tenant organization context');

    const dto = startConversationSchema.parse(req.body);
    const conversation = await whatsAppService.startConversation(orgId, dto);

    sendSuccess(res, conversation, 201, { message: 'WhatsApp conversation initiated' });
  });

  sendMessage = asyncHandler(async (req: Request, res: Response) => {
    const orgId = req.user?.organizationId;
    if (!orgId) throw AppError.unauthorized('Missing tenant organization context');

    const dto = sendMessageSchema.parse(req.body);
    const authorName = req.user?.email || 'Sales Representative';

    const conversation = await whatsAppService.sendMessage(orgId, req.params.id, dto, authorName);
    sendSuccess(res, conversation, 200, { message: 'Message sent successfully' });
  });

  toggleHandoff = asyncHandler(async (req: Request, res: Response) => {
    const orgId = req.user?.organizationId;
    if (!orgId) throw AppError.unauthorized('Missing tenant organization context');

    const dto = handoffToggleSchema.parse(req.body);
    const conversation = await whatsAppService.toggleHandoff(orgId, req.params.id, dto);

    sendSuccess(res, conversation, 200, {
      message: dto.needsHandoff ? 'Handoff flag enabled' : 'Handoff resolved by human agent',
    });
  });
}

export const whatsAppController = new WhatsAppController();
