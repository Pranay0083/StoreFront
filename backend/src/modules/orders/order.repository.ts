import { REVENUE_STATUSES, type OrderStatus } from '@storefront/contracts';
import type { FilterQuery, Types } from 'mongoose';
import { OrderModel, type OrderDocument, type OrderRecord } from './order.model';

export type NewOrder = Omit<OrderRecord, '_id' | 'userId' | 'createdAt' | 'updatedAt' | 'payment' | 'paidAt' | 'version'> & {
  userId: string;
};

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

export class OrderRepository {
  async create(order: NewOrder): Promise<OrderDocument> {
    return OrderModel.create(order);
  }

  findById(id: string): Promise<OrderRecord | null> {
    return OrderModel.findById(id).lean<OrderRecord>();
  }

  findDocumentById(id: string): Promise<OrderDocument | null> {
    return OrderModel.findById(id);
  }

  findDocumentByRazorpayOrderId(razorpayOrderId: string): Promise<OrderDocument | null> {
    return OrderModel.findOne({ 'payment.razorpayOrderId': razorpayOrderId });
  }

  async save(order: OrderDocument): Promise<OrderDocument> {
    return order.save();
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
      { $group: { _id: null, revenue: { $sum: '$total' }, orders: { $sum: 1 }, avg: { $avg: '$total' } } },
    ]);
    return row ?? { revenue: 0, orders: 0, avg: 0 };
  }

  revenueByDay(since: Date): Promise<Array<{ date: string; revenue: number; orders: number }>> {
    return OrderModel.aggregate([
      { $match: { status: { $in: REVENUE_STATUSES }, paidAt: { $gte: since } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$paidAt' } },
          revenue: { $sum: '$total' },
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
          units: { $sum: '$items.qty' },
          revenue: { $sum: { $multiply: ['$items.price', '$items.qty'] } },
        },
      },
      { $sort: { revenue: -1 } },
      { $limit: limit },
    ]);
  }
}
