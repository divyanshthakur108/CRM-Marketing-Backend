import { Request, Response } from 'express';
import { appointmentService } from './appointmentService.js';
import {
  createAppointmentSchema,
  updateAppointmentSchema,
  appointmentFeedbackSchema,
  appointmentQuerySchema,
} from './appointmentValidation.js';
import { sendSuccess } from '../../utils/response.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { AppError } from '../../utils/AppError.js';

export class AppointmentController {
  list = asyncHandler(async (req: Request, res: Response) => {
    const orgId = req.user?.organizationId;
    if (!orgId) throw AppError.unauthorized('Missing tenant organization context');

    const query = appointmentQuerySchema.parse(req.query);
    const result = await appointmentService.listAppointments(orgId, query);
    sendSuccess(res, result, 200);
  });

  getAvailability = asyncHandler(async (req: Request, res: Response) => {
    const orgId = req.user?.organizationId;
    if (!orgId) throw AppError.unauthorized('Missing tenant organization context');

    const date = (req.query.date as string) || new Date().toISOString().split('T')[0];
    const agentId = req.query.agentId as string | undefined;

    const slots = await appointmentService.getAvailability(orgId, date, agentId);
    sendSuccess(res, slots, 200);
  });

  create = asyncHandler(async (req: Request, res: Response) => {
    const orgId = req.user?.organizationId;
    if (!orgId) throw AppError.unauthorized('Missing tenant organization context');

    const dto = createAppointmentSchema.parse(req.body);
    const appointment = await appointmentService.bookAppointment(orgId, dto);

    sendSuccess(res, appointment, 201, { message: 'Site visit booked successfully' });
  });

  update = asyncHandler(async (req: Request, res: Response) => {
    const orgId = req.user?.organizationId;
    if (!orgId) throw AppError.unauthorized('Missing tenant organization context');

    const dto = updateAppointmentSchema.parse(req.body);
    const updated = await appointmentService.updateAppointment(orgId, req.params.id, dto);

    sendSuccess(res, updated, 200, { message: 'Appointment updated successfully' });
  });

  submitFeedback = asyncHandler(async (req: Request, res: Response) => {
    const orgId = req.user?.organizationId;
    if (!orgId) throw AppError.unauthorized('Missing tenant organization context');

    const dto = appointmentFeedbackSchema.parse(req.body);
    const completed = await appointmentService.submitFeedback(orgId, req.params.id, dto);

    sendSuccess(res, completed, 200, {
      message: 'Walkthrough feedback recorded, visit marked completed, and next sales task created',
    });
  });
}

export const appointmentController = new AppointmentController();
