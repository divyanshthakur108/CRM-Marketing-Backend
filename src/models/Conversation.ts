import { Schema, model, Document, Types } from 'mongoose';

export type ConversationChannel = 'WHATSAPP' | 'SMS' | 'WEB_CHAT';
export type MessageSender = 'user' | 'agent' | 'bot';

export interface IMessage {
  id: string;
  sender: MessageSender;
  text: string;
  time: string;
  timestamp: Date;
}

export interface IConversation extends Document {
  organizationId: Types.ObjectId;
  leadId?: Types.ObjectId;
  projectId?: Types.ObjectId;
  projectName?: string;
  contactName: string;
  contactPhone: string;
  channel: ConversationChannel;
  lastMessage: string;
  lastMessageAt: Date;
  unreadCount: number;
  needsHandoff: boolean;
  handoffReason?: string;
  assignedAgentId?: Types.ObjectId;
  assignedAgentName?: string;
  messages: IMessage[];
  createdAt: Date;
  updatedAt: Date;
}

const conversationSchema = new Schema<IConversation>(
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
    },
    projectName: {
      type: String,
    },
    contactName: {
      type: String,
      required: true,
    },
    contactPhone: {
      type: String,
      required: true,
    },
    channel: {
      type: String,
      enum: ['WHATSAPP', 'SMS', 'WEB_CHAT'],
      default: 'WHATSAPP',
    },
    lastMessage: {
      type: String,
      default: '',
    },
    lastMessageAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    unreadCount: {
      type: Number,
      default: 0,
    },
    needsHandoff: {
      type: Boolean,
      default: false,
      index: true,
    },
    handoffReason: {
      type: String,
    },
    assignedAgentId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      index: true,
    },
    assignedAgentName: {
      type: String,
    },
    messages: [
      {
        id: { type: String, required: true },
        sender: { type: String, enum: ['user', 'agent', 'bot'], required: true },
        text: { type: String, required: true },
        time: { type: String, required: true },
        timestamp: { type: Date, default: Date.now },
      },
    ],
  },
  {
    timestamps: true,
  }
);

conversationSchema.index({ organizationId: 1, lastMessageAt: -1 });

export const Conversation = model<IConversation>('Conversation', conversationSchema);
