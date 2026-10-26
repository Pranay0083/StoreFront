import mongoose from 'mongoose';
import { describe, expect, it, vi } from 'vitest';
import { OutboxModel } from '../src/core/events/outbox.model';
import { ProductModel as Product } from '../src/modules/catalog/product.model';
import { InventoryMovementModel as Movement } from '../src/modules/inventory/inventory-movement.model';
import { recordOpeningBalances } from '../src/modules/inventory/opening-balances';
import { StockReservationModel as Reservation } from '../src/modules/inventory/stock-reservation.model';
import { OrderModel as Order } from '../src/modules/orders/order.model';
import { PromotionRedemptionModel as Redemption } from '../src/modules/pricing/promotion-redemption.model';
import { PromotionModel as Promotion } from '../src/modules/pricing/promotion.model';
import { ADDRESS, createProduct, createPromotion, createUser } from './helpers/factories';
import { API, bearer, useTestApp } from './helpers/app';

const t = useTestApp();

const stockOf = async (productId: unknown, size: string) =>
  (await Product.findById(productId).lean())!.sizes.find(s => s.size === size)!.stock;
const outboxNames = async (aggregateId: string) =>
  (await OutboxModel.find({ aggregateId }).sort({ occurredAt: 1 }).lean()).map(e => e.name);
const drain = () => t.container.services.relay.drain();
const usedCount = async (code: string) => (await Promotion.findOne({ code }).lean())!.usedCount;

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
    await createPromotion(t.container.services, { code: 'ONCE', usageLimit: 1, conditions: undefined });
    await t
      .http()
      .post(`${API}/pricing/quote`)
      .send({ items: [{ productId: String(p._id), size: 'M', qty: 1 }], codes: ['ONCE'] });
    // Someone else redeems the last use after the cache was warmed, so redemption fails after stock was reserved.
    await Promotion.updateOne({ code: 'ONCE' }, { $set: { usedCount: 1 } });

    const res = await checkout(buyer.token, p._id, { codes: ['ONCE'] }).expect(409);
    expect(res.body.code).toBe('PROMOTION_EXHAUSTED');
    expect(await stockOf(p._id, 'M')).toBe(10);
    expect(await Order.countDocuments()).toBe(0);
    expect(await Reservation.countDocuments()).toBe(0);
    expect(await OutboxModel.countDocuments()).toBe(0);
    expect(await Redemption.countDocuments()).toBe(0);
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

  it('refuses a sold-out variant before opening a transaction', async () => {
    const p = await product({ sizes: [{ size: 'M', stock: 0 }] });
    const buyer = await createUser();
    const run = vi.spyOn(t.container.tx, 'run');
    try {
      const res = await checkout(buyer.token, p._id).expect(409);
      expect(res.body.error).toMatch(/Only 0 left/);
      expect(run).not.toHaveBeenCalled();
    } finally {
      run.mockRestore();
    }
  });

  it('never over-redeems a limited promotion under 20 concurrent checkouts', async () => {
    const p = await product({ price: 200_000, sizes: [{ size: 'M', stock: 100 }] });
    const promo = await createPromotion(t.container.services, { code: 'FIRST5', usageLimit: 5, conditions: undefined });
    const buyers = await Promise.all(Array.from({ length: 20 }, () => createUser()));

    const results = await Promise.all(buyers.map(b => checkout(b.token, p._id, { codes: ['FIRST5'] })));
    const placed = results.filter(r => r.status === 201);
    expect(placed).toHaveLength(5);
    expect(placed.every(r => r.body.pricing.applied.some((a: { promotionId: string }) => a.promotionId === promo._id))).toBe(true);
    // Losers either lose the redemption race (409) or are priced after the promotion ran out (400).
    for (const r of results.filter(r => r.status !== 201)) expect(['PROMOTION_EXHAUSTED', 'CODE_REJECTED']).toContain(r.body.code);
    expect(await usedCount('FIRST5')).toBe(5);
    expect(await Redemption.countDocuments({ 'promotions.promotionId': promo._id, status: 'reserved' })).toBe(5);
    expect(await stockOf(p._id, 'M')).toBe(95);
    expect(await t.container.services.inventory.reconcile()).toMatchObject({ ok: true });
  });
});

describe('reservation expiry', () => {
  it('cancels unpaid orders after the payment window, returns stock and the promotion use', async () => {
    const buyer = await createUser();
    const p = await product({ price: 200_000 });
    await createPromotion(t.container.services);
    const order = (await checkout(buyer.token, p._id, { codes: ['WELCOME10'] }, 2).expect(201)).body;
    expect(await stockOf(p._id, 'M')).toBe(8);
    expect(await usedCount('WELCOME10')).toBe(1);

    const sweeper = t.container.services.reservationSweeper;
    expect(await sweeper.sweep(new Date())).toBe(0);
    expect(await sweeper.sweep(new Date(Date.now() + 16 * 60_000))).toBe(1);
    expect(await sweeper.sweep(new Date(Date.now() + 16 * 60_000))).toBe(0);

    const cancelled = await Order.findById(order._id).lean();
    expect(cancelled).toMatchObject({ status: 'cancelled' });
    expect(cancelled!.statusHistory.at(-1)).toMatchObject({ by: 'system:reservation-expiry', note: 'Payment window expired' });
    expect(await stockOf(p._id, 'M')).toBe(10);

    await drain();
    expect(await usedCount('WELCOME10')).toBe(0);
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

  it('releases stock and the promotion use when a customer cancels before paying', async () => {
    const buyer = await createUser();
    const p = await product({ price: 200_000 });
    await createPromotion(t.container.services);
    const order = (await checkout(buyer.token, p._id, { codes: ['WELCOME10'] }, 4).expect(201)).body;
    expect(await usedCount('WELCOME10')).toBe(1);

    await t.http().post(`${API}/orders/${order._id}/cancel`).set(bearer(buyer.token)).expect(200);
    expect(await stockOf(p._id, 'M')).toBe(10);
    await drain();
    expect(await usedCount('WELCOME10')).toBe(0);
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
