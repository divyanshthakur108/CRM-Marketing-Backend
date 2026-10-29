import { z } from 'zod';

export const standardTimeSlots = [
  '10:00 AM - 11:00 AM',
  '11:30 AM - 12:30 PM',
  '02:00 PM - 03:00 PM',
  '03:30 PM - 04:30 PM',
  '05:00 PM - 06:00 PM',
] as const;

export const createAppointmentSchema = z.object({
  leadId: z.string().optional(),
  projectId: z.string().optional(),
  leadName: z.string().min(2, 'Client name is required').trim(),
  leadPhone: z.string().min(7, 'Client phone number is required').trim(),
  projectName: z.string().min(2, 'Development project is required').trim(),
  appointmentDate: z.string().refine((val) => !isNaN(Date.parse(val)), {
    message: 'Valid appointment date is required',
  }),
  timeSlot: z.string().min(3, 'Time slot is required'),
  assignedAgentId: z.string().optional(),
  assignedAgentName: z.string().optional(),
  notes: z.string().optional(),
});

export const updateAppointmentSchema = z.object({
  status: z.enum(['Scheduled', 'Completed', 'Cancelled', 'No-Show']).optional(),
  assignedAgentId: z.string().optional(),
  assignedAgentName: z.string().optional(),
  notes: z.string().optional(),
});

export const appointmentFeedbackSchema = z.object({
  feedbackRating: z.number().int().min(1).max(5),
  feedbackNotes: z.string().min(2, 'Feedback notes are required'),
  interestLevel: z.enum(['HIGH', 'MEDIUM', 'LOW']),
  nextAction: z.string().min(2, 'Next sales action is required'),
  nextActionDate: z
    .string()
    .refine((val) => !isNaN(Date.parse(val)), {
      message: 'Valid next action date is required',
    })
    .optional(),
});

export const appointmentQuerySchema = z.object({
  status: z.enum(['Scheduled', 'Completed', 'Cancelled', 'No-Show']).optional(),
  assignedAgentId: z.string().optional(),
  projectId: z.string().optional(),
  date: z.string().optional(),
  search: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(30),
});
