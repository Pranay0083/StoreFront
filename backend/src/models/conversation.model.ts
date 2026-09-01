import mongoose, { Schema } from 'mongoose';

const conversationSchema = new Schema({
  sessionId: { type: String, required: true, unique: true },
  userId: { type: Schema.Types.ObjectId, ref: 'User' },
  userEmail: String,
  userName: String,
  channel: { type: String, enum: ['widget', 'mcp'], default: 'widget' },
  messages: [{
    role: { type: String, enum: ['user', 'assistant', 'tool'], required: true },
    content: { type: String, default: '' },
    toolName: String,
    at: { type: Date, default: Date.now },
  }],
}, { timestamps: true });

conversationSchema.index({ updatedAt: -1 });

export const Conversation = mongoose.model('Conversation', conversationSchema);
