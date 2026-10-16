import type { mongo } from 'mongoose';
import type { Migration } from '../migration';

interface LegacyItem {
  productId: mongo.ObjectId;
  size: string;
  qty: number;
  price: number;
  lineTotal?: number;
  discounts?: Array<{ promotionId: string; amount: number }>;
  markdownPerUnit?: number;
  refundedQty?: number;
  refundedAmount?: number;
}

interface LegacyRefund {
  status: string;
  amount: number;
  [key: string]: unknown;
}

interface LegacyOrder {
  _id: mongo.ObjectId;
  items: LegacyItem[];
  shipping?: number;
  discount?: number;
  couponCode?: string;
  refund?: LegacyRefund;
  refunds?: unknown[];
  refundedAmount?: number;
}

/** Splits `amount` across weights proportionally, giving leftover paise to the largest remainders. */
export function allocate(amount: number, weights: readonly number[]): number[] {
  const total = weights.reduce((s, w) => s + w, 0);
  if (amount <= 0 || total <= 0) return weights.map(() => 0);
  const exact = weights.map(w => (amount * w) / total);
  const shares = exact.map(Math.floor);
  let left = amount - shares.reduce((s, v) => s + v, 0);
  const order = exact.map((e, i) => [e - Math.floor(e), i] as const).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (const [, i] of order) {
    if (left-- <= 0) break;
    shares[i] += 1;
  }
  return shares;
}

/**
 * Orders from before per-line pricing get a paid total per line (the order discount allocated by
 * line value), and a legacy single `refund` becomes a full refund entry in `refunds` covering every
 * line, so line-level refunds and their amounts work for old orders too.
 */
export const lineRefunds: Migration = {
  id: '042-line-refunds',
  description: 'Backfill per-line paid totals and convert legacy single refunds into refund entries',
  async up(db: mongo.Db) {
    const orders = db.collection<LegacyOrder>('orders');
    const cursor = orders.find({
      $or: [{ 'items.lineTotal': { $exists: false } }, { refund: { $exists: true } }, { refunds: { $exists: false } }],
    });
    for await (const order of cursor) {
      const needsLines = order.items.some(i => i.lineTotal === undefined);
      const shares = needsLines
        ? allocate(
            order.discount ?? 0,
            order.items.map(i => i.price * i.qty),
          )
        : [];
      const legacyId = order.couponCode ? `legacy-coupon:${order.couponCode}` : 'legacy-discount';
      const refunded = order.refund?.status === 'processed';

      const items = order.items.map((item, i) => {
        const lineTotal = item.lineTotal ?? item.price * item.qty - shares[i];
        return {
          ...item,
          markdownPerUnit: item.markdownPerUnit ?? 0,
          discounts: item.discounts ?? (shares[i] ? [{ promotionId: legacyId, amount: shares[i] }] : []),
          lineTotal,
          refundedQty: refunded ? item.qty : (item.refundedQty ?? 0),
          refundedAmount: refunded ? lineTotal : (item.refundedAmount ?? 0),
        };
      });

      const refunds = order.refunds ?? [];
      if (order.refund) {
        refunds.push({
          ...order.refund,
          id: order._id.toHexString(),
          kind: 'full',
          lines: items.map(i => ({ productId: String(i.productId), size: i.size, qty: i.qty, amount: i.lineTotal })),
          shippingAmount: order.shipping ?? 0,
        });
      }

      await orders.updateOne(
        { _id: order._id },
        {
          $set: { items, refunds, refundedAmount: refunded ? (order.refund?.amount ?? 0) : (order.refundedAmount ?? 0) },
          $unset: { refund: '' },
        },
      );
    }

    const exists = (await db.listCollections({ name: 'orders' }, { nameOnly: true }).toArray()).length > 0;
    if (exists && (await orders.indexes()).some(i => i.name === 'refund.gatewayRefundId_1')) {
      await orders.dropIndex('refund.gatewayRefundId_1');
    }
    await orders.createIndex({ 'refunds.gatewayRefundId': 1 }, { sparse: true });
  },
};
