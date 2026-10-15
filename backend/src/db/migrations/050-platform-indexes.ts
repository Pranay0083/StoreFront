import type { Migration } from '../migration';

export const platformIndexes: Migration = {
  id: '050-platform-indexes',
  description: 'Index dead-lettered jobs, the notification log, idle carts and dispatched outbox events',
  async up(db) {
    await db.collection('dead_letter_jobs').createIndex({ failedAt: -1 });
    await db.collection('dead_letter_jobs').createIndex({ name: 1, failedAt: -1 });
    await db.collection('notification_log').createIndex({ key: 1 });
    await db.collection('notification_log').createIndex({ createdAt: 1 }, { expireAfterSeconds: 180 * 24 * 3600 });
    await db.collection('carts').createIndex({ updatedAt: 1 }, { partialFilterExpression: { 'items.0': { $exists: true } } });
    await db.collection('outbox').createIndex({ status: 1, dispatchedAt: 1 });
  },
};
