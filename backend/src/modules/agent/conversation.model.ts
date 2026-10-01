import mongoose, { Schema, type HydratedDocument, type Types } from 'mongoose';

export type MessageRole = 'user' | 'assistant' | 'tool';

export interface ConversationMessage {
  role: MessageRole;
  content: string;
  toolName?: string;
  at: Date;
}

export interface ConversationRecord {
  _id: Types.ObjectId;
  sessionId: string;
  userId?: Types.ObjectId | string;
  userEmail?: string;
  userName?: string;
  channel: 'widget' | 'mcp';
  messages: ConversationMessage[];
  createdAt: Date;
  updatedAt: Date;
}

export type ConversationDocument = HydratedDocument<ConversationRecord>;

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
        at: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true },
);

conversationSchema.index({ updatedAt: -1 });

export const ConversationModel = mongoose.model<ConversationRecord>('Conversation', conversationSchema);
