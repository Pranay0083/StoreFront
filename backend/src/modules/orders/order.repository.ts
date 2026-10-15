import { REVENUE_STATUSES, type OrderStatus } from '@storefront/contracts';
import type { FilterQuery, Types } from 'mongoose';
import { ConflictError } from '../../core/errors';
import type { Session } from '../../core/persistence/transaction';
import { Order, type OrderProps } from './order.aggregate';
import { OrderModel, type OrderRecord } from './order.model';

export interface RevenueSummary {
  revenue: number;
  orders: number;
  avg: number;
}

export interface TopProductRow {
  _id: Types.ObjectId;
  title: string;
  image?: string;
  units: number;
  revenue: number;
}

export class OrderConcurrencyError extends ConflictError {
  constructor(orderId: string) {
    super(`Order ${orderId} was modified concurrently, please retry`);
  }
}

const compact = <T extends object>(obj: T): T => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T;

const OPTIONAL_STATE_FIELDS = ['paidAt', 'deliveredAt', 'reservedUntil'] as const;

/** Revenue after refunds, so partially refunded orders count only what the customer kept. */
const NET_TOTAL = { $subtract: ['$total', { $ifNull: ['$refundedAmount', 0] }] };

export function toOrderProps(r: OrderRecord): OrderProps {
  return compact({
    id: String(r._id),
    orderNumber: r.orderNumber,
    userId: String(r.userId),
    items: r.items.map(i =>
      compact({
        productId: String(i.productId),
        title: i.title,
        image: i.image,
        price: i.price,
        size: i.size,
        qty: i.qty,
        slug: i.slug,
        markdownPerUnit: i.markdownPerUnit ?? 0,
        discounts: (i.discounts ?? []).map(d => ({ promotionId: d.promotionId, amount: d.amount })),
        lineTotal: i.lineTotal ?? i.price * i.qty,
        refundedQty: i.refundedQty ?? 0,
        refundedAmount: i.refundedAmount ?? 0,
      }),
    ),
    address: r.address,
    subtotal: r.subtotal,
    shipping: r.shipping,
    discount: r.discount ?? 0,
    couponCode: r.couponCode ?? undefined,
    total: r.total,
    pricing: r.pricing ?? undefined,
    status: r.status,
    statusHistory: r.statusHistory.map(e => ({ from: e.from ?? null, to: e.to, by: e.by, note: e.note ?? '', at: e.at })),
    payment: compact({
      provider: r.payment?.provider ?? 'demo',
      razorpayOrderId: r.payment?.razorpayOrderId ?? undefined,
      razorpayPaymentId: r.payment?.razorpayPaymentId ?? undefined,
      status: r.payment?.status === 'captured' ? ('captured' as const) : ('pending' as const),
      capturedAt: r.payment?.capturedAt ?? undefined,
    }),
    refunds: (r.refunds ?? []).map(f => compact({ ...f, lines: f.lines.map(l => ({ ...l })) })),
    refundedAmount: r.refundedAmount ?? 0,
    paidAt: r.paidAt ?? undefined,
    deliveredAt: r.deliveredAt ?? undefined,
    reservedUntil: r.reservedUntil ?? undefined,
    version: r.version ?? 0,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  });
}

export class OrderRepository {
  async insert(order: Order, session?: Session): Promise<void> {
    const { id, ...rest } = order.snapshot();
    await OrderModel.create([{ _id: id, ...rest }], { session });
  }

  load(id: string, session?: Session): Promise<Order | null> {
    return this.loadOne({ _id: id }, session);
  }

  loadByGatewayOrderId(gatewayOrderId: string, session?: Session): Promise<Order | null> {
    return this.loadOne({ 'payment.razorpayOrderId': gatewayOrderId }, session);
  }

  loadByGatewayRefundId(gatewayRefundId: string, session?: Session): Promise<Order | null> {
    return this.loadOne({ 'refunds.gatewayRefundId': gatewayRefundId }, session);
  }

  loadByPaymentId(paymentId: string, session?: Session): Promise<Order | null> {
    return this.loadOne({ 'payment.razorpayPaymentId': paymentId }, session);
  }

  /** Persists the aggregate only if nobody else changed it since it was loaded (optimistic concurrency). */
  async save(order: Order, session?: Session): Promise<void> {
    const p = order.snapshot();
    const set: Record<string, unknown> = {
      status: p.status,
      statusHistory: p.statusHistory,
      payment: compact({ ...p.payment }),
      items: p.items,
      refunds: p.refunds.map(r => compact({ ...r })),
      refundedAmount: p.refundedAmount,
    };
    const unset: Record<string, 1> = {};
    for (const key of OPTIONAL_STATE_FIELDS) {
      if (p[key] === undefined) unset[key] = 1;
      else set[key] = p[key];
    }
    const res = await OrderModel.updateOne(
      { _id: p.id, version: p.version === 0 ? { $in: [0, null] } : p.version },
      { $set: set, ...(Object.keys(unset).length && { $unset: unset }), $inc: { version: 1 } },
      { session },
    );
    if (res.matchedCount === 0) throw new OrderConcurrencyError(p.id);
    order.markPersisted();
  }

  private async loadOne(filter: FilterQuery<OrderRecord>, session?: Session): Promise<Order | null> {
    const record = await OrderModel.findOne(filter)
      .session(session ?? null)
      .lean<OrderRecord>();
    return record ? Order.rehydrate(toOrderProps(record)) : null;
  }

  findById(id: string): Promise<OrderRecord | null> {
    return OrderModel.findById(id).lean<OrderRecord>();
  }

  listForUser(userId: string, limit = 50): Promise<OrderRecord[]> {
    return OrderModel.find({ userId }).sort({ createdAt: -1 }).limit(limit).lean<OrderRecord[]>();
  }

  latestForUser(userId: string): Promise<OrderRecord | null> {
    return OrderModel.findOne({ userId }).sort({ createdAt: -1 }).lean<OrderRecord>();
  }

  findByNumberForUser(orderNumber: string, userId: string): Promise<OrderRecord | null> {
    return OrderModel.findOne({ orderNumber: orderNumber.toUpperCase(), userId }).lean<OrderRecord>();
  }

  async page(filter: { status?: OrderStatus }, page: number, limit: number): Promise<{ orders: OrderRecord[]; total: number }> {
    const query: FilterQuery<OrderRecord> = filter.status ? { status: filter.status } : {};
    const [orders, total] = await Promise.all([
      OrderModel.find(query)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean<OrderRecord[]>(),
      OrderModel.countDocuments(query),
    ]);
    return { orders, total };
  }

  count(filter: FilterQuery<OrderRecord> = {}): Promise<number> {
    return OrderModel.countDocuments(filter);
  }

  async revenueSummary(): Promise<RevenueSummary> {
    const [row] = await OrderModel.aggregate<RevenueSummary>([
      { $match: { status: { $in: REVENUE_STATUSES } } },
      { $group: { _id: null, revenue: { $sum: NET_TOTAL }, orders: { $sum: 1 }, avg: { $avg: NET_TOTAL } } },
    ]);
    return row ?? { revenue: 0, orders: 0, avg: 0 };
  }

  revenueByDay(since: Date): Promise<Array<{ date: string; revenue: number; orders: number }>> {
    return OrderModel.aggregate([
      { $match: { status: { $in: REVENUE_STATUSES }, paidAt: { $gte: since } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$paidAt' } },
          revenue: { $sum: NET_TOTAL },
          orders: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
      { $project: { _id: 0, date: '$_id', revenue: 1, orders: 1 } },
    ]);
  }

  async countByStatus(): Promise<Partial<Record<OrderStatus, number>>> {
    const rows = await OrderModel.aggregate<{ _id: OrderStatus; count: number }>([{ $group: { _id: '$status', count: { $sum: 1 } } }]);
    return Object.fromEntries(rows.map(r => [r._id, r.count]));
  }

  topProducts(limit = 6): Promise<TopProductRow[]> {
    return OrderModel.aggregate<TopProductRow>([
      { $match: { status: { $in: REVENUE_STATUSES } } },
      { $unwind: '$items' },
      {
        $group: {
          _id: '$items.productId',
          title: { $first: '$items.title' },
          image: { $first: '$items.image' },
          units: { $sum: { $subtract: ['$items.qty', { $ifNull: ['$items.refundedQty', 0] }] } },
          revenue: {
            $sum: {
              $subtract: [
                { $ifNull: ['$items.lineTotal', { $multiply: ['$items.price', '$items.qty'] }] },
                { $ifNull: ['$items.refundedAmount', 0] },
              ],
            },
          },
        },
      },
      { $sort: { revenue: -1 } },
      { $limit: limit },
    ]);
  }
}
