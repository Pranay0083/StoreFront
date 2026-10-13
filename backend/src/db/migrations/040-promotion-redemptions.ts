import type { mongo } from 'mongoose';
import type { Migration } from '../migration';

export const promotionRedemptions: Migration = {
  id: '040-promotion-redemptions',
  description: 'Per-order promotion redemption ledger used to count and release promotion usage idempotently',
  async up(db: mongo.Db) {
    const redemptions = db.collection('promotion_redemptions');
    await redemptions.createIndex({ orderId: 1 }, { unique: true });
    await redemptions.createIndex({ 'promotions.promotionId': 1, status: 1 });
    await redemptions.createIndex({ userId: 1, createdAt: -1 });
  },
};
