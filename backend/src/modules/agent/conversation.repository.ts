import type { ActionStatus } from './actions/pending-action.model';
import { ConversationModel, type ConversationDocument, type ConversationRecord } from './conversation.model';

export interface DailyUsage {
  date: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  llmCalls: number;
  messages: number;
}

export interface ConversationUsageRow {
  conversationId: string;
  sessionId: string;
  userEmail: string | null;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  llmCalls: number;
  updatedAt: Date;
}

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

  async updateActionStatus(actionId: string, status: ActionStatus): Promise<void> {
    await ConversationModel.updateOne({ 'messages.action.id': actionId }, { $set: { 'messages.$.action.status': status } });
  }

  async usageByConversation(limit = 100): Promise<ConversationUsageRow[]> {
    const rows = await ConversationModel.find({ 'usage.llmCalls': { $gt: 0 } }, { sessionId: 1, userEmail: 1, usage: 1, updatedAt: 1 })
      .sort({ updatedAt: -1 })
      .limit(limit)
      .lean<ConversationRecord[]>();
    return rows.map(r => ({
      conversationId: String(r._id),
      sessionId: r.sessionId,
      userEmail: r.userEmail ?? null,
      inputTokens: r.usage?.inputTokens ?? 0,
      outputTokens: r.usage?.outputTokens ?? 0,
      costUsd: r.usage?.costUsd ?? 0,
      llmCalls: r.usage?.llmCalls ?? 0,
      updatedAt: r.updatedAt,
    }));
  }

  dailyUsage(since: Date): Promise<DailyUsage[]> {
    return ConversationModel.aggregate<DailyUsage>([
      { $match: { updatedAt: { $gte: since } } },
      { $unwind: '$messages' },
      { $match: { 'messages.usage': { $exists: true }, 'messages.at': { $gte: since } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$messages.at' } },
          inputTokens: { $sum: '$messages.usage.inputTokens' },
          outputTokens: { $sum: '$messages.usage.outputTokens' },
          costUsd: { $sum: '$messages.usage.costUsd' },
          llmCalls: { $sum: '$messages.usage.llmCalls' },
          messages: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
      { $project: { _id: 0, date: '$_id', inputTokens: 1, outputTokens: 1, costUsd: 1, llmCalls: 1, messages: 1 } },
    ]);
  }
}
