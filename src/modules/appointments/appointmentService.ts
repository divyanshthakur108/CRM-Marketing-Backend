import { Types } from 'mongoose';
import { Appointment, IAppointment, AppointmentStatus } from '../../models/Appointment.js';
import { Lead } from '../../models/Lead.js';
import { LeadActivity } from '../../models/LeadActivity.js';
import { Job } from '../../models/Job.js';
import { standardTimeSlots } from './appointmentValidation.js';
import { AppError } from '../../utils/AppError.js';
import { logger } from '../../config/logger.js';

export interface CreateAppointmentDTO {
  leadId?: string;
  projectId?: string;
  leadName: string;
  leadPhone: string;
  projectName: string;
  appointmentDate: string;
  timeSlot: string;
  assignedAgentId?: string;
  assignedAgentName?: string;
  notes?: string;
}

export interface AppointmentFeedbackDTO {
  feedbackRating: number;
  feedbackNotes: string;
  interestLevel: 'HIGH' | 'MEDIUM' | 'LOW';
  nextAction: string;
  nextActionDate?: string;
}

export class AppointmentService {
  /**
   * Retrieves agent and experience center availability for a given date
   */
  async getAvailability(
    organizationId: string | Types.ObjectId,
    dateStr: string,
    agentId?: string
  ): Promise<Array<{ timeSlot: string; isAvailable: boolean; bookedCount: number }>> {
    const orgId = typeof organizationId === 'string' ? new Types.ObjectId(organizationId) : organizationId;

    const targetDate = new Date(dateStr);
    const startOfDay = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate(), 0, 0, 0);
    const endOfDay = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate(), 23, 59, 59);

    const filter: Record<string, unknown> = {
      organizationId: orgId,
      appointmentDate: { $gte: startOfDay, $lte: endOfDay },
      status: 'Scheduled',
    };

    if (agentId && Types.ObjectId.isValid(agentId)) {
      filter.assignedAgentId = new Types.ObjectId(agentId);
    }

    const bookedAppointments = await Appointment.find(filter);

    const bookedMap: Record<string, number> = {};
    for (const app of bookedAppointments) {
      bookedMap[app.timeSlot] = (bookedMap[app.timeSlot] || 0) + 1;
    }

    return standardTimeSlots.map((slot) => {
      const bookedCount = bookedMap[slot] || 0;
      // If agent is specified, 1 booking = unavailable; otherwise 2 simultaneous visits per slot allowed
      const isAvailable = agentId ? bookedCount === 0 : bookedCount < 2;
      return {
        timeSlot: slot,
        isAvailable,
        bookedCount,
      };
    });
  }

  /**
   * Books a site visit walkthrough appointment.
   * STRICT COLLISION RULE: Rejects conflicting slots with 409 Conflict.
   */
  async bookAppointment(
    organizationId: string | Types.ObjectId,
    dto: CreateAppointmentDTO
  ): Promise<IAppointment> {
    const orgId = typeof organizationId === 'string' ? new Types.ObjectId(organizationId) : organizationId;

    const appointmentDate = new Date(dto.appointmentDate);
    const startOfDay = new Date(
      appointmentDate.getFullYear(),
      appointmentDate.getMonth(),
      appointmentDate.getDate(),
      0,
      0,
      0
    );
    const endOfDay = new Date(
      appointmentDate.getFullYear(),
      appointmentDate.getMonth(),
      appointmentDate.getDate(),
      23,
      59,
      59
    );

    // Collision Check: Check for duplicate booking in same slot
    const collisionQuery: Record<string, unknown> = {
      organizationId: orgId,
      appointmentDate: { $gte: startOfDay, $lte: endOfDay },
      timeSlot: dto.timeSlot,
      status: 'Scheduled',
    };

    if (dto.assignedAgentId && Types.ObjectId.isValid(dto.assignedAgentId)) {
      collisionQuery.assignedAgentId = new Types.ObjectId(dto.assignedAgentId);
    }

    const existingCollision = await Appointment.findOne(collisionQuery);
    if (existingCollision) {
      throw AppError.conflict(
        `The time slot "${dto.timeSlot}" is already booked for this date and agent. Please choose another slot.`,
        'SLOT_UNAVAILABLE'
      );
    }

    const gatePassCode = `VIP-${Math.floor(1000 + Math.random() * 9000)}`;

    const newAppointment = await Appointment.create({
      organizationId: orgId,
      leadId: dto.leadId && Types.ObjectId.isValid(dto.leadId) ? new Types.ObjectId(dto.leadId) : undefined,
      projectId: dto.projectId && Types.ObjectId.isValid(dto.projectId) ? new Types.ObjectId(dto.projectId) : undefined,
      leadName: dto.leadName,
      leadPhone: dto.leadPhone,
      projectName: dto.projectName,
      appointmentDate,
      timeSlot: dto.timeSlot,
      status: 'Scheduled',
      assignedAgentId:
        dto.assignedAgentId && Types.ObjectId.isValid(dto.assignedAgentId)
          ? new Types.ObjectId(dto.assignedAgentId)
          : undefined,
      assignedAgentName: dto.assignedAgentName || 'Assigned Property Host',
      gatePassCode,
      notes: dto.notes,
    });

    // Enqueue automated reminder job in `Job` collection
    const reminderDate = new Date(appointmentDate.getTime() - 2 * 60 * 60 * 1000); // 2 hours prior
    try {
      const reminderJob = await Job.create({
        organizationId: orgId,
        idempotencyKey: `appointment-reminder-${newAppointment._id}`,
        queueName: 'reminders',
        jobType: 'APPOINTMENT_REMINDER',
        status: 'PENDING',
        payload: {
          appointmentId: newAppointment._id.toString(),
          leadName: newAppointment.leadName,
          leadPhone: newAppointment.leadPhone,
          projectName: newAppointment.projectName,
          timeSlot: newAppointment.timeSlot,
          gatePassCode,
        },
        nextRunAt: reminderDate > new Date() ? reminderDate : new Date(),
      });

      newAppointment.reminderJobId = reminderJob._id as Types.ObjectId;
      await newAppointment.save();
    } catch (jobErr) {
      logger.warn({ jobErr, appointmentId: newAppointment._id }, 'Could not enqueue reminder job');
    }

    // Update associated lead stage to 'Visit scheduled' and log timeline activity
    if (newAppointment.leadId) {
      const lead = await Lead.findOne({ _id: newAppointment.leadId, organizationId: orgId });
      if (lead) {
        if (lead.stage === 'New' || lead.stage === 'Contacted' || lead.stage === 'Qualified') {
          lead.stage = 'Visit scheduled';
          await lead.save();
        }

        await LeadActivity.create({
          organizationId: orgId,
          leadId: lead._id,
          authorName: dto.assignedAgentName || 'Experience Center Concierge',
          type: 'SITE_VISIT_BOOKED',
          summary: `VIP Walkthrough scheduled for ${dto.timeSlot} on ${appointmentDate.toLocaleDateString('en-IN')} (Gate Pass: ${gatePassCode})`,
          details: {
            appointmentId: newAppointment._id,
            timeSlot: dto.timeSlot,
            gatePassCode,
          },
        });
      }
    }

    return newAppointment;
  }

  /**
   * Logs visitor walkthrough feedback, completes the appointment,
   * advances lead to 'Visit done', and generates next sales task.
   * NOTE: Sale completion stays a manual human step.
   */
  async submitFeedback(
    organizationId: string | Types.ObjectId,
    appointmentId: string,
    dto: AppointmentFeedbackDTO
  ): Promise<IAppointment> {
    const orgId = typeof organizationId === 'string' ? new Types.ObjectId(organizationId) : organizationId;

    const appointment = await Appointment.findOne({ _id: appointmentId, organizationId: orgId });
    if (!appointment) {
      throw AppError.notFound('Appointment not found', 'APPOINTMENT_NOT_FOUND');
    }

    appointment.status = 'Completed';
    appointment.feedbackRating = dto.feedbackRating;
    appointment.feedbackNotes = dto.feedbackNotes;
    appointment.interestLevel = dto.interestLevel;
    appointment.nextAction = dto.nextAction;
    if (dto.nextActionDate) {
      appointment.nextActionDate = new Date(dto.nextActionDate);
    }
    await appointment.save();

    // Advance associated lead to 'Visit done' and record next action
    if (appointment.leadId) {
      const lead = await Lead.findOne({ _id: appointment.leadId, organizationId: orgId });
      if (lead) {
        if (lead.stage === 'Visit scheduled') {
          lead.stage = 'Visit done';
          await lead.save();
        }

        await LeadActivity.create({
          organizationId: orgId,
          leadId: lead._id,
          authorName: appointment.assignedAgentName || 'Property Host',
          type: 'STAGE_PROGRESSION',
          summary: `Walkthrough Completed (${dto.feedbackRating}/5 stars, ${dto.interestLevel} intent). Next Task: ${dto.nextAction}`,
          details: {
            rating: dto.feedbackRating,
            feedback: dto.feedbackNotes,
            interestLevel: dto.interestLevel,
            nextAction: dto.nextAction,
            nextActionDate: dto.nextActionDate,
          },
        });
      }
    }

    return appointment;
  }

  async listAppointments(
    organizationId: string | Types.ObjectId,
    query: {
      status?: AppointmentStatus;
      assignedAgentId?: string;
      projectId?: string;
      date?: string;
      search?: string;
      page?: number;
      limit?: number;
    }
  ): Promise<{
    appointments: IAppointment[];
    total: number;
    scheduledCount: number;
  }> {
    const orgId = typeof organizationId === 'string' ? new Types.ObjectId(organizationId) : organizationId;
    const filter: Record<string, unknown> = { organizationId: orgId };

    if (query.status) {
      filter.status = query.status;
    }

    if (query.assignedAgentId && Types.ObjectId.isValid(query.assignedAgentId)) {
      filter.assignedAgentId = new Types.ObjectId(query.assignedAgentId);
    }

    if (query.projectId && Types.ObjectId.isValid(query.projectId)) {
      filter.projectId = new Types.ObjectId(query.projectId);
    }

    if (query.date) {
      const d = new Date(query.date);
      const startOfDay = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0);
      const endOfDay = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59);
      filter.appointmentDate = { $gte: startOfDay, $lte: endOfDay };
    }

    if (query.search) {
      filter.$or = [
        { leadName: { $regex: query.search, $options: 'i' } },
        { leadPhone: { $regex: query.search, $options: 'i' } },
        { projectName: { $regex: query.search, $options: 'i' } },
        { gatePassCode: { $regex: query.search, $options: 'i' } },
      ];
    }

    const page = query.page || 1;
    const limit = query.limit || 30;

    const [appointments, total, scheduledCount] = await Promise.all([
      Appointment.find(filter)
        .sort({ appointmentDate: 1, timeSlot: 1 })
        .skip((page - 1) * limit)
        .limit(limit),
      Appointment.countDocuments(filter),
      Appointment.countDocuments({ organizationId: orgId, status: 'Scheduled' }),
    ]);

    return { appointments, total, scheduledCount };
  }

  async updateAppointment(
    organizationId: string | Types.ObjectId,
    id: string,
    updates: {
      status?: AppointmentStatus;
      assignedAgentId?: string;
      assignedAgentName?: string;
      notes?: string;
    }
  ): Promise<IAppointment> {
    const orgId = typeof organizationId === 'string' ? new Types.ObjectId(organizationId) : organizationId;

    const appointment = await Appointment.findOne({ _id: id, organizationId: orgId });
    if (!appointment) {
      throw AppError.notFound('Appointment not found', 'APPOINTMENT_NOT_FOUND');
    }

    if (updates.status) appointment.status = updates.status;
    if (updates.notes !== undefined) appointment.notes = updates.notes;
    if (updates.assignedAgentId && Types.ObjectId.isValid(updates.assignedAgentId)) {
      appointment.assignedAgentId = new Types.ObjectId(updates.assignedAgentId);
    }
    if (updates.assignedAgentName) appointment.assignedAgentName = updates.assignedAgentName;

    await appointment.save();
    return appointment;
  }
}

export const appointmentService = new AppointmentService();
