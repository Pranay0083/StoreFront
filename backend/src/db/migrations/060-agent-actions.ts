import type { Migration } from '../migration';

export const agentActions: Migration = {
  id: '060-agent-actions',
  description: 'Index agent pending actions (TTL purge) and conversation action lookups; backfill conversation usage totals',
  async up(db) {
    const actions = db.collection('agent_pending_actions');
    await actions.createIndex({ userId: 1, status: 1, createdAt: -1 });
    await actions.createIndex({ purgeAt: 1 }, { expireAfterSeconds: 0 });
    const conversations = db.collection('conversations');
    await conversations.createIndex({ 'messages.action.id': 1 }, { sparse: true });
    await conversations.updateMany(
      { usage: { $exists: false } },
      { $set: { usage: { inputTokens: 0, outputTokens: 0, costUsd: 0, llmCalls: 0 }, summarizedThrough: 0 } },
    );
  },
};
