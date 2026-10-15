import mongoose from 'mongoose';
import { describe, expect, it } from 'vitest';
import { ProductModel as Product } from '../src/modules/catalog/product.model';
import { InventoryMovementModel as Movement } from '../src/modules/inventory/inventory-movement.model';
import { recordOpeningBalances } from '../src/modules/inventory/opening-balances';
import { StockReservationModel as Reservation } from '../src/modules/inventory/stock-reservation.model';
import { OrderModel as Order } from '../src/modules/orders/order.model';
import { PromotionModel as Promotion } from '../src/modules/pricing/promotion.model';
import { AuditLogModel } from '../src/modules/admin/audit-log.model';
import { ADDRESS, createProduct, createPromotion, createUser } from './helpers/factories';
import { API, bearer, useTestApp } from './helpers/app';

const t = useTestApp();
const drain = () => t.container.services.relay.drain();
const stockOf = async (productId: unknown, size = 'M') =>
  (await Product.findById(productId).lean())!.sizes.find(s => s.size === size)!.stock;

interface OrderLineBody {
  productId: string;
  size: string;
  qty: number;
  lineTotal: number;
  discounts: Array<{ amount: number }>;
}

async function deliveredBundleOrder(qty: { shirt: number; jeans: number }) {
  const buyer = await createUser();
  const shirt = await createProduct({ title: 'Oxford Shirt', price: 249_900 });
  const jeans = await createProduct({ title: 'Denim Jeans', price: 459_900 });
  await recordOpeningBalances(mongoose.connection.db!);
  const promo = await createPromotion(t.container.services, {
    name: 'Weekend Uniform',
    activation: 'auto',
    code: undefined,
    stackGroup: undefined,
    conditions: undefined,
    usageLimit: 10,
    action: {
      type: 'fixedBundle',
      components: [
        { selector: { slugs: [shirt.slug] }, qty: 1 },
        { selector: { slugs: [jeans.slug] }, qty: 1 },
      ],
      price: 599_900,
    },
  });
  const order = (
    await t
      .http()
      .post(`${API}/orders`)
      .set(bearer(buyer.token))
      .send({
        address: ADDRESS,
        items: [
          { productId: String(shirt._id), size: 'M', qty: qty.shirt },
          { productId: String(jeans._id), size: 'M', qty: qty.jeans },
        ],
      })
      .expect(201)
  ).body;
  await t.http().post(`${API}/payments/demo-confirm`).set(bearer(buyer.token)).send({ orderId: order._id }).expect(200);
  for (const step of ['packed', 'shipped', 'delivered'] as const)
    await t.container.services.orders.adminTransition(order._id, step, 'admin-1');
  await drain();
  const line = (p: { _id: unknown }) => order.items.find((i: OrderLineBody) => i.productId === String(p._id)) as OrderLineBody;
  return { buyer, shirt, jeans, promo, order, line };
}

const refund = (token: string, orderId: string, body: Record<string, unknown>) =>
  t.http().post(`${API}/orders/${orderId}/refund`).set(bearer(token)).send(body);

describe('per-line refunds', () => {
  it('refunds returned items at their discounted share, keeps the promotion until the order is fully refunded', async () => {
    const { buyer, shirt, jeans, promo, order, line } = await deliveredBundleOrder({ shirt: 1, jeans: 1 });
    expect(order.pricing.applied).toEqual([expect.objectContaining({ promotionId: promo._id, amount: 109_900 })]);
    expect(line(jeans).discounts.length).toBe(1);
    expect(line(shirt).lineTotal + line(jeans).lineTotal).toBe(599_900);
    expect(await stockOf(jeans._id)).toBe(9);

    const partial = await refund(buyer.token, order._id, {
      reason: 'Jeans do not fit',
      lines: [{ productId: String(jeans._id), size: 'M', qty: 1 }],
    }).expect(200);
    expect(partial.body.refunds.at(-1)).toMatchObject({ kind: 'partial', amount: line(jeans).lineTotal, shippingAmount: 0 });
    await drain();

    let saved = (await Order.findById(order._id).lean())!;
    expect(saved.status).toBe('partially_refunded');
    expect(saved.refundedAmount).toBe(line(jeans).lineTotal);
    expect(await stockOf(jeans._id)).toBe(10);
    expect(await stockOf(shirt._id)).toBe(9);
    expect(await Reservation.findOne({ orderId: order._id }).lean()).toMatchObject({ status: 'partially_returned' });
    expect((await Promotion.findById(promo._id).lean())!.usedCount).toBe(1);

    await refund(buyer.token, order._id, { reason: 'Returning the shirt too' }).expect(200);
    await drain();

    saved = (await Order.findById(order._id).lean())!;
    expect(saved.status).toBe('refunded');
    expect(saved.refunds!.map(r => r.kind)).toEqual(['partial', 'full']);
    expect(saved.refunds!.reduce((s, r) => s + r.amount, 0)).toBe(order.total);
    expect(saved.refundedAmount).toBe(order.total);
    expect(await stockOf(shirt._id)).toBe(10);
    expect(await Movement.countDocuments({ orderId: order._id, type: 'RETURN' })).toBe(2);
    expect((await Promotion.findById(promo._id).lean())!.usedCount).toBe(0);
    expect(await t.container.services.inventory.reconcile()).toMatchObject({ ok: true });
  });

  it('refunds a multi-unit line in steps that add up to exactly what was paid', async () => {
    const { buyer, shirt, jeans, order, line } = await deliveredBundleOrder({ shirt: 3, jeans: 1 });
    const shirtLine = line(shirt);
    const amounts: number[] = [];
    for (const qty of [1, 2]) {
      const res = await refund(buyer.token, order._id, {
        reason: 'Too many shirts',
        lines: [{ productId: String(shirt._id), size: 'M', qty }],
      }).expect(200);
      amounts.push(res.body.refunds.at(-1).amount);
      await drain();
    }
    expect(amounts[0] + amounts[1]).toBe(shirtLine.lineTotal);
    const saved = (await Order.findById(order._id).lean())!;
    expect(saved.status).toBe('partially_refunded');
    expect(saved.items.find(i => String(i.productId) === String(shirt._id))).toMatchObject({
      refundedQty: 3,
      refundedAmount: shirtLine.lineTotal,
    });
    expect(saved.items.find(i => String(i.productId) === String(jeans._id))).toMatchObject({ refundedQty: 0 });

    const over = await refund(buyer.token, order._id, {
      reason: 'One more',
      lines: [{ productId: String(shirt._id), size: 'M', qty: 1 }],
    }).expect(409);
    expect(over.body.error).toMatch(/Only 0 of that item/);
    expect(await t.container.services.inventory.reconcile()).toMatchObject({ ok: true });
  });

  it('only allows item-level refunds once the order is delivered', async () => {
    const buyer = await createUser();
    const a = await createProduct();
    const b = await createProduct();
    await recordOpeningBalances(mongoose.connection.db!);
    const order = (
      await t
        .http()
        .post(`${API}/orders`)
        .set(bearer(buyer.token))
        .send({
          address: ADDRESS,
          items: [
            { productId: String(a._id), size: 'M', qty: 1 },
            { productId: String(b._id), size: 'M', qty: 1 },
          ],
        })
        .expect(201)
    ).body;
    await t.http().post(`${API}/payments/demo-confirm`).set(bearer(buyer.token)).send({ orderId: order._id }).expect(200);
    const res = await refund(buyer.token, order._id, {
      reason: 'Just one',
      lines: [{ productId: String(a._id), size: 'M', qty: 1 }],
    }).expect(409);
    expect(res.body.error).toMatch(/once the order is delivered/);
  });

  it('lets fulfilment staff refund specific lines and records it in the audit log', async () => {
    const { jeans, order, line } = await deliveredBundleOrder({ shirt: 1, jeans: 1 });
    const support = await createUser({ role: 'support' });
    const fulfillment = await createUser({ role: 'fulfillment' });
    const body = { reason: 'Damaged in transit', lines: [{ productId: String(jeans._id), size: 'M', qty: 1 }] };

    await t.http().post(`${API}/admin/orders/${order._id}/refund`).set(bearer(support.token)).send(body).expect(403);
    const res = await t.http().post(`${API}/admin/orders/${order._id}/refund`).set(bearer(fulfillment.token)).send(body).expect(200);
    expect(res.body.refunds.at(-1)).toMatchObject({
      kind: 'partial',
      amount: line(jeans).lineTotal,
      requestedBy: `admin:${fulfillment.id}`,
    });
    await drain();
    expect((await Order.findById(order._id).lean())!.status).toBe('partially_refunded');
    await new Promise(r => setTimeout(r, 50));
    expect(await AuditLogModel.findOne({ path: { $regex: '/refund$' } }).lean()).toMatchObject({ targets: [order._id] });
  });
});
