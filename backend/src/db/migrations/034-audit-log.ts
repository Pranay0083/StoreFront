import type { Migration } from '../migration';

export const auditLog: Migration = {
  id: '034-audit-log',
  description: 'Index the admin audit log by actor and target for keyset pagination',
  async up(db) {
    const logs = db.collection('auditlogs');
    await logs.createIndex({ actorId: 1, _id: -1 });
    await logs.createIndex({ targets: 1, _id: -1 });
  },
};
