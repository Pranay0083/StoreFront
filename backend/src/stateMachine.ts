import { ApiError } from './middleware';
import { Coupon, Order, OrderStatus, Product } from './models';

// Explicit order state machine — the single source of truth for transitions.
// created → paid → packed → shipped → delivered, with cancel/refund branches.
export const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  created: ['paid', 'cancelled'],
  paid: ['packed', 'cancelled', 'refunded'],
  packed: ['shipped', 'cancelled'],
  shipped: ['delivered'],
  delivered: ['refunded'],
  cancelled: ['refunded'],
  refunded: [],
};

export function assertTransition(from: OrderStatus, to: OrderStatus) {
  if (!TRANSITIONS[from]?.includes(to)) {
    throw new ApiError(409, `Illegal transition: ${from} → ${to}`);
  }
}

export async function transitionOrder(order: any, to: OrderStatus, by: string, note = '') {
  assertTransition(order.status, to);
  const from = order.status;
  order.status = to;
  order.statusHistory.push({ from, to, by, note, at: new Date() });
  if (to === 'paid') order.paidAt = new Date();
  await order.save();
  return order;
}

// Idempotent payment confirmation: safe against Razorpay webhook retries and
// double verify calls — only a 'created' order transitions and decrements stock.
export async function markOrderPaid(order: any, by: string, paymentInfo: Record<string, string>) {
  if (order.status !== 'created') return { order, alreadyProcessed: true };
  order.payment = { ...order.payment?.toObject?.() ?? order.payment, ...paymentInfo, status: 'captured' };
  await transitionOrder(order, 'paid', by, 'Payment captured');
  for (const item of order.items) {
    await Product.updateOne(
      { _id: item.productId, 'sizes.size': item.size },
      { $inc: { 'sizes.$.stock': -item.qty } }
    );
  }
  if (order.couponCode) {
    await Coupon.updateOne({ code: order.couponCode }, { $inc: { usedCount: 1 } });
  }
  return { order, alreadyProcessed: false };
}
