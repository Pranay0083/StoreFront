import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { connectDB, disconnectDB } from '../../core/config/db';
import { couponsToPromotions } from './041-coupons-to-promotions';

const oid = () => new mongoose.Types.ObjectId();

describe('041-coupons-to-promotions', () => {
  beforeAll(() => connectDB(process.env.MONGO_URL!, process.env.DB_NAME!));
  beforeEach(() => mongoose.connection.db!.dropDatabase());
  afterAll(async () => {
    await mongoose.connection.db!.dropDatabase();
    await disconnectDB();
  });

  it('converts coupons into equivalent code promotions and records the mapping', async () => {
    const db = mongoose.connection.db!;
    const expires = new Date('2030-01-01T00:00:00Z');
    await db.collection('coupons').insertMany([
      {
        code: 'SPRING15',
        type: 'percent',
        value: 15,
        minSubtotal: 200_000,
        maxDiscount: 75_000,
        usageLimit: 100,
        usedCount: 7,
        active: true,
        expiresAt: expires,
      },
      { code: 'FLAT250', type: 'flat', value: 25_000, minSubtotal: 0, usedCount: 0, active: false },
    ]);

    await couponsToPromotions.up(db);

    const spring = await db.collection('promotions').findOne({ code: 'SPRING15' });
    expect(spring).toMatchObject({
      name: 'Coupon SPRING15',
      description: '15% off (up to ₹750) on orders of ₹2,000 or more.',
      status: 'active',
      activation: 'code',
      stackGroup: 'order-discount',
      conditions: { type: 'minSubtotal', amount: 200_000 },
      action: { type: 'percentOff', percent: 15, maxDiscount: 75_000 },
      endsAt: expires,
      usageLimit: 100,
      usedCount: 7,
      version: 1,
      migratedFrom: { kind: 'coupon', code: 'SPRING15' },
    });
    const flat = await db.collection('promotions').findOne({ code: 'FLAT250' });
    expect(flat).toMatchObject({ status: 'paused', action: { type: 'flatOff', amount: 25_000 } });
    expect(flat).not.toHaveProperty('conditions');
    expect(await db.collection('promotion_versions').countDocuments({ version: 1 })).toBe(2);
    expect((await db.collection('coupon_promotion_map').find().toArray()).map(m => [m.code, m.outcome]).sort()).toEqual([
      ['FLAT250', 'created'],
      ['SPRING15', 'created'],
    ]);
    expect((await db.listCollections({ name: 'coupons_legacy' }).toArray()).length).toBe(1);
    expect((await db.listCollections({ name: 'coupons' }).toArray()).length).toBe(0);
  });

  it('reuses an existing promotion with the same code and moves redemptions to the promotion ledger', async () => {
    const db = mongoose.connection.db!;
    const existing = await db.collection('promotions').insertOne({ name: 'WELCOME10', code: 'WELCOME10', version: 3, usedCount: 2 });
    const reservedOrder = oid();
    const releasedOrder = oid();
    await db.collection('orders').insertMany([
      { _id: reservedOrder, discount: 40_000 },
      { _id: releasedOrder, discount: 10_000 },
    ]);
    await db.collection('coupons').insertOne({ code: 'welcome10', type: 'percent', value: 10, usedCount: 1, active: true });
    await db.collection('couponredemptions').insertMany([
      { couponCode: 'WELCOME10', orderId: reservedOrder, userId: oid(), status: 'reserved' },
      { couponCode: 'WELCOME10', orderId: releasedOrder, userId: oid(), status: 'released' },
    ]);

    await couponsToPromotions.up(db);
    await couponsToPromotions.up(db);

    expect(await db.collection('promotions').countDocuments()).toBe(1);
    expect(await db.collection('coupon_promotion_map').findOne({ code: 'WELCOME10' })).toMatchObject({
      outcome: 'existing',
      promotionId: existing.insertedId,
    });
    expect(await db.collection('promotion_redemptions').findOne({ orderId: reservedOrder })).toMatchObject({
      status: 'reserved',
      promotions: [{ promotionId: existing.insertedId, version: 3, code: 'WELCOME10', amount: 40_000 }],
    });
    expect(await db.collection('promotion_redemptions').findOne({ orderId: releasedOrder })).toMatchObject({ status: 'released' });
    expect((await db.collection('promotions').findOne({ _id: existing.insertedId }))!.usedCount).toBe(3);
    expect((await db.listCollections({ name: 'couponredemptions_legacy' }).toArray()).length).toBe(1);
  });

  it('records coupons that cannot be expressed as a promotion instead of failing', async () => {
    const db = mongoose.connection.db!;
    await db.collection('coupons').insertOne({ code: 'WEIRD', type: 'percent', value: 12.5, usedCount: 0, active: true });
    await couponsToPromotions.up(db);
    expect(await db.collection('promotions').countDocuments()).toBe(0);
    expect(await db.collection('coupon_promotion_map').findOne({ code: 'WEIRD' })).toMatchObject({ outcome: 'invalid' });
  });
});
