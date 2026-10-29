import { Router } from 'express';
import { appointmentController } from './appointmentController.js';
import { authenticate } from '../../middleware/authenticate.js';
import { resolveTenant } from '../../middleware/resolveTenant.js';
import { authorize } from '../../middleware/authorize.js';

export const appointmentRouter = Router();

appointmentRouter.use(authenticate);
appointmentRouter.use(resolveTenant);

// List appointments
appointmentRouter.get(
  '/',
  authorize('leads:read'),
  appointmentController.list
);

// Get available slots
appointmentRouter.get(
  '/availability',
  authorize('leads:read'),
  appointmentController.getAvailability
);

// Book appointment
appointmentRouter.post(
  '/',
  authorize('leads:write'),
  appointmentController.create
);

// Update status
appointmentRouter.patch(
  '/:id',
  authorize('leads:write'),
  appointmentController.update
);

// Submit feedback & complete walkthrough
appointmentRouter.patch(
  '/:id/feedback',
  authorize('leads:write'),
  appointmentController.submitFeedback
);
