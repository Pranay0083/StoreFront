import type { Migration } from '../migration';

export const authSessions: Migration = {
  id: '030-auth-sessions',
  description: 'Index refresh-token families and expire them automatically',
  async up(db) {
    const sessions = db.collection('authsessions');
    await sessions.createIndex({ userId: 1, revokedAt: 1 });
    await sessions.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  },
};
