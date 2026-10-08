import mongoose from 'mongoose';
import { describe, expect, it } from 'vitest';
import { OutboxModel } from '../src/core/events/outbox.model';
import { ProductModel as Product } from '../src/modules/catalog/product.model';
import { CouponRedemptionModel as Redemption } from '../src/modules/coupons/coupon-redemption.model';
import { CouponModel as Coupon } from '../src/modules/coupons/coupon.model';
import { InventoryMovementModel as Movement } from '../src/modules/inventory/inventory-movement.model';
import { recordOpeningBalances } from '../src/modules/inventory/opening-balances';
import { StockReservationModel as Reservation } from '../src/modules/inventory/stock-reservation.model';
import { OrderModel as Order } from '../src/modules/orders/order.model';
import { ADDRESS, createCoupon, createProduct, createUser } from './helpers/factories';
import { API, bearer, useTestApp } from './helpers/app';

const t = useTestApp();

const stockOf = async (productId: unknown, size: string) =>
  (await Product.findById(productId).lean())!.sizes.find(s => s.size === size)!.stock;
const outboxNames = async (aggregateId: string) =>
  (await OutboxModel.find({ aggregateId }).sort({ occurredAt: 1 }).lean()).map(e => e.name);
const drain = () => t.container.services.relay.drain();

async function product(overrides: Record<string, unknown> = {}) {
  const p = await createProduct(overrides);
  await recordOpeningBalances(mongoose.connection.db!);
  return p;
}

function checkout(token: string, productId: unknown, extra: Record<string, unknown> = {}, qty = 1, size = 'M') {
  return t
    .http()
    .post(`${API}/orders`)
    .set(bearer(token))
    .send({ address: ADDRESS, items: [{ productId: String(productId), size, qty }], ...extra });
}

describe('checkout reservations', () => {
  it('reserves stock, records the ledger and emits OrderPlaced atomically with the order', async () => {
    const buyer = await createUser();
    const p = await product();
    const res = await checkout(buyer.token, p._id, {}, 3).expect(201);

    expect(await stockOf(p._id, 'M')).toBe(7);
    expect(res.body.reservedUntil).toBeDefined();
    expect(await Reservation.findOne({ orderId: res.body._id }).lean()).toMatchObject({ status: 'active' });
    expect(await Movement.find({ orderId: res.body._id }).lean()).toEqual([expect.objectContaining({ type: 'RESERVE', delta: -3 })]);
    expect(await outboxNames(res.body._id)).toEqual(['OrderPlaced']);
  });

  it('rolls back the stock it took when a later step of checkout fails', async () => {
    const buyer = await createUser();
    const p = await product({ price: 200_000 });
    await createCoupon({ code: 'ONCE', usageLimit: 1, usedCount: 0, minSubtotal: 0 });
    await Coupon.updateOne({ code: 'ONCE' }, { $set: { usedCount: 1 } });

    await checkout(buyer.token, p._id, { couponCode: 'ONCE' }).expect(400);
    expect(await stockOf(p._id, 'M')).toBe(10);
    expect(await Order.countDocuments()).toBe(0);
    expect(await Reservation.countDocuments()).toBe(0);
    expect(await OutboxModel.countDocuments()).toBe(0);
  });

  it('sells the last unit exactly once under 50 concurrent checkouts', async () => {
    const p = await product({ sizes: [{ size: 'M', stock: 1 }] });
    const buyers = await Promise.all(Array.from({ length: 50 }, () => createUser()));

    const results = await Promise.all(buyers.map(b => checkout(b.token, p._id)));
    const statuses = results.map(r => r.status);
    expect(statuses.filter(s => s === 201)).toHaveLength(1);
    expect(statuses.filter(s => s === 409)).toHaveLength(49);
    expect(results.find(r => r.status === 409)!.body.error).toMatch(/Only 0 left/);

    expect(await stockOf(p._id, 'M')).toBe(0);
    expect(await Order.countDocuments()).toBe(1);
    expect(await t.container.services.inventory.reconcile()).toMatchObject({ ok: true });
  });

  it('never over-redeems a limited coupon under concurrency', async () => {
    const p = await product({ price: 200_000, sizes: [{ size: 'M', stock: 100 }] });
    await createCoupon({ code: 'FIRST3', usageLimit: 3, minSubtotal: 0 });
    const buyers = await Promise.all(Array.from({ length: 12 }, () => createUser()));

    const results = await Promise.all(buyers.map(b => checkout(b.token, p._id, { couponCode: 'FIRST3' })));
    expect(results.filter(r => r.status === 201)).toHaveLength(3);
    expect(results.filter(r => r.status === 400).every(r => r.body.error === 'This coupon has been fully redeemed')).toBe(true);
    expect((await Coupon.findOne({ code: 'FIRST3' }))!.usedCount).toBe(3);
    expect(await Redemption.countDocuments({ couponCode: 'FIRST3', status: 'reserved' })).toBe(3);
    expect(await stockOf(p._id, 'M')).toBe(97);
  });
});

describe('reservation expiry', () => {
  it('cancels unpaid orders after the payment window, returns stock and the coupon use', async () => {
    const buyer = await createUser();
    const p = await product({ price: 200_000 });
    await createCoupon({ minSubtotal: 0 });
    const order = (await checkout(buyer.token, p._id, { couponCode: 'WELCOME10' }, 2).expect(201)).body;
    expect(await stockOf(p._id, 'M')).toBe(8);
    expect((await Coupon.findOne({ code: 'WELCOME10' }))!.usedCount).toBe(1);

    const sweeper = t.container.services.reservationSweeper;
    expect(await sweeper.sweep(new Date())).toBe(0);
    expect(await sweeper.sweep(new Date(Date.now() + 16 * 60_000))).toBe(1);
    expect(await sweeper.sweep(new Date(Date.now() + 16 * 60_000))).toBe(0);

    const cancelled = await Order.findById(order._id).lean();
    expect(cancelled).toMatchObject({ status: 'cancelled' });
    expect(cancelled!.statusHistory.at(-1)).toMatchObject({ by: 'system:reservation-expiry', note: 'Payment window expired' });
    expect(await stockOf(p._id, 'M')).toBe(10);

    await drain();
    expect((await Coupon.findOne({ code: 'WELCOME10' }))!.usedCount).toBe(0);
    expect(await outboxNames(order._id)).toEqual(['OrderPlaced', 'OrderCancelled']);
    expect(await t.container.services.inventory.reconcile()).toMatchObject({ ok: true });
  });

  it('refuses to start a payment once the window has passed', async () => {
    const buyer = await createUser();
    const p = await product();
    const order = (await checkout(buyer.token, p._id).expect(201)).body;
    await Order.updateOne({ _id: order._id }, { $set: { reservedUntil: new Date(Date.now() - 1_000) } });
    const res = await t.http().post(`${API}/payments/create`).set(bearer(buyer.token)).send({ orderId: order._id }).expect(409);
    expect(res.body.error).toMatch(/payment window/);
  });
});

describe('order events', () => {
  it('pays from the reservation without touching stock again and flags low stock', async () => {
    const buyer = await createUser();
    const p = await product({ sizes: [{ size: 'M', stock: 6 }] });
    const order = (await checkout(buyer.token, p._id, {}, 2).expect(201)).body;

    const paid = await t.http().post(`${API}/payments/demo-confirm`).set(bearer(buyer.token)).send({ orderId: order._id }).expect(200);
    expect(paid.body.order).toMatchObject({ status: 'paid', payment: { status: 'captured', provider: 'demo' } });
    expect(await stockOf(p._id, 'M')).toBe(4);
    expect(await Reservation.findOne({ orderId: order._id }).lean()).toMatchObject({ status: 'committed' });
    expect((await Movement.find({ orderId: order._id }).sort({ createdAt: 1 }).lean()).map(m => m.type)).toEqual(['RESERVE', 'SALE']);

    await drain();
    const stockLow = await OutboxModel.findOne({ name: 'StockLow' }).lean();
    expect(stockLow).toMatchObject({ status: 'done', payload: { productId: String(p._id), size: 'M', stock: 4, threshold: 5 } });
    expect(await outboxNames(order._id)).toEqual(['OrderPlaced', 'OrderPaid']);
  });

  it('releases stock and the coupon when a customer cancels before paying', async () => {
    const buyer = await createUser();
    const p = await product({ price: 200_000 });
    await createCoupon({ minSubtotal: 0 });
    const order = (await checkout(buyer.token, p._id, { couponCode: 'WELCOME10' }, 4).expect(201)).body;

    await t.http().post(`${API}/orders/${order._id}/cancel`).set(bearer(buyer.token)).expect(200);
    expect(await stockOf(p._id, 'M')).toBe(10);
    await drain();
    expect((await Coupon.findOne({ code: 'WELCOME10' }))!.usedCount).toBe(0);
    expect(await Redemption.findOne({ orderId: order._id }).lean()).toMatchObject({ status: 'released' });
  });

  it('lets admins cancel unpaid orders, returning stock', async () => {
    const buyer = await createUser();
    const admin = await createUser({ role: 'admin' });
    const p = await product();
    const order = (await checkout(buyer.token, p._id, {}, 5).expect(201)).body;
    const res = await t
      .http()
      .post(`${API}/admin/orders/bulk-transition`)
      .set(bearer(admin.token))
      .send({ ids: [order._id], to: 'cancelled' })
      .expect(200);
    expect(res.body).toEqual({ updated: 1, rejected: [] });
    expect(await stockOf(p._id, 'M')).toBe(10);
  });

  it('rejects admin attempts to mark orders paid by hand', async () => {
    const buyer = await createUser();
    const admin = await createUser({ role: 'admin' });
    const p = await product();
    const order = (await checkout(buyer.token, p._id).expect(201)).body;
    const res = await t
      .http()
      .post(`${API}/admin/orders/bulk-transition`)
      .set(bearer(admin.token))
      .send({ ids: [order._id], to: 'paid' })
      .expect(200);
    expect(res.body.rejected).toEqual([{ id: order.orderNumber, reason: 'Illegal transition: created → paid' }]);
  });
});
