import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { describe, expect, it } from 'vitest';
import { OutboxModel } from '../src/core/events/outbox.model';
import { ProductModel as Product } from '../src/modules/catalog/product.model';
import { InventoryMovementModel as Movement } from '../src/modules/inventory/inventory-movement.model';
import { recordOpeningBalances } from '../src/modules/inventory/opening-balances';
import { OrderModel as Order } from '../src/modules/orders/order.model';
import { ADDRESS, createProduct, createUser } from './helpers/factories';
import { API, bearer, useTestApp } from './helpers/app';

process.env.RAZORPAY_KEY_ID = 'rzp_test_race';
process.env.RAZORPAY_KEY_SECRET = 'race-key-secret';

const t = useTestApp();

const hmac = (secret: string, data: string) => crypto.createHmac('sha256', secret).update(data).digest('hex');

async function placeRazorpayOrder(razorpayOrderId: string, qty = 2) {
  const buyer = await createUser();
  const product = await createProduct({ sizes: [{ size: 'M', stock: 10 }] });
  await recordOpeningBalances(mongoose.connection.db!);
  const order = (
    await t
      .http()
      .post(`${API}/orders`)
      .set(bearer(buyer.token))
      .send({ address: ADDRESS, items: [{ productId: String(product._id), size: 'M', qty }] })
      .expect(201)
  ).body;
  await Order.updateOne({ _id: order._id }, { $set: { 'payment.provider': 'razorpay', 'payment.razorpayOrderId': razorpayOrderId } });
  return { buyer, product, order };
}

describe('payment confirmation races (Razorpay mode)', () => {
  it('applies a payment exactly once when client verification races the webhook', async () => {
    const { buyer, product, order } = await placeRazorpayOrder('order_rzp_race');
    const verifyBody = {
      orderId: order._id,
      razorpay_order_id: 'order_rzp_race',
      razorpay_payment_id: 'pay_race',
      razorpay_signature: hmac('race-key-secret', 'order_rzp_race|pay_race'),
    };
    const webhookPayload = JSON.stringify({
      event: 'payment.captured',
      payload: { payment: { entity: { id: 'pay_race', order_id: 'order_rzp_race' } } },
    });
    const webhookSig = hmac(process.env.RAZORPAY_WEBHOOK_SECRET!, webhookPayload);

    const requests = Array.from({ length: 8 }, (_, i) =>
      i % 2 === 0
        ? t.http().post(`${API}/payments/verify`).set(bearer(buyer.token)).send(verifyBody)
        : t
            .http()
            .post(`${API}/payments/webhook`)
            .set({ 'Content-Type': 'application/json', 'x-razorpay-signature': webhookSig, 'x-razorpay-event-id': `evt_race_${i}` })
            .send(webhookPayload),
    );
    const responses = await Promise.all(requests);
    expect(responses.map(r => r.status)).toEqual(Array(8).fill(200));

    const saved = (await Order.findById(order._id).lean())!;
    expect(saved.status).toBe('paid');
    expect(saved.statusHistory.filter(e => e.to === 'paid')).toHaveLength(1);
    expect(saved.payment).toMatchObject({ status: 'captured', razorpayPaymentId: 'pay_race' });

    expect(await Movement.countDocuments({ orderId: order._id, type: 'SALE' })).toBe(1);
    expect(await OutboxModel.countDocuments({ aggregateId: order._id, name: 'OrderPaid' })).toBe(1);
    expect((await Product.findById(product._id).lean())!.sizes[0].stock).toBe(8);
    expect(await t.container.services.inventory.reconcile()).toMatchObject({ ok: true });
  });

  it("rejects a valid signature that belongs to a different order's payment", async () => {
    const { buyer, order } = await placeRazorpayOrder('order_rzp_expensive');
    const res = await t
      .http()
      .post(`${API}/payments/verify`)
      .set(bearer(buyer.token))
      .send({
        orderId: order._id,
        razorpay_order_id: 'order_rzp_cheap',
        razorpay_payment_id: 'pay_cheap',
        razorpay_signature: hmac('race-key-secret', 'order_rzp_cheap|pay_cheap'),
      })
      .expect(400);
    expect(res.body.error).toBe('Invalid payment signature');
    expect((await Order.findById(order._id).lean())!.status).toBe('created');
  });

  it('refunds a capture that arrives after the reservation expired', async () => {
    const { order, product } = await placeRazorpayOrder('order_rzp_late', 3);
    expect(await t.container.services.reservationSweeper.sweep(new Date(Date.now() + 60 * 60_000))).toBe(1);
    expect((await Product.findById(product._id).lean())!.sizes[0].stock).toBe(10);

    const payload = JSON.stringify({
      event: 'payment.captured',
      payload: { payment: { entity: { id: 'pay_late', order_id: 'order_rzp_late' } } },
    });
    await t
      .http()
      .post(`${API}/payments/webhook`)
      .set({ 'Content-Type': 'application/json', 'x-razorpay-signature': hmac(process.env.RAZORPAY_WEBHOOK_SECRET!, payload) })
      .send(payload)
      .expect(200);

    const saved = (await Order.findById(order._id).lean())!;
    expect(saved.status).toBe('refund_requested');
    expect(saved.payment).toMatchObject({ status: 'captured', razorpayPaymentId: 'pay_late' });
    expect(saved.refunds).toEqual([expect.objectContaining({ previousStatus: 'cancelled', status: 'requested', kind: 'full' })]);
    expect((await Product.findById(product._id).lean())!.sizes[0].stock).toBe(10);
  });
});
