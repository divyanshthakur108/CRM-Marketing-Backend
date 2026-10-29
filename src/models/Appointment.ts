import { Schema, model, Document, Types } from 'mongoose';

export type AppointmentStatus = 'Scheduled' | 'Completed' | 'Cancelled' | 'No-Show';

export interface IAppointment extends Document {
  organizationId: Types.ObjectId;
  leadId?: Types.ObjectId;
  projectId?: Types.ObjectId;
  leadName: string;
  leadPhone: string;
  projectName: string;
  appointmentDate: Date;
  timeSlot: string;
  status: AppointmentStatus;
  assignedAgentId?: Types.ObjectId;
  assignedAgentName?: string;
  gatePassCode?: string;
  notes?: string;
  feedbackRating?: number;
  feedbackNotes?: string;
  interestLevel?: 'HIGH' | 'MEDIUM' | 'LOW';
  nextAction?: string;
  nextActionDate?: Date;
  reminderJobId?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const appointmentSchema = new Schema<IAppointment>(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true,
    },
    leadId: {
      type: Schema.Types.ObjectId,
      ref: 'Lead',
      index: true,
    },
    projectId: {
      type: Schema.Types.ObjectId,
      ref: 'Project',
      index: true,
    },
    leadName: {
      type: String,
      required: true,
      trim: true,
    },
    leadPhone: {
      type: String,
      required: true,
      trim: true,
    },
    projectName: {
      type: String,
      required: true,
    },
    appointmentDate: {
      type: Date,
      required: true,
      index: true,
    },
    timeSlot: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      enum: ['Scheduled', 'Completed', 'Cancelled', 'No-Show'],
      default: 'Scheduled',
      index: true,
    },
    assignedAgentId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
    assignedAgentName: {
      type: String,
    },
    gatePassCode: {
      type: String,
    },
    notes: {
      type: String,
    },
    feedbackRating: {
      type: Number,
      min: 1,
      max: 5,
    },
    feedbackNotes: {
      type: String,
    },
    interestLevel: {
      type: String,
      enum: ['HIGH', 'MEDIUM', 'LOW'],
    },
    nextAction: {
      type: String,
    },
    nextActionDate: {
      type: Date,
    },
    reminderJobId: {
      type: Schema.Types.ObjectId,
      ref: 'Job',
    },
  },
  {
    timestamps: true,
  }
);

appointmentSchema.index({ organizationId: 1, appointmentDate: 1 });
appointmentSchema.index({ organizationId: 1, status: 1 });
appointmentSchema.index({ organizationId: 1, appointmentDate: 1, timeSlot: 1 });
appointmentSchema.index({ organizationId: 1, assignedAgentId: 1, appointmentDate: 1, timeSlot: 1 });

export const Appointment = model<IAppointment>('Appointment', appointmentSchema);
