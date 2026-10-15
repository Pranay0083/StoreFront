import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { connectDB, disconnectDB } from '../../core/config/db';
import { allocate, lineRefunds } from './042-line-refunds';

describe('042-line-refunds', () => {
  beforeAll(() => connectDB(process.env.MONGO_URL!, process.env.DB_NAME!));
  beforeEach(() => mongoose.connection.db!.dropDatabase());
  afterAll(async () => {
    await mongoose.connection.db!.dropDatabase();
    await disconnectDB();
  });

  it('allocates to the paisa by largest remainder', () => {
    expect(allocate(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(allocate(40_000, [300_000, 100_000])).toEqual([30_000, 10_000]);
    expect(allocate(0, [5, 5])).toEqual([0, 0]);
  });

  it('backfills paid line totals and converts a processed legacy refund into a full refund entry', async () => {
    const db = mongoose.connection.db!;
    const pid = new mongoose.Types.ObjectId();
    const { insertedId } = await db.collection('orders').insertOne({
      couponCode: 'WELCOME10',
      discount: 10_001,
      shipping: 9_900,
      total: 299_899 + 9_900,
      items: [
        { productId: pid, size: 'M', qty: 2, price: 100_000 },
        { productId: pid, size: 'L', qty: 1, price: 100_000 },
      ],
      refund: { status: 'processed', amount: 309_799, reason: 'x', requestedBy: 'u', requestedAt: new Date(), previousStatus: 'paid' },
    });
    await db.collection('orders').createIndex({ 'refund.gatewayRefundId': 1 }, { sparse: true });

    await lineRefunds.up(db);
    await lineRefunds.up(db);

    const order = (await db.collection('orders').findOne({ _id: insertedId }))!;
    expect(order.refund).toBeUndefined();
    expect(order.items.map((i: { lineTotal: number }) => i.lineTotal)).toEqual([193_333, 96_666]);
    expect(order.items[0]).toMatchObject({ discounts: [{ promotionId: 'legacy-coupon:WELCOME10', amount: 6_667 }], refundedQty: 2 });
    expect(order.refunds).toEqual([
      expect.objectContaining({ kind: 'full', status: 'processed', amount: 309_799, shippingAmount: 9_900, id: insertedId.toHexString() }),
    ]);
    expect(order.refunds[0].lines.map((l: { qty: number }) => l.qty)).toEqual([2, 1]);
    expect(order.refundedAmount).toBe(309_799);
    const names = (await db.collection('orders').indexes()).map(i => i.name);
    expect(names).toContain('refunds.gatewayRefundId_1');
    expect(names).not.toContain('refund.gatewayRefundId_1');
  });
});
