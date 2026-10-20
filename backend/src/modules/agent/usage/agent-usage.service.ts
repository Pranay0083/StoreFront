import type { ConversationRepository } from '../conversation.repository';

const DAY = 86_400_000;

export class AgentUsageService {
  constructor(private readonly conversations: ConversationRepository) {}

  async summary(days = 14) {
    const since = new Date(Date.now() - days * DAY);
    since.setUTCHours(0, 0, 0, 0);
    const [daily, conversations] = await Promise.all([this.conversations.dailyUsage(since), this.conversations.usageByConversation(100)]);
    const totals = daily.reduce(
      (t, d) => ({
        inputTokens: t.inputTokens + d.inputTokens,
        outputTokens: t.outputTokens + d.outputTokens,
        costUsd: t.costUsd + d.costUsd,
        llmCalls: t.llmCalls + d.llmCalls,
        messages: t.messages + d.messages,
      }),
      { inputTokens: 0, outputTokens: 0, costUsd: 0, llmCalls: 0, messages: 0 },
    );
    return { days, since: since.toISOString(), totals, daily, conversations };
  }
}
