import { ApiError } from '../middleware';
import { Cart, Order, Product } from '../models';
import { transitionOrder } from '../services/stateMachine';
import { logger } from '../utils/logger';
import { applyCoupon } from './coupons.controller';

const FREE_SHIPPING_ABOVE = 2999;
const SHIPPING_FEE = 99;

/**
 * Creates a new order from the user's cart items, applies any requested coupon, 
 * computes shipping, and initializes the order in the 'created' state.
 * Empties the cart upon success.
 */
export const createOrder = async (req: any, res: any, next: any) => {
  try {
    const userId = req.user.id;
    const orderItems = [];
    for (const line of req.body.items) {
      const product = await Product.findById(line.productId).lean();
      if (!product) throw new ApiError(400, `Product not found: ${line.productId}`);
      const variant = product.sizes.find((s: any) => s.size === line.size);
      if (!variant) throw new ApiError(400, `Size ${line.size} not available for ${product.title}`);
      if (variant.stock < line.qty) {
        logger.warn({ productId: line.productId, requested: line.qty, available: variant.stock }, 'Insufficient stock during checkout');
        throw new ApiError(409, `Only ${variant.stock} left of ${product.title} (${line.size})`);
      }
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
    logger.info({ orderId: order._id, orderNumber, userId, total: order.total }, 'Order created successfully');
    res.status(201).json(order);
  } catch (e) { next(e); }
};

/**
 * Retrieves up to 50 recent orders for the authenticated user.
 */
export const getOrders = async (req: any, res: any, next: any) => {
  try {
    const orders = await Order.find({ userId: req.user.id }).sort({ createdAt: -1 }).limit(50).lean();
    res.json(orders);
  } catch (e) { next(e); }
};

/**
 * Retrieves details for a specific order by ID.
 * Enforces access control (only the order owner or an admin can view it).
 */
export const getOrderById = async (req: any, res: any, next: any) => {
  try {
    const order = await Order.findById(req.params.id).lean();
    if (!order) throw new ApiError(404, 'Order not found');
    const user = req.user;
    if (String(order.userId) !== user.id && user.role !== 'admin') throw new ApiError(403, 'Forbidden');
    res.json(order);
  } catch (e) { next(e); }
};

/**
 * Allows a customer to cancel their own order (if the current state permits it).
 */
export const cancelOrder = async (req: any, res: any, next: any) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) throw new ApiError(404, 'Order not found');
    const user = req.user;
    if (String(order.userId) !== user.id) throw new ApiError(403, 'Forbidden');
    await transitionOrder(order, 'cancelled', `user:${user.id}`, 'Cancelled by customer');
    logger.info({ orderId: order._id, userId: user.id }, 'Order cancelled by customer');
    res.json(order);
  } catch (e) { next(e); }
};
