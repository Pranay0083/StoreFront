import type { mongo } from 'mongoose';
import { IDEMPOTENCY_TTL_SECONDS } from '../../core/http/idempotency/idempotency.model';
import type { Migration } from '../migration';

export const orderConsistencyIndexes: Migration = {
  id: '011-order-consistency-indexes',
  description: 'Indexes for the outbox, idempotency keys, coupon redemptions and refund lookups',
  async up(db: mongo.Db) {
    await db.collection('outbox').createIndex({ status: 1, nextAttemptAt: 1 });
    await db.collection('outbox').createIndex({ aggregateId: 1, occurredAt: 1 });
    await db
      .collection('outbox')
      .createIndex({ processedAt: 1 }, { expireAfterSeconds: 7 * 24 * 3600, partialFilterExpression: { status: 'done' } });
    await db.collection('idempotencykeys').createIndex({ createdAt: 1 }, { expireAfterSeconds: IDEMPOTENCY_TTL_SECONDS });
    await db.collection('couponredemptions').createIndex({ orderId: 1 }, { unique: true });
    await db.collection('couponredemptions').createIndex({ couponCode: 1, userId: 1 });
    await db.collection('orders').createIndex({ 'payment.razorpayPaymentId': 1 }, { sparse: true });
    await db.collection('orders').createIndex({ 'refund.gatewayRefundId': 1 }, { sparse: true });
  },
};
