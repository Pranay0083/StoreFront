import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { Coupon, Order, Product } from '../src/models';
import { ADDRESS, createCoupon, createProduct, createUser } from './helpers/factories';
import { API, bearer, useTestApp } from './helpers/app';

const t = useTestApp();

async function setupOrder(withCoupon = false) {
  const buyer = await createUser();
  const product = await createProduct({ price: 2000 });
  if (withCoupon) await createCoupon();
  const order = (
    await t
      .http()
      .post(`${API}/orders`)
      .set(bearer(buyer.token))
      .send({ address: ADDRESS, items: [{ productId: String(product._id), size: 'M', qty: 2 }], ...(withCoupon ? { couponCode: 'WELCOME10' } : {}) })
      .expect(201)
  ).body;
  return { buyer, product, order };
}

const stockOf = async (productId: unknown, size: string) =>
  (await Product.findById(productId).lean())!.sizes.find(s => s.size === size)!.stock;

describe('payments (demo mode)', () => {
  it('reports demo mode when Razorpay keys are absent', async () => {
    const res = await t.http().get(`${API}/payments/config`).expect(200);
    expect(res.body).toEqual({ mode: 'demo', keyId: null });
  });

  it('confirms a demo payment exactly once', async () => {
    const { buyer, product, order } = await setupOrder(true);

    const setup = await t.http().post(`${API}/payments/create`).set(bearer(buyer.token)).send({ orderId: order._id }).expect(200);
    expect(setup.body).toMatchObject({ mode: 'demo', orderId: order._id, amount: order.total * 100 });

    const first = await t.http().post(`${API}/payments/demo-confirm`).set(bearer(buyer.token)).send({ orderId: order._id }).expect(200);
    expect(first.body).toMatchObject({ ok: true, alreadyProcessed: false });
    expect(first.body.order.status).toBe('paid');
    expect(await stockOf(product._id, 'M')).toBe(8);
    expect((await Coupon.findOne({ code: 'WELCOME10' }))!.usedCount).toBe(1);

    const second = await t.http().post(`${API}/payments/demo-confirm`).set(bearer(buyer.token)).send({ orderId: order._id }).expect(200);
    expect(second.body.alreadyProcessed).toBe(true);
    expect(await stockOf(product._id, 'M')).toBe(8);
    expect((await Coupon.findOne({ code: 'WELCOME10' }))!.usedCount).toBe(1);
  });

  it("refuses to pay someone else's order", async () => {
    const { order } = await setupOrder();
    const stranger = await createUser();
    await t.http().post(`${API}/payments/demo-confirm`).set(bearer(stranger.token)).send({ orderId: order._id }).expect(403);
  });
});

describe('payment webhook', () => {
  const sign = (body: string) => crypto.createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET!).update(body).digest('hex');

  it('rejects bad signatures and processes each event once', async () => {
    const { order } = await setupOrder();
    await Order.updateOne({ _id: order._id }, { $set: { 'payment.razorpayOrderId': 'order_rzp_1' } });
    const payload = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_1', order_id: 'order_rzp_1' } } } });

    await t.http().post(`${API}/payments/webhook`).set('Content-Type', 'application/json').set('x-razorpay-signature', 'bad').send(payload).expect(400);

    const headers = { 'Content-Type': 'application/json', 'x-razorpay-signature': sign(payload), 'x-razorpay-event-id': 'evt_1' };
    const first = await t.http().post(`${API}/payments/webhook`).set(headers).send(payload).expect(200);
    expect(first.body.status).toBe('processed');
    expect((await Order.findById(order._id))!.status).toBe('paid');

    const dup = await t.http().post(`${API}/payments/webhook`).set(headers).send(payload).expect(200);
    expect(dup.body.status).toBe('duplicate_ignored');
  });
});
