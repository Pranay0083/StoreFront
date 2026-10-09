import { describe, expect, it } from 'vitest';
import { CartModel as Cart } from '../src/modules/cart/cart.model';
import { OrderModel as Order } from '../src/modules/orders/order.model';
import { ADDRESS, createCoupon, createProduct, createUser } from './helpers/factories';
import { API, bearer, useTestApp } from './helpers/app';

const t = useTestApp();

function placeOrder(token: string, body: Record<string, unknown>) {
  return t
    .http()
    .post(`${API}/orders`)
    .set(bearer(token))
    .send({ address: ADDRESS, ...body });
}

describe('orders', () => {
  it('creates an order from current product prices and clears the cart', async () => {
    const buyer = await createUser();
    const product = await createProduct({ price: 100_000 });
    await Cart.create({
      userId: buyer.user._id,
      items: [{ productId: product._id, title: product.title, price: 100_000, size: 'M', qty: 2, slug: product.slug }],
    });

    const res = await placeOrder(buyer.token, { items: [{ productId: String(product._id), size: 'M', qty: 2 }] }).expect(201);
    expect(res.body).toMatchObject({ subtotal: 200_000, shipping: 9_900, discount: 0, total: 209_900, status: 'created' });
    expect(res.body.orderNumber).toMatch(/^SF-/);
    expect(res.body.items[0]).toMatchObject({ title: product.title, price: 100_000, qty: 2, size: 'M' });
    expect(res.body.statusHistory).toEqual([expect.objectContaining({ from: null, to: 'created', note: 'Order placed' })]);
    expect((await Cart.findOne({ userId: buyer.user._id }))!.items).toHaveLength(0);
  });

  it('applies coupons and free shipping above the threshold', async () => {
    const buyer = await createUser();
    const product = await createProduct({ price: 400_000 });
    await createCoupon();
    const res = await placeOrder(buyer.token, {
      items: [{ productId: String(product._id), size: 'M', qty: 1 }],
      couponCode: 'welcome10',
    }).expect(201);
    expect(res.body).toMatchObject({ subtotal: 400_000, discount: 40_000, shipping: 0, total: 360_000, couponCode: 'WELCOME10' });
  });

  it('rejects unavailable sizes and insufficient stock', async () => {
    const buyer = await createUser();
    const product = await createProduct();
    await placeOrder(buyer.token, { items: [{ productId: String(product._id), size: 'XXL', qty: 1 }] }).expect(400);
    const res = await placeOrder(buyer.token, { items: [{ productId: String(product._id), size: 'L', qty: 3 }] }).expect(409);
    expect(res.body.error).toMatch(/Only 2 left/);
  });

  it('scopes order reads to the owner or staff with orders:read', async () => {
    const buyer = await createUser();
    const other = await createUser();
    const admin = await createUser({ role: 'admin' });
    const support = await createUser({ role: 'support' });
    const catalogManager = await createUser({ role: 'catalog_manager' });
    const product = await createProduct();
    const order = (await placeOrder(buyer.token, { items: [{ productId: String(product._id), size: 'M', qty: 1 }] }).expect(201)).body;

    const mine = await t.http().get(`${API}/orders`).set(bearer(buyer.token)).expect(200);
    expect(mine.body).toHaveLength(1);
    await t.http().get(`${API}/orders/${order._id}`).set(bearer(other.token)).expect(403);
    await t.http().get(`${API}/orders/${order._id}`).set(bearer(admin.token)).expect(200);
    await t.http().get(`${API}/orders/${order._id}`).set(bearer(support.token)).expect(200);
    await t.http().get(`${API}/orders/${order._id}`).set(bearer(catalogManager.token)).expect(403);
  });

  it('lets the customer cancel and rejects illegal transitions', async () => {
    const buyer = await createUser();
    const product = await createProduct();
    const order = (await placeOrder(buyer.token, { items: [{ productId: String(product._id), size: 'M', qty: 1 }] }).expect(201)).body;

    const cancelled = await t.http().post(`${API}/orders/${order._id}/cancel`).set(bearer(buyer.token)).expect(200);
    expect(cancelled.body.status).toBe('cancelled');
    expect(cancelled.body.statusHistory.at(-1)).toMatchObject({ from: 'created', to: 'cancelled', by: `user:${buyer.id}` });

    const again = await t.http().post(`${API}/orders/${order._id}/cancel`).set(bearer(buyer.token)).expect(409);
    expect(again.body.error).toMatch(/Illegal transition/);
    expect((await Order.findById(order._id))!.status).toBe('cancelled');
  });
});
