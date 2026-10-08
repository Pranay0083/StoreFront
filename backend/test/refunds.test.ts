import mongoose from 'mongoose';
import { describe, expect, it, vi } from 'vitest';
import { OutboxModel } from '../src/core/events/outbox.model';
import { logger } from '../src/core/logger';
import { ProductModel as Product } from '../src/modules/catalog/product.model';
import { InventoryMovementModel as Movement } from '../src/modules/inventory/inventory-movement.model';
import { recordOpeningBalances } from '../src/modules/inventory/opening-balances';
import { OrderModel as Order } from '../src/modules/orders/order.model';
import { PermanentGatewayError, type PaymentGateway, type RefundResult } from '../src/modules/payments/gateways/payment-gateway';
import { PaymentsService } from '../src/modules/payments/payments.service';
import { RefundSaga } from '../src/modules/payments/refund.saga';
import { WebhookEventRepository } from '../src/modules/payments/webhook-event.repository';
import { ADDRESS, createProduct, createUser } from './helpers/factories';
import { API, bearer, useTestApp } from './helpers/app';

const t = useTestApp();
const DAY = 86_400_000;

const stockOf = async (productId: unknown) => (await Product.findById(productId).lean())!.sizes.find(s => s.size === 'M')!.stock;
const drain = () => t.container.services.relay.drain();
const statusOf = async (id: string) => (await Order.findById(id).lean())!.status;

async function paidOrder(qty = 2) {
  const buyer = await createUser();
  const product = await createProduct();
  await recordOpeningBalances(mongoose.connection.db!);
  const order = (
    await t
      .http()
      .post(`${API}/orders`)
      .set(bearer(buyer.token))
      .send({ address: ADDRESS, items: [{ productId: String(product._id), size: 'M', qty }] })
      .expect(201)
  ).body;
  await t.http().post(`${API}/payments/demo-confirm`).set(bearer(buyer.token)).send({ orderId: order._id }).expect(200);
  await drain();
  return { buyer, product, order };
}

async function advance(orderId: string, ...steps: Array<'packed' | 'shipped' | 'delivered'>) {
  for (const step of steps) await t.container.services.orders.adminTransition(orderId, step, 'admin-1');
}

function fakeGateway(refund: () => Promise<RefundResult>): PaymentGateway {
  return {
    name: 'razorpay',
    publicConfig: () => ({ mode: 'razorpay', keyId: 'rzp_test' }),
    createPayment: vi.fn(),
    verifyPayment: () => true,
    refund: vi.fn(refund),
    verifyWebhook: () => true,
  };
}

const sagaWith = (gateway: PaymentGateway) => new RefundSaga(t.container.services.orders, t.container.services.inventory, gateway, logger);

describe('refund saga (demo gateway)', () => {
  it('refunds a paid order cancelled by the customer and releases its stock', async () => {
    const { buyer, product, order } = await paidOrder(3);
    expect(await stockOf(product._id)).toBe(7);

    const res = await t.http().post(`${API}/orders/${order._id}/cancel`).set(bearer(buyer.token)).expect(200);
    expect(res.body).toMatchObject({
      status: 'refund_requested',
      refund: { status: 'requested', previousStatus: 'paid', amount: order.total },
    });

    await drain();
    const refunded = (await Order.findById(order._id).lean())!;
    expect(refunded.status).toBe('refunded');
    expect(refunded.refund).toMatchObject({ status: 'processed', gatewayRefundId: `demo_rfnd_${order._id}` });
    expect(await stockOf(product._id)).toBe(10);
    expect((await Movement.find({ orderId: order._id }).sort({ createdAt: 1 }).lean()).map(m => m.type)).toEqual([
      'RESERVE',
      'SALE',
      'RELEASE',
    ]);
    expect((await OutboxModel.find({ aggregateId: order._id }).sort({ occurredAt: 1 }).lean()).map(e => e.name)).toEqual([
      'OrderPlaced',
      'OrderPaid',
      'RefundRequested',
      'RefundCompleted',
    ]);
    expect(await t.container.services.inventory.reconcile()).toMatchObject({ ok: true });
  });

  it('accepts post-delivery refund requests inside the window and restocks as returns', async () => {
    const { buyer, product, order } = await paidOrder(1);
    await advance(order._id, 'packed', 'shipped', 'delivered');

    await t.http().post(`${API}/orders/${order._id}/refund`).set(bearer(buyer.token)).send({ reason: 'Did not fit' }).expect(200);
    await drain();

    expect(await statusOf(order._id)).toBe('refunded');
    expect(await stockOf(product._id)).toBe(10);
    expect(await Movement.findOne({ orderId: order._id, type: 'RETURN' }).lean()).toMatchObject({ delta: 1 });
  });

  it('rejects refund requests after the window and for shipments in transit', async () => {
    const { buyer, order } = await paidOrder(1);
    await advance(order._id, 'packed', 'shipped');
    const inTransit = await t
      .http()
      .post(`${API}/orders/${order._id}/refund`)
      .set(bearer(buyer.token))
      .send({ reason: 'Too slow' })
      .expect(409);
    expect(inTransit.body.error).toMatch(/shipped → refund_requested/);

    await advance(order._id, 'delivered');
    await Order.updateOne({ _id: order._id }, { $set: { deliveredAt: new Date(Date.now() - 8 * DAY) } });
    const late = await t
      .http()
      .post(`${API}/orders/${order._id}/refund`)
      .set(bearer(buyer.token))
      .send({ reason: 'Changed mind' })
      .expect(409);
    expect(late.body.error).toBe('The 7-day refund window for this order has closed');

    const other = await createUser();
    await t.http().post(`${API}/orders/${order._id}/refund`).set(bearer(other.token)).send({ reason: 'Not mine' }).expect(403);
  });

  it('lets admins issue refunds regardless of the window', async () => {
    const admin = await createUser({ role: 'admin' });
    const { order } = await paidOrder();
    await advance(order._id, 'packed', 'shipped', 'delivered');
    await Order.updateOne({ _id: order._id }, { $set: { deliveredAt: new Date(Date.now() - 30 * DAY) } });

    await t
      .http()
      .post(`${API}/admin/orders/bulk-transition`)
      .set(bearer(admin.token))
      .send({ ids: [order._id], to: 'refund_requested' })
      .expect(200);
    await drain();
    expect(await statusOf(order._id)).toBe('refunded');
  });
});

describe('refund saga (asynchronous gateway)', () => {
  it('waits for the refund webhook, then settles and restocks exactly once', async () => {
    const { buyer, product, order } = await paidOrder(2);
    await Order.updateOne({ _id: order._id }, { $set: { 'payment.razorpayPaymentId': 'pay_async' } });
    const gateway = fakeGateway(async () => ({ refundId: 'rfnd_async', status: 'pending' }));
    const saga = sagaWith(gateway);

    await t.http().post(`${API}/orders/${order._id}/cancel`).set(bearer(buyer.token)).expect(200);
    await saga.submit(order._id);
    await saga.submit(order._id);
    expect(gateway.refund).toHaveBeenCalledTimes(1);
    expect(gateway.refund).toHaveBeenCalledWith(expect.objectContaining({ paymentId: 'pay_async', amount: order.total }));
    expect((await Order.findById(order._id).lean())!.refund).toMatchObject({ status: 'pending', gatewayRefundId: 'rfnd_async' });
    expect(await stockOf(product._id)).toBe(8);

    const payments = new PaymentsService(gateway, t.container.services.orders, new WebhookEventRepository(), saga);
    const body = {
      event: 'refund.processed',
      payload: { refund: { entity: { id: 'rfnd_async', payment_id: 'pay_async', status: 'processed' } } },
    };
    const send = (eventId: string) =>
      payments.handleWebhook({ rawBody: Buffer.from(JSON.stringify(body)), signature: 'sig', eventId, payload: body });
    await expect(send('evt_r1')).resolves.toEqual({ status: 'processed' });
    await expect(send('evt_r1')).resolves.toEqual({ status: 'duplicate_ignored' });
    await expect(send('evt_r2')).resolves.toEqual({ status: 'processed' });

    expect(await statusOf(order._id)).toBe('refunded');
    expect(await stockOf(product._id)).toBe(10);
    expect(await Movement.countDocuments({ orderId: order._id, type: 'RELEASE' })).toBe(1);
  });

  it('compensates when the provider reports the refund failed', async () => {
    const { buyer, product, order } = await paidOrder(2);
    await advance(order._id, 'packed');
    const gateway = fakeGateway(async () => ({ refundId: 'rfnd_fail', status: 'pending' }));
    const saga = sagaWith(gateway);
    await t.http().post(`${API}/orders/${order._id}/cancel`).set(bearer(buyer.token)).expect(200);
    await saga.submit(order._id);

    const payments = new PaymentsService(gateway, t.container.services.orders, new WebhookEventRepository(), saga);
    const body = {
      event: 'refund.failed',
      payload: { refund: { entity: { id: 'rfnd_fail', payment_id: 'x', status: 'failed', error_description: 'Account closed' } } },
    };
    await payments.handleWebhook({ rawBody: Buffer.from('{}'), signature: 'sig', eventId: 'evt_f1', payload: body });

    const restored = (await Order.findById(order._id).lean())!;
    expect(restored.status).toBe('packed');
    expect(restored.refund).toMatchObject({ status: 'failed', failureReason: 'Account closed' });
    expect(restored.statusHistory.at(-1)).toMatchObject({ from: 'refund_requested', to: 'packed', note: 'Refund failed: Account closed' });
    expect(await stockOf(product._id)).toBe(8);
  });

  it('retries transient gateway errors and compensates permanent rejections', async () => {
    const { buyer, order } = await paidOrder();
    let calls = 0;
    const flaky = fakeGateway(async () => {
      if (++calls === 1) throw Object.assign(new Error('gateway timeout'), { statusCode: 504 });
      return { refundId: 'rfnd_retry', status: 'processed' };
    });
    await t.http().post(`${API}/orders/${order._id}/cancel`).set(bearer(buyer.token)).expect(200);
    await expect(sagaWith(flaky).submit(order._id, { attempt: 1, maxAttempts: 5 })).rejects.toThrow('gateway timeout');
    expect((await Order.findById(order._id).lean())!.refund!.status).toBe('requested');
    await sagaWith(flaky).submit(order._id, { attempt: 2, maxAttempts: 5 });
    expect(await statusOf(order._id)).toBe('refunded');

    const second = await paidOrder();
    await t.http().post(`${API}/orders/${second.order._id}/cancel`).set(bearer(second.buyer.token)).expect(200);
    const rejecting = fakeGateway(async () => {
      throw new PermanentGatewayError('The refund amount exceeds the payment');
    });
    await sagaWith(rejecting).submit(second.order._id);
    const restored = (await Order.findById(second.order._id).lean())!;
    expect(restored.status).toBe('paid');
    expect(restored.refund).toMatchObject({ status: 'failed', failureReason: 'The refund amount exceeds the payment' });
  });
});
