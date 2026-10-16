import { describe, expect, it } from 'vitest';
import { ConflictError } from '../../core/errors';
import { Order, type PlaceOrderInput } from './order.aggregate';

const DAY = 86_400_000;
const t0 = new Date('2026-01-10T10:00:00Z');
const at = (ms: number) => new Date(t0.getTime() + ms);

const input = (overrides: Partial<PlaceOrderInput> = {}): PlaceOrderInput => ({
  orderNumber: 'SF-TEST1',
  userId: 'u1',
  items: [
    {
      productId: 'p1',
      title: 'Tee',
      price: 100_000,
      size: 'M',
      qty: 2,
      markdownPerUnit: 0,
      discounts: [{ promotionId: 'promo-1', amount: 20_000 }],
      lineTotal: 180_000,
    },
  ],
  address: { name: 'Asha', line1: '12 Road', city: 'Pune', state: 'MH', pincode: '411001', phone: '9876543210' },
  subtotal: 200_000,
  shipping: 9_900,
  discount: 20_000,
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
      payload: { orderNumber: 'SF-TEST1', total: 189_900, items: [{ productId: 'p1', size: 'M', qty: 2 }] },
    });
    expect(order.pullEvents()).toEqual([]);
  });

  it('refuses lines that do not add up to the discounted subtotal', () => {
    expect(() => Order.place(input({ discount: 10_000 }), t0)).toThrow(/do not add up/);
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
      payload: { reason: 'Changed my mind' },
    });
    expect(() => paidOrder().cancel('user:u1', 'x')).toThrow(/Illegal transition: paid → cancelled/);
  });

  it('walks the fulfilment path and stamps delivery', () => {
    const order = paidOrder();
    order.pack('admin:a');
    order.ship('admin:a');
    order.deliver('admin:a', '', at(DAY));
    expect(order.status).toBe('delivered');
    expect(order.snapshot().deliveredAt).toEqual(at(DAY));
    expect(order.snapshot().statusHistory.map(e => e.to)).toEqual(['created', 'paid', 'packed', 'shipped', 'delivered']);
  });

  it('runs the refund saga to completion', () => {
    const order = paidOrder();
    order.requestRefund({ by: 'user:u1', reason: 'Wrong size' }, at(DAY));
    expect(order.status).toBe('refund_requested');
    expect(order.openRefund).toMatchObject({
      status: 'requested',
      kind: 'full',
      amount: 189_900,
      shippingAmount: 9_900,
      lines: [{ productId: 'p1', size: 'M', qty: 2, amount: 180_000 }],
      previousStatus: 'paid',
      requestedBy: 'user:u1',
    });
    expect(order.pullEvents()).toEqual([
      expect.objectContaining({ name: 'RefundRequested', payload: expect.objectContaining({ previousStatus: 'paid' }) }),
    ]);

    expect(order.beginRefundSubmission()).toBe(true);
    expect(order.beginRefundSubmission()).toBe(false);
    order.markRefundPending('rfnd_1');
    expect(order.completeRefund({ by: 'system:webhook' }, at(2 * DAY))).toMatchObject({ status: 'processed', amount: 189_900 });
    expect(order.status).toBe('refunded');
    expect(order.refunds.at(-1)).toMatchObject({ status: 'processed', gatewayRefundId: 'rfnd_1', completedAt: at(2 * DAY) });
    expect(order.snapshot()).toMatchObject({ refundedAmount: 189_900, items: [{ refundedQty: 2, refundedAmount: 180_000 }] });
    expect(order.pullEvents()).toEqual([
      expect.objectContaining({ name: 'RefundCompleted', payload: expect.objectContaining({ fullyRefunded: true, amount: 189_900 }) }),
    ]);
    expect(order.completeRefund({ by: 'system:webhook' })).toBeNull();
  });

  it('compensates a failed refund by restoring the previous status', () => {
    const order = paidOrder();
    order.pack('admin:a');
    order.requestRefund({ by: 'user:u1', reason: 'Cancel please' });
    order.pullEvents();
    expect(order.failRefund({ by: 'system:webhook', reason: 'Bank rejected' })).toBe(true);
    expect(order.status).toBe('packed');
    expect(order.refunds.at(-1)).toMatchObject({ status: 'failed', failureReason: 'Bank rejected' });
    expect(order.openRefund).toBeUndefined();
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
    order.deliver('a', '', t0);
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
    expect(order.openRefund).toMatchObject({
      kind: 'full',
      amount: 189_900,
      previousStatus: 'cancelled',
      reason: 'Payment received after the order was cancelled',
    });
    expect(order.pullEvents().map(e => e.name)).toEqual(['RefundRequested']);
  });

  describe('per-line refunds', () => {
    const twoLines = (): PlaceOrderInput =>
      input({
        items: [
          {
            productId: 'tee',
            title: 'Tee',
            price: 100_000,
            size: 'M',
            qty: 3,
            markdownPerUnit: 0,
            discounts: [{ promotionId: 'x', amount: 49_999 }],
            lineTotal: 250_001,
          },
          { productId: 'cap', title: 'Cap', price: 50_000, size: 'One Size', qty: 1, markdownPerUnit: 0, discounts: [], lineTotal: 50_000 },
        ],
        subtotal: 350_000,
        discount: 49_999,
        shipping: 9_900,
      });
    const delivered = () => {
      const order = Order.place(twoLines(), t0);
      order.pay({ by: 'system:test', paymentId: 'pay_1' }, at(1_000));
      order.pack('a');
      order.ship('a');
      order.deliver('a', '', at(DAY));
      order.pullEvents();
      return order;
    };
    const settle = (order: Order) => {
      order.beginRefundSubmission();
      return order.completeRefund({ by: 'system:test' }, at(2 * DAY))!;
    };

    it('refunds individual units at their share of the line total, then the rest with shipping', () => {
      const order = delivered();
      expect(order.total).toBe(309_901);

      const first = order.requestRefund(
        { by: 'user:u1', reason: 'Too big', lines: [{ productId: 'tee', size: 'M', qty: 1 }] },
        at(2 * DAY),
      );
      expect(first).toMatchObject({ kind: 'partial', amount: 83_334, shippingAmount: 0, previousStatus: 'delivered' });
      expect(settle(order).lines).toEqual([{ productId: 'tee', size: 'M', qty: 1, amount: 83_334 }]);
      expect(order.status).toBe('partially_refunded');
      expect(order.pullEvents().at(-1)).toMatchObject({ name: 'RefundCompleted', payload: { fullyRefunded: false } });

      const second = order.requestRefund(
        { by: 'user:u1', reason: 'Also too big', lines: [{ productId: 'tee', size: 'M', qty: 2 }] },
        at(3 * DAY),
      );
      expect(second).toMatchObject({ kind: 'partial', amount: 166_667, previousStatus: 'partially_refunded' });
      settle(order);

      const last = order.requestRefund({ by: 'user:u1', reason: 'Return the cap too' }, at(4 * DAY));
      expect(last).toMatchObject({
        kind: 'full',
        amount: 59_900,
        shippingAmount: 9_900,
        lines: [{ productId: 'cap', qty: 1, amount: 50_000 }],
      });
      settle(order);

      expect(order.status).toBe('refunded');
      expect(order.refunds.reduce((sum, r) => sum + r.amount, 0)).toBe(order.total);
      expect(order.snapshot().refundedAmount).toBe(order.total);
      expect(order.items.map(i => [i.refundedQty, i.refundedAmount])).toEqual([
        [3, 250_001],
        [1, 50_000],
      ]);
    });

    it('treats a request covering every remaining unit as a full refund', () => {
      const order = delivered();
      const refund = order.requestRefund(
        {
          by: 'user:u1',
          reason: 'All of it',
          lines: [
            { productId: 'tee', size: 'M', qty: 3 },
            { productId: 'cap', size: 'One Size', qty: 1 },
          ],
        },
        at(2 * DAY),
      );
      expect(refund).toMatchObject({ kind: 'full', amount: order.total, shippingAmount: 9_900 });
    });

    it('rejects partial refunds before delivery and requests beyond what is left', () => {
      const paid = Order.place(twoLines(), t0);
      paid.pay({ by: 'system:test' });
      expect(() => paid.requestRefund({ by: 'u', reason: 'one', lines: [{ productId: 'cap', size: 'One Size', qty: 1 }] })).toThrow(
        /once the order is delivered/,
      );

      const order = delivered();
      expect(() => order.requestRefund({ by: 'u', reason: 'many', lines: [{ productId: 'tee', size: 'M', qty: 4 }] }, at(2 * DAY))).toThrow(
        /Only 3 of that item/,
      );
      expect(() =>
        order.requestRefund({ by: 'u', reason: 'ghost', lines: [{ productId: 'nope', size: 'M', qty: 1 }] }, at(2 * DAY)),
      ).toThrow(/no item nope/);
    });

    it('ignores a settlement for a different gateway refund', () => {
      const order = delivered();
      order.requestRefund({ by: 'u', reason: 'one', lines: [{ productId: 'cap', size: 'One Size', qty: 1 }] }, at(2 * DAY));
      order.beginRefundSubmission();
      order.markRefundPending('rfnd_current');
      expect(order.completeRefund({ by: 'system:webhook', gatewayRefundId: 'rfnd_older' })).toBeNull();
      expect(order.status).toBe('refund_requested');
      expect(order.completeRefund({ by: 'system:webhook', gatewayRefundId: 'rfnd_current' })).not.toBeNull();
    });
  });

  it('bumps the version only when persisted', () => {
    const order = Order.place(input(), t0);
    expect(order.version).toBe(0);
    order.markPersisted();
    expect(order.version).toBe(1);
    expect(order.toJSON()).toMatchObject({ _id: order.id, version: 1, status: 'created' });
  });
});
