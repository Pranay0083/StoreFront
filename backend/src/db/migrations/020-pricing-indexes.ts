import type { mongo } from 'mongoose';
import type { Migration } from '../migration';

export const pricingIndexes: Migration = {
  id: '020-pricing-indexes',
  description: 'Indexes for promotions, their version history and expiring price quotes',
  async up(db: mongo.Db) {
    await db.collection('promotions').createIndex({ code: 1 }, { unique: true, partialFilterExpression: { code: { $type: 'string' } } });
    await db.collection('promotions').createIndex({ status: 1, priority: -1 });
    await db.collection('promotion_versions').createIndex({ promotionId: 1, version: 1 }, { unique: true });
    await db.collection('pricing_quotes').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  },
};
