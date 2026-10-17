import type { Migration } from '../migration';

export const recommendationsIndexes: Migration = {
  id: '071-recommendations',
  description: 'Index precomputed recommendations and paid orders scanned by the co-occurrence job',
  async up(db) {
    await db.collection('recommendations').createIndex({ computedAt: 1 });
    await db.collection('orders').createIndex({ status: 1, paidAt: -1 });
  },
};
