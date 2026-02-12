import { Router } from 'express';
import { z } from 'zod';
import { ApiError, requireAuth, validate } from '../middleware';
import { Cart, Order, Product } from '../models';
import { transitionOrder } from '../stateMachine';
import { applyCoupon } from './coupons';

const router = Router();
router.use(requireAuth);

const FREE_SHIPPING_ABOVE = 2999;
const SHIPPING_FEE = 99;

const createSchema = z.object({
  items: z.array(z.object({
    productId: z.string(),
    size: z.string(),
    qty: z.number().int().min(1).max(20),
  })).min(1).max(50),
  couponCode: z.string().max(30).optional(),
  address: z.object({
    name: z.string().min(2),
    line1: z.string().min(4),
    city: z.string().min(2),
    state: z.string().min(2),
    pincode: z.string().regex(/^\d{6}$/, 'Pincode must be 6 digits'),
    phone: z.string().regex(/^\d{10}$/, 'Phone must be 10 digits'),
  }),
});

router.post('/', validate(createSchema), async (req, res, next) => {
  try {
    const userId = (req as any).user.id;
    // Server-side pricing: never trust client prices.
    const orderItems = [];
    for (const line of req.body.items) {
      const product = await Product.findById(line.productId).lean();
      if (!product) throw new ApiError(400, `Product not found: ${line.productId}`);
      const variant = product.sizes.find((s: any) => s.size === line.size);
      if (!variant) throw new ApiError(400, `Size ${line.size} not available for ${product.title}`);
      if (variant.stock < line.qty) throw new ApiError(409, `Only ${variant.stock} left of ${product.title} (${line.size})`);
      orderItems.push({
        productId: product._id, title: product.title, image: product.images[0],
        price: product.price, size: line.size, qty: line.qty, slug: product.slug,
      });
    }
    const subtotal = orderItems.reduce((sum, i) => sum + i.price * i.qty, 0);
    let discount = 0;
    let couponCode: string | undefined;
    if (req.body.couponCode) {
      const applied = await applyCoupon(req.body.couponCode, subtotal);
      discount = applied.discount;
      couponCode = applied.coupon.code;
    }
    const shipping = subtotal >= FREE_SHIPPING_ABOVE ? 0 : SHIPPING_FEE;
    const orderNumber = `SF-${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 900 + 100)}`;
    const order = await Order.create({
      orderNumber, userId, items: orderItems, address: req.body.address,
      subtotal, shipping, discount, couponCode, total: subtotal - discount + shipping,
      status: 'created',
      statusHistory: [{ from: null, to: 'created', by: `user:${userId}`, note: 'Order placed', at: new Date() }],
    });
    await Cart.updateOne({ userId }, { $set: { items: [] } });
    res.status(201).json(order);
  } catch (e) { next(e); }
});

router.get('/', async (req, res, next) => {
  try {
    const orders = await Order.find({ userId: (req as any).user.id }).sort({ createdAt: -1 }).limit(50).lean();
    res.json(orders);
  } catch (e) { next(e); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const order = await Order.findById(req.params.id).lean();
    if (!order) throw new ApiError(404, 'Order not found');
    const user = (req as any).user;
    if (String(order.userId) !== user.id && user.role !== 'admin') throw new ApiError(403, 'Forbidden');
    res.json(order);
  } catch (e) { next(e); }
});

router.post('/:id/cancel', async (req, res, next) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) throw new ApiError(404, 'Order not found');
    const user = (req as any).user;
    if (String(order.userId) !== user.id) throw new ApiError(403, 'Forbidden');
    await transitionOrder(order, 'cancelled', `user:${user.id}`, 'Cancelled by customer');
    res.json(order);
  } catch (e) { next(e); }
});

export default router;
