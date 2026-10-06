import { describe, expect, it } from 'vitest';
import { ConflictError } from '../../core/errors';
import { Order, type PlaceOrderInput } from './order.aggregate';

const DAY = 86_400_000;
const t0 = new Date('2026-01-10T10:00:00Z');
const at = (ms: number) => new Date(t0.getTime() + ms);

const input = (overrides: Partial<PlaceOrderInput> = {}): PlaceOrderInput => ({
  orderNumber: 'SF-TEST1',
  userId: 'u1',
  items: [{ productId: 'p1', title: 'Tee', price: 100_000, size: 'M', qty: 2 }],
  address: { name: 'Asha', line1: '12 Road', city: 'Pune', state: 'MH', pincode: '411001', phone: '9876543210' },
  subtotal: 200_000,
  shipping: 9_900,
  discount: 20_000,
  couponCode: 'WELCOME10',
  reservedUntil: at(15 * 60_000),
  ...overrides,
});

const paidOrder = () => {
  const order = Order.place(input(), t0);
  order.pay({ by: 'system:test', paymentId: 'pay_1', provider: 'razorpay' }, at(1_000));
  order.pullEvents();
  return order;
};

describe('Order aggregate', () => {
  it('places an order with computed total, audit trail and an OrderPlaced event', () => {
    const order = Order.place(input(), t0);
    expect(order.status).toBe('created');
    expect(order.total).toBe(189_900);
    expect(order.snapshot().statusHistory).toEqual([{ from: null, to: 'created', by: 'user:u1', note: 'Order placed', at: t0 }]);
    const [event] = order.pullEvents();
    expect(event).toMatchObject({
      name: 'OrderPlaced',
      aggregateId: order.id,
      payload: { orderNumber: 'SF-TEST1', total: 189_900, couponCode: 'WELCOME10', items: [{ productId: 'p1', size: 'M', qty: 2 }] },
    });
    expect(order.pullEvents()).toEqual([]);
  });

  it('captures payment, clears the reservation deadline and emits OrderPaid', () => {
    const order = Order.place(input(), t0);
    order.pullEvents();
    order.pay({ by: 'system:webhook', paymentId: 'pay_9', provider: 'razorpay' }, at(5_000));
    expect(order.status).toBe('paid');
    expect(order.payment).toMatchObject({ status: 'captured', razorpayPaymentId: 'pay_9', provider: 'razorpay', capturedAt: at(5_000) });
    expect(order.snapshot().paidAt).toEqual(at(5_000));
    expect(order.snapshot().reservedUntil).toBeUndefined();
    expect(order.pullEvents().map(e => e.name)).toEqual(['OrderPaid']);
    expect(() => order.pay({ by: 'again' })).toThrowError(ConflictError);
  });

  it('only cancels unpaid orders', () => {
    const order = Order.place(input(), t0);
    order.cancel('user:u1', 'Changed my mind');
    expect(order.status).toBe('cancelled');
    expect(order.pullEvents().at(-1)).toMatchObject({
      name: 'OrderCancelled',
      payload: { reason: 'Changed my mind', couponCode: 'WELCOME10' },
    });
    expect(() => paidOrder().cancel('user:u1', 'x')).toThrow(/Illegal transition: paid → cancelled/);
  });

  it('walks the fulfilment path and stamps delivery', () => {
    const order = paidOrder();
    order.pack('admin:a');
    order.ship('admin:a');
    order.deliver('admin:a', at(DAY));
    expect(order.status).toBe('delivered');
    expect(order.snapshot().deliveredAt).toEqual(at(DAY));
    expect(order.snapshot().statusHistory.map(e => e.to)).toEqual(['created', 'paid', 'packed', 'shipped', 'delivered']);
  });

  it('runs the refund saga to completion', () => {
    const order = paidOrder();
    order.requestRefund({ by: 'user:u1', reason: 'Wrong size' }, at(DAY));
    expect(order.status).toBe('refund_requested');
    expect(order.refund).toMatchObject({ status: 'requested', amount: 189_900, previousStatus: 'paid', requestedBy: 'user:u1' });
    expect(order.pullEvents()).toEqual([
      expect.objectContaining({ name: 'RefundRequested', payload: expect.objectContaining({ previousStatus: 'paid' }) }),
    ]);

    expect(order.beginRefundSubmission()).toBe(true);
    expect(order.beginRefundSubmission()).toBe(false);
    order.markRefundPending('rfnd_1');
    expect(order.completeRefund({ by: 'system:webhook' }, at(2 * DAY))).toBe(true);
    expect(order.status).toBe('refunded');
    expect(order.refund).toMatchObject({ status: 'processed', gatewayRefundId: 'rfnd_1', completedAt: at(2 * DAY) });
    expect(order.pullEvents().map(e => e.name)).toEqual(['RefundCompleted']);
    expect(order.completeRefund({ by: 'system:webhook' })).toBe(false);
  });

  it('compensates a failed refund by restoring the previous status', () => {
    const order = paidOrder();
    order.pack('admin:a');
    order.requestRefund({ by: 'user:u1', reason: 'Cancel please' });
    order.pullEvents();
    expect(order.failRefund({ by: 'system:webhook', reason: 'Bank rejected' })).toBe(true);
    expect(order.status).toBe('packed');
    expect(order.refund).toMatchObject({ status: 'failed', failureReason: 'Bank rejected' });
    expect(order.snapshot().statusHistory.at(-1)).toMatchObject({
      from: 'refund_requested',
      to: 'packed',
      note: 'Refund failed: Bank rejected',
    });
    expect(order.pullEvents()).toEqual([
      expect.objectContaining({ name: 'RefundFailed', payload: expect.objectContaining({ restoredStatus: 'packed' }) }),
    ]);
    expect(order.failRefund({ by: 'x', reason: 'again' })).toBe(false);
  });

  it('enforces the post-delivery refund window', () => {
    const order = paidOrder();
    order.pack('a');
    order.ship('a');
    order.deliver('a', t0);
    expect(() => order.requestRefund({ by: 'user:u1', reason: 'Late' }, at(8 * DAY))).toThrow(/7-day refund window/);
    order.requestRefund({ by: 'user:u1', reason: 'Fine' }, at(6 * DAY));
    expect(order.status).toBe('refund_requested');
    expect(order.restockKind()).toBe('RETURN');
  });

  it('refuses refunds for unpaid or in-transit orders', () => {
    expect(() => Order.place(input(), t0).requestRefund({ by: 'u', reason: 'no' })).toThrow(/Only paid orders/);
    const shipped = paidOrder();
    shipped.pack('a');
    shipped.ship('a');
    expect(() => shipped.requestRefund({ by: 'u', reason: 'no' })).toThrow(/Illegal transition: shipped → refund_requested/);
    expect(paidOrder().restockKind()).toBe('RELEASE');
  });

  it('turns a capture on a cancelled order into an automatic refund', () => {
    const order = Order.place(input(), t0);
    order.cancel('system:reservation-expiry', 'Payment window expired');
    order.pullEvents();
    order.acceptLatePayment({ by: 'system:webhook', paymentId: 'pay_late' });
    expect(order.status).toBe('refund_requested');
    expect(order.payment.status).toBe('captured');
    expect(order.refund).toMatchObject({ previousStatus: 'cancelled', reason: 'Payment received after the order was cancelled' });
    expect(order.pullEvents().map(e => e.name)).toEqual(['RefundRequested']);
  });

  it('bumps the version only when persisted', () => {
    const order = Order.place(input(), t0);
    expect(order.version).toBe(0);
    order.markPersisted();
    expect(order.version).toBe(1);
    expect(order.toJSON()).toMatchObject({ _id: order.id, version: 1, status: 'created' });
  });
});
