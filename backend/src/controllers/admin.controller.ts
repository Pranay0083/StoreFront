import { ApiError } from '../middleware';
import { Cart, Conversation, Order, Product, User } from '../models';
import { ORDER_STATUSES } from '../types';
import { OrderStateMachine } from '../modules/orders/order-state-machine';
import { logger } from '../core/logger';

const REVENUE_STATUSES = ['paid', 'packed', 'shipped', 'delivered'];

/**
 * Retrieves general store statistics (revenue, paid orders, avg order value, customers).
 */
export const getStats = async (_req: any, res: any, next: any) => {
  try {
    const [revenueAgg] = await Order.aggregate([
      { $match: { status: { $in: REVENUE_STATUSES } } },
      { $group: { _id: null, revenue: { $sum: '$total' }, orders: { $sum: 1 }, avg: { $avg: '$total' } } },
    ]);
    const [totalOrders, customers, pendingOrders] = await Promise.all([
      Order.countDocuments(),
      User.countDocuments({ role: 'customer' }),
      Order.countDocuments({ status: { $in: ['paid', 'packed'] } }),
    ]);
    res.json({
      revenue: revenueAgg?.revenue ?? 0,
      paidOrders: revenueAgg?.orders ?? 0,
      avgOrderValue: Math.round(revenueAgg?.avg ?? 0),
      totalOrders, customers, pendingOrders,
    });
  } catch (e) { next(e); }
};

/**
 * Retrieves daily revenue and order counts for a given number of days.
 */
export const getRevenueByDay = async (req: any, res: any, next: any) => {
  try {
    const days = Math.min(90, Number(req.query.days) || 30);
    const since = new Date(Date.now() - days * 86_400_000);
    const rows = await Order.aggregate([
      { $match: { status: { $in: REVENUE_STATUSES }, paidAt: { $gte: since } } },
      { $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$paidAt' } },
          revenue: { $sum: '$total' }, orders: { $sum: 1 },
      } },
      { $sort: { _id: 1 } },
      { $project: { _id: 0, date: '$_id', revenue: 1, orders: 1 } },
    ]);
    res.json(rows);
  } catch (e) { next(e); }
};

/**
 * Calculates conversion funnel metrics (active carts -> placed -> paid -> delivered).
 */
export const getFunnel = async (_req: any, res: any, next: any) => {
  try {
    const [carts, byStatus] = await Promise.all([
      Cart.countDocuments({ 'items.0': { $exists: true } }),
      Order.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    ]);
    const counts: Record<string, number> = {};
    for (const row of byStatus as Array<{ _id: string; count: number }>) {
      counts[row._id] = Number(row.count || 0);
    }
    const placed = Object.values(counts).reduce((a, b) => a + b, 0);
    const paid = REVENUE_STATUSES.reduce((a, s) => a + (counts[s] || 0), 0) + (counts['refunded'] || 0);
    res.json([
      { stage: 'Active carts', count: carts + placed },
      { stage: 'Orders placed', count: placed },
      { stage: 'Orders paid', count: paid },
      { stage: 'Delivered', count: counts['delivered'] || 0 },
    ]);
  } catch (e) { next(e); }
};

/**
 * Retrieves the top 6 products by revenue generated.
 */
export const getTopProducts = async (_req: any, res: any, next: any) => {
  try {
    const rows = await Order.aggregate([
      { $match: { status: { $in: REVENUE_STATUSES } } },
      { $unwind: '$items' },
      { $group: {
          _id: '$items.productId',
          title: { $first: '$items.title' },
          image: { $first: '$items.image' },
          units: { $sum: '$items.qty' },
          revenue: { $sum: { $multiply: ['$items.price', '$items.qty'] } },
      } },
      { $sort: { revenue: -1 } },
      { $limit: 6 },
    ]);
    res.json(rows);
  } catch (e) { next(e); }
};

/**
 * Retrieves products with variants whose stock is below a certain threshold.
 */
export const getLowStock = async (req: any, res: any, next: any) => {
  try {
    const threshold = Number(req.query.threshold) || 5;
    const rows = await Product.aggregate([
      { $unwind: '$sizes' },
      { $match: { 'sizes.stock': { $lt: threshold } } },
      { $project: { title: 1, slug: 1, image: { $arrayElemAt: ['$images', 0] }, size: '$sizes.size', stock: '$sizes.stock' } },
      { $sort: { stock: 1 } },
      { $limit: 12 },
    ]);
    res.json(rows);
  } catch (e) { next(e); }
};

/**
 * Lists orders with pagination and optional status filtering.
 */
export const getOrders = async (req: any, res: any, next: any) => {
  try {
    const { status, page = '1' } = req.query as Record<string, string>;
    const filter: any = {};
    if (status && ORDER_STATUSES.includes(status as any)) filter.status = status;
    const pageN = Math.max(1, Number(page));
    const limit = 20;
    const [orders, total] = await Promise.all([
      Order.find(filter).sort({ createdAt: -1 }).skip((pageN - 1) * limit).limit(limit).lean(),
      Order.countDocuments(filter),
    ]);
    res.json({ orders, total, page: pageN, pages: Math.ceil(total / limit), transitions: OrderStateMachine.transitions });
  } catch (e) { next(e); }
};

/**
 * Transitions multiple orders to a specified target status in bulk.
 */
export const bulkTransitionOrders = async (req: any, res: any, next: any) => {
  try {
    const admin = req.user;
    const results = { updated: 0, rejected: [] as { id: string; reason: string }[] };
    for (const id of req.body.ids) {
      const order = await Order.findById(id);
      if (!order) { results.rejected.push({ id, reason: 'Not found' }); continue; }
      try {
        OrderStateMachine.apply(order, req.body.to, `admin:${admin.id}`, 'Bulk action');
        await order.save();
        results.updated++;
      } catch (e: any) {
        results.rejected.push({ id: order.orderNumber, reason: e.message });
      }
    }
    logger.info({ adminId: admin.id, updated: results.updated, rejected: results.rejected.length }, 'Bulk order transition executed');
    if (results.rejected.length > 0) logger.warn({ rejected: results.rejected }, 'Some orders failed bulk transition');
    res.json(results);
  } catch (e) { next(e); }
};

/**
 * Retrieves recent customer conversations with the AI shopping concierge.
 */
export const getConversations = async (_req: any, res: any, next: any) => {
  try {
    const convos = await Conversation.find().sort({ updatedAt: -1 }).limit(100).lean();
    res.json(convos.map((c: any) => {
      const visible = c.messages.filter((m: any) => m.role !== 'tool');
      const lastUser = [...visible].reverse().find((m: any) => m.role === 'user');
      return {
        _id: c._id,
        sessionId: c.sessionId,
        userName: c.userName || null,
        userEmail: c.userEmail || null,
        channel: c.channel,
        messageCount: visible.length,
        toolCallCount: c.messages.length - visible.length,
        preview: (lastUser?.content || '').slice(0, 120),
        messages: c.messages,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
      };
    }));
  } catch (e) { next(e); }
};
