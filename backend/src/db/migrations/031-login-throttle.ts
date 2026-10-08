import type { Migration } from '../migration';

export const loginThrottle: Migration = {
  id: '031-login-throttle',
  description: 'Replace email-keyed hard lockouts with expiring IP+email throttle records',
  async up(db) {
    const attempts = db.collection('loginattempts');
    await attempts.deleteMany({});
    const exists = await db.listCollections({ name: 'loginattempts' }).hasNext();
    if (exists && (await attempts.indexExists('identifier_1'))) await attempts.dropIndex('identifier_1');
    await attempts.createIndex({ key: 1 }, { unique: true });
    await attempts.createIndex({ expireAt: 1 }, { expireAfterSeconds: 0 });
  },
};
