import mongoose, { Schema, type HydratedDocument, type Types } from 'mongoose';
import { ACTION_STATUSES, ACTION_TYPES, type ActionStatus, type ActionType } from './actions/pending-action.model';

export type MessageRole = 'user' | 'assistant' | 'tool';

export interface MessageUsage {
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  latencyMs: number;
  llmCalls: number;
}

export interface ConversationMessage {
  role: MessageRole;
  content: string;
  toolName?: string;
  usage?: MessageUsage;
  action?: { id: string; type: ActionType; summary: string; status: ActionStatus };
  at: Date;
}

export interface ConversationUsage {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  llmCalls: number;
}

export interface ConversationRecord {
  _id: Types.ObjectId;
  sessionId: string;
  userId?: Types.ObjectId | string;
  userEmail?: string;
  userName?: string;
  channel: 'widget' | 'mcp';
  messages: ConversationMessage[];
  /** Rolling summary of the turns before `summarizedThrough` (an index into `messages`). */
  summary?: string;
  summarizedThrough: number;
  usage: ConversationUsage;
  createdAt: Date;
  updatedAt: Date;
}

export type ConversationDocument = HydratedDocument<ConversationRecord>;

const usageFields = {
  inputTokens: { type: Number, default: 0 },
  outputTokens: { type: Number, default: 0 },
  costUsd: { type: Number, default: 0 },
  llmCalls: { type: Number, default: 0 },
};

const totalsSchema = new Schema(usageFields, { _id: false });
const messageUsageSchema = new Schema({ provider: String, model: String, latencyMs: Number, ...usageFields }, { _id: false });
const messageActionSchema = new Schema(
  { id: String, type: { type: String, enum: ACTION_TYPES }, summary: String, status: { type: String, enum: ACTION_STATUSES } },
  { _id: false },
);

const conversationSchema = new Schema<ConversationRecord>(
  {
    sessionId: { type: String, required: true, unique: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User' },
    userEmail: String,
    userName: String,
    channel: { type: String, enum: ['widget', 'mcp'], default: 'widget' },
    messages: [
      {
        role: { type: String, enum: ['user', 'assistant', 'tool'], required: true },
        content: { type: String, default: '' },
        toolName: String,
        usage: { type: messageUsageSchema, required: false },
        action: { type: messageActionSchema, required: false },
        at: { type: Date, default: Date.now },
      },
    ],
    summary: String,
    summarizedThrough: { type: Number, default: 0 },
    usage: { type: totalsSchema, default: () => ({}) },
  },
  { timestamps: true },
);

conversationSchema.index({ updatedAt: -1 });
conversationSchema.index({ 'messages.action.id': 1 }, { sparse: true });

export const ConversationModel = mongoose.model<ConversationRecord>('Conversation', conversationSchema);
