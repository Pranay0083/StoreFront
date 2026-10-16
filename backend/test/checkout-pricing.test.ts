import type { PriceQuote } from '@storefront/contracts';
import mongoose from 'mongoose';
import { describe, expect, it } from 'vitest';
import { ProductModel as Product } from '../src/modules/catalog/product.model';
import { recordOpeningBalances } from '../src/modules/inventory/opening-balances';
import { StockReservationModel as Reservation } from '../src/modules/inventory/stock-reservation.model';
import { OrderModel as Order } from '../src/modules/orders/order.model';
import { QuoteModel } from '../src/modules/pricing/quote.model';
import { ADDRESS, createProduct, createPromotion, createUser } from './helpers/factories';
import { API, bearer, useTestApp } from './helpers/app';

const t = useTestApp();

async function catalog() {
  const shirt = await createProduct({ title: 'Oxford Shirt', price: 249_900 });
  const jeans = await createProduct({ title: 'Denim Jeans', price: 459_900 });
  await recordOpeningBalances(mongoose.connection.db!);
  await createPromotion(t.container.services, {
    name: 'Weekend Uniform',
    activation: 'auto',
    code: undefined,
    stackGroup: undefined,
    conditions: undefined,
    action: {
      type: 'fixedBundle',
      components: [
        { selector: { slugs: [shirt.slug] }, qty: 1 },
        { selector: { slugs: [jeans.slug] }, qty: 1 },
      ],
      price: 599_900,
    },
  });
  return { shirt, jeans };
}

const items = (...lines: Array<[{ _id: unknown }, number]>) => lines.map(([p, qty]) => ({ productId: String(p._id), size: 'M', qty }));

async function quote(token: string, body: Record<string, unknown>): Promise<PriceQuote> {
  return (await t.http().post(`${API}/pricing/quote`).set(bearer(token)).send(body).expect(200)).body;
}

function placeOrder(token: string, body: Record<string, unknown>) {
  return t
    .http()
    .post(`${API}/orders`)
    .set(bearer(token))
    .send({ address: ADDRESS, ...body });
}

describe('checkout with a price quote', () => {
  it('places the order at exactly the quoted price and records how it was priced', async () => {
    const buyer = await createUser();
    const { shirt, jeans } = await catalog();
    const cart = { items: items([shirt, 1], [jeans, 1]) };
    const q = await quote(buyer.token, cart);
    expect(q.breakdown.total).toBe(599_900);

    const order = (await placeOrder(buyer.token, { ...cart, quoteId: q.quoteId }).expect(201)).body;
    expect(order).toMatchObject({ subtotal: 709_800, discount: 109_900, shipping: 0, total: q.breakdown.total });
    expect(order.pricing).toMatchObject({
      quoteId: q.quoteId,
      applied: [{ name: 'Weekend Uniform', stage: 'bundle', amount: 109_900, version: 1 }],
      stages: { listSubtotal: 709_800, bundleDiscount: 109_900, total: 599_900 },
      optimizer: { strategy: 'branch-and-bound' },
    });
    expect(order.items.reduce((s: number, i: { lineTotal: number }) => s + i.lineTotal, 0)).toBe(order.subtotal - order.discount);
    for (const line of order.items) {
      expect(line.discounts.reduce((s: number, d: { amount: number }) => s + d.amount, 0)).toBe(line.price * line.qty - line.lineTotal);
    }
  });

  it('rejects an expired quote with 410 so the client can re-quote', async () => {
    const buyer = await createUser();
    const { shirt } = await catalog();
    const cart = { items: items([shirt, 1]) };
    const q = await quote(buyer.token, cart);
    await QuoteModel.updateOne({ _id: q.quoteId }, { $set: { expiresAt: new Date(Date.now() - 1_000) } });

    const res = await placeOrder(buyer.token, { ...cart, quoteId: q.quoteId }).expect(410);
    expect(res.body.code).toBe('QUOTE_EXPIRED');
  });

  it('rejects a quote for a different cart or customer', async () => {
    const buyer = await createUser();
    const other = await createUser();
    const { shirt } = await catalog();
    const q = await quote(buyer.token, { items: items([shirt, 1]) });

    const changed = await placeOrder(buyer.token, { items: items([shirt, 2]), quoteId: q.quoteId }).expect(409);
    expect(changed.body.code).toBe('QUOTE_CART_MISMATCH');
    await placeOrder(other.token, { items: items([shirt, 1]), quoteId: q.quoteId }).expect(403);
  });

  it('rejects with PRICE_CHANGED when the price moved after quoting, without reserving anything', async () => {
    const buyer = await createUser();
    const { shirt, jeans } = await catalog();
    const cart = { items: items([shirt, 1], [jeans, 1]) };
    const q = await quote(buyer.token, cart);
    await Product.updateOne({ _id: jeans._id }, { $set: { price: 499_900 } });

    const res = await placeOrder(buyer.token, { ...cart, quoteId: q.quoteId }).expect(409);
    expect(res.body.code).toBe('PRICE_CHANGED');
    expect(await Order.countDocuments()).toBe(0);
    expect(await Reservation.countDocuments()).toBe(0);

    const fresh = await quote(buyer.token, cart);
    const order = (await placeOrder(buyer.token, { ...cart, quoteId: fresh.quoteId }).expect(201)).body;
    expect(order.total).toBe(fresh.breakdown.total);
  });

  it('prices server-side when no quote is supplied, applying the same promotions', async () => {
    const buyer = await createUser();
    const { shirt, jeans } = await catalog();
    const cart = { items: items([shirt, 1], [jeans, 1]) };
    const q = await quote(buyer.token, cart);
    const order = (await placeOrder(buyer.token, cart).expect(201)).body;
    expect(order.total).toBe(q.breakdown.total);
    expect(order.pricing.quoteId).toBeUndefined();
    expect(order.pricing.applied.map((a: { name: string }) => a.name)).toEqual(['Weekend Uniform']);
  });
});
