import { Router } from 'express';
import { z } from 'zod';
import { ApiError, requireAdmin, validate } from '../middleware';
import { Cart, Coupon, Order, ORDER_STATUSES, Product, User } from '../models';
import { transitionOrder, TRANSITIONS } from '../stateMachine';

const router = Router();
router.use(requireAdmin);

const REVENUE_STATUSES = ['paid', 'packed', 'shipped', 'delivered'];

router.get('/stats', async (_req, res, next) => {
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
});

// Revenue by day — aggregation pipeline, not find() in a loop.
router.get('/revenue-by-day', async (req, res, next) => {
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
});

router.get('/funnel', async (_req, res, next) => {
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
});

router.get('/top-products', async (_req, res, next) => {
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
});

router.get('/low-stock', async (req, res, next) => {
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
});

router.get('/orders', async (req, res, next) => {
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
    res.json({ orders, total, page: pageN, pages: Math.ceil(total / limit), transitions: TRANSITIONS });
  } catch (e) { next(e); }
});

const bulkSchema = z.object({
  ids: z.array(z.string()).min(1).max(100),
  to: z.enum(ORDER_STATUSES),
});

router.post('/orders/bulk-transition', validate(bulkSchema), async (req, res, next) => {
  try {
    const admin = (req as any).user;
    const results = { updated: 0, rejected: [] as { id: string; reason: string }[] };
    for (const id of req.body.ids) {
      const order = await Order.findById(id);
      if (!order) { results.rejected.push({ id, reason: 'Not found' }); continue; }
      try {
        await transitionOrder(order, req.body.to, `admin:${admin.id}`, 'Bulk action');
        results.updated++;
      } catch (e: any) {
        results.rejected.push({ id: order.orderNumber, reason: e.message });
      }
    }
    res.json(results);
  } catch (e) { next(e); }
});

const couponSchema = z.object({
  code: z.string().min(2).max(30).transform(s => s.trim().toUpperCase()),
  type: z.enum(['percent', 'flat']),
  value: z.number().positive(),
  minSubtotal: z.number().min(0).default(0),
  maxDiscount: z.number().positive().optional().nullable(),
  usageLimit: z.number().int().positive().optional().nullable(),
  active: z.boolean().default(true),
  expiresAt: z.string().datetime().optional().nullable(),
});

router.get('/coupons', async (_req, res, next) => {
  try {
    res.json(await Coupon.find().sort({ createdAt: -1 }).lean());
  } catch (e) { next(e); }
});

router.post('/coupons', validate(couponSchema), async (req, res, next) => {
  try {
    if (await Coupon.findOne({ code: req.body.code })) throw new ApiError(409, 'A coupon with this code already exists');
    const coupon = await Coupon.create(req.body);
    res.status(201).json(coupon);
  } catch (e) { next(e); }
});

router.put('/coupons/:id', validate(couponSchema.partial()), async (req, res, next) => {
  try {
    const coupon = await Coupon.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!coupon) throw new ApiError(404, 'Coupon not found');
    res.json(coupon);
  } catch (e) { next(e); }
});

router.delete('/coupons/:id', async (req, res, next) => {
  try {
    const coupon = await Coupon.findByIdAndDelete(req.params.id);
    if (!coupon) throw new ApiError(404, 'Coupon not found');
    res.json({ ok: true });
  } catch (e) { next(e); }
});

export default router;
