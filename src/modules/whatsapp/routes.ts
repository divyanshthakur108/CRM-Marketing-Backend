import { Router } from 'express';
import { whatsAppController } from './whatsAppController.js';
import { authenticate } from '../../middleware/authenticate.js';
import { resolveTenant } from '../../middleware/resolveTenant.js';
import { authorize } from '../../middleware/authorize.js';

export const whatsAppRouter = Router();

whatsAppRouter.use(authenticate);
whatsAppRouter.use(resolveTenant);

// List threads
whatsAppRouter.get(
  '/',
  authorize('leads:read'),
  whatsAppController.list
);

// Get single thread
whatsAppRouter.get(
  '/:id',
  authorize('leads:read'),
  whatsAppController.get
);

// Start conversation (strictly validates consent if promotional)
whatsAppRouter.post(
  '/',
  authorize('leads:write'),
  whatsAppController.start
);

// Send message
whatsAppRouter.post(
  '/:id/messages',
  authorize('leads:write'),
  whatsAppController.sendMessage
);

// Toggle handoff flag
whatsAppRouter.patch(
  '/:id/handoff',
  authorize('leads:write'),
  whatsAppController.toggleHandoff
);
