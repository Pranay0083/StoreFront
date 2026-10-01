import { describe, expect, it } from 'vitest';
import { OrderModel } from '../src/modules/orders/order.model';
import { ADDRESS, createProduct, createUser } from './helpers/factories';
import { API, bearer, useTestApp } from './helpers/app';

const t = useTestApp();

async function paidOrder(token: string, productId: string, qty = 1) {
  const order = (await t.http().post(`${API}/orders`).set(bearer(token)).send({ address: ADDRESS, items: [{ productId, size: 'M', qty }] }).expect(201)).body;
  await t.http().post(`${API}/payments/demo-confirm`).set(bearer(token)).send({ orderId: order._id }).expect(200);
  return order;
}

describe('admin dashboard', () => {
  it('is admin only', async () => {
    const customer = await createUser();
    await t.http().get(`${API}/admin/stats`).expect(401);
    await t.http().get(`${API}/admin/stats`).set(bearer(customer.token)).expect(403);
  });

  it('aggregates revenue, funnel, top products and low stock', async () => {
    const admin = await createUser({ role: 'admin' });
    const buyer = await createUser();
    const shirt = await createProduct({ title: 'Shirt', price: 1500 });
    const coat = await createProduct({ title: 'Coat', price: 5000, sizes: [{ size: 'M', stock: 3 }] });
    await paidOrder(buyer.token, String(shirt._id), 2);
    await paidOrder(buyer.token, String(coat._id));
    await t.http().post(`${API}/orders`).set(bearer(buyer.token)).send({ address: ADDRESS, items: [{ productId: String(shirt._id), size: 'M', qty: 1 }] }).expect(201);

    const stats = await t.http().get(`${API}/admin/stats`).set(bearer(admin.token)).expect(200);
    expect(stats.body).toMatchObject({ revenue: 3000 + 5000, paidOrders: 2, avgOrderValue: 4000, totalOrders: 3, customers: 1, pendingOrders: 2 });

    const funnel = await t.http().get(`${API}/admin/funnel`).set(bearer(admin.token)).expect(200);
    expect(funnel.body).toEqual([
      { stage: 'Active carts', count: 3 },
      { stage: 'Orders placed', count: 3 },
      { stage: 'Orders paid', count: 2 },
      { stage: 'Delivered', count: 0 },
    ]);

    const revenue = await t.http().get(`${API}/admin/revenue-by-day?days=7`).set(bearer(admin.token)).expect(200);
    expect(revenue.body).toHaveLength(1);
    expect(revenue.body[0]).toMatchObject({ revenue: 8000, orders: 2 });

    const top = await t.http().get(`${API}/admin/top-products`).set(bearer(admin.token)).expect(200);
    expect(top.body.map((r: { title: string }) => r.title)).toEqual(['Coat', 'Shirt']);

    const low = await t.http().get(`${API}/admin/low-stock?threshold=3`).set(bearer(admin.token)).expect(200);
    expect(low.body.map((r: { title: string; size: string; stock: number }) => [r.title, r.size, r.stock]).sort()).toEqual([
      ['Coat', 'M', 2],
      ['Shirt', 'L', 2],
    ]);
  });

  it('lists orders with the transition table and applies bulk transitions', async () => {
    const admin = await createUser({ role: 'admin' });
    const buyer = await createUser();
    const product = await createProduct();
    const paid = await paidOrder(buyer.token, String(product._id));
    const fresh = (await t.http().post(`${API}/orders`).set(bearer(buyer.token)).send({ address: ADDRESS, items: [{ productId: String(product._id), size: 'M', qty: 1 }] }).expect(201)).body;

    const list = await t.http().get(`${API}/admin/orders?status=paid`).set(bearer(admin.token)).expect(200);
    expect(list.body).toMatchObject({ total: 1, page: 1, pages: 1 });
    expect(list.body.transitions.paid).toEqual(['packed', 'cancelled', 'refunded']);

    const res = await t
      .http()
      .post(`${API}/admin/orders/bulk-transition`)
      .set(bearer(admin.token))
      .send({ ids: [paid._id, fresh._id, '64b7f0c2a1b2c3d4e5f60718'], to: 'packed' })
      .expect(200);
    expect(res.body.updated).toBe(1);
    expect(res.body.rejected).toEqual([
      { id: fresh.orderNumber, reason: 'Illegal transition: created → packed' },
      { id: '64b7f0c2a1b2c3d4e5f60718', reason: 'Not found' },
    ]);
    const packed = await OrderModel.findById(paid._id).lean();
    expect(packed!.status).toBe('packed');
    expect(packed!.statusHistory.at(-1)).toMatchObject({ from: 'paid', to: 'packed', by: `admin:${admin.id}`, note: 'Bulk action' });
  });
});
