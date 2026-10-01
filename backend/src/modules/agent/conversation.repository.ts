import { ConversationModel, type ConversationDocument, type ConversationRecord } from './conversation.model';

export class ConversationRepository {
  async findOrStart(sessionId: string): Promise<ConversationDocument> {
    return (await ConversationModel.findOne({ sessionId })) ?? new ConversationModel({ sessionId, channel: 'widget', messages: [] });
  }

  findBySession(sessionId: string): Promise<ConversationRecord | null> {
    return ConversationModel.findOne({ sessionId }).lean<ConversationRecord>();
  }

  async save(conversation: ConversationDocument): Promise<void> {
    await conversation.save();
  }

  recent(limit = 100): Promise<ConversationRecord[]> {
    return ConversationModel.find().sort({ updatedAt: -1 }).limit(limit).lean<ConversationRecord[]>();
  }
}
