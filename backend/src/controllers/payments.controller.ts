import crypto from 'crypto';
import Razorpay from 'razorpay';
import { env, paymentsMode } from '../config/env';
import { ApiError } from '../middleware';
import { Order, WebhookEvent } from '../models';
import { markOrderPaid } from '../services/stateMachine';
import { logger } from '../utils/logger';

const rzp = () => new Razorpay({ key_id: env.RAZORPAY_KEY_ID, key_secret: env.RAZORPAY_KEY_SECRET });

/**
 * Retrieves public payment configuration details (e.g. gateway mode, public key).
 */
export const getConfig = (_req: any, res: any) => {
  const mode = paymentsMode();
  res.json({ mode, keyId: mode === 'razorpay' ? env.RAZORPAY_KEY_ID : null });
};

/**
 * Helper that loads an order by ID and ensures it belongs to the authenticated user.
 */
async function loadOwnOrder(req: any) {
  const order = await Order.findById(req.body.orderId);
  if (!order) throw new ApiError(404, 'Order not found');
  if (String(order.userId) !== req.user.id) throw new ApiError(403, 'Forbidden');
  return order;
}

/**
 * Initiates a payment for an order by creating a Razorpay order (or handling demo mode).
 */
export const createPayment = async (req: any, res: any, next: any) => {
  try {
    const order = await loadOwnOrder(req);
    if (order.status !== 'created') throw new ApiError(409, `Order is already ${order.status}`);
    if (paymentsMode() === 'demo') {
      order.payment.provider = 'demo';
      await order.save();
      return res.json({ mode: 'demo', orderId: String(order._id), amount: order.total * 100 });
    }
    const razorOrder = await rzp().orders.create({
      amount: order.total * 100,
      currency: 'INR',
      receipt: order.orderNumber.slice(0, 40),
      payment_capture: true,
    } as any);
    order.payment.provider = 'razorpay';
    order.payment.razorpayOrderId = razorOrder.id;
    await order.save();
    res.json({
      mode: 'razorpay', keyId: env.RAZORPAY_KEY_ID,
      razorpayOrderId: razorOrder.id, amount: razorOrder.amount, currency: 'INR',
      orderId: String(order._id),
    });
    logger.info({ orderId: order._id, razorpayOrderId: razorOrder.id }, 'Payment session created');
  } catch (e) { next(e); }
};

/**
 * Verifies a Razorpay payment signature sent from the client and marks the order as paid.
 */
export const verifyPayment = async (req: any, res: any, next: any) => {
  try {
    const order = await loadOwnOrder(req);
    const expected = crypto.createHmac('sha256', env.RAZORPAY_KEY_SECRET)
      .update(`${req.body.razorpay_order_id}|${req.body.razorpay_payment_id}`)
      .digest('hex');
    if (expected !== req.body.razorpay_signature) {
      logger.warn({ orderId: order._id, expected, received: req.body.razorpay_signature }, 'Invalid payment signature received');
      throw new ApiError(400, 'Invalid payment signature');
    }
    const { alreadyProcessed } = await markOrderPaid(order, 'system:razorpay-verify', {
      razorpayPaymentId: req.body.razorpay_payment_id,
    });
    logger.info({ orderId: order._id, alreadyProcessed }, 'Payment verified successfully');
    res.json({ ok: true, alreadyProcessed, order });
  } catch (e) { next(e); }
};

/**
 * Confirm a demo mode payment and marks the order as paid. 
 * Only succeeds if demo payments are enabled.
 */
export const demoConfirm = async (req: any, res: any, next: any) => {
  try {
    if (paymentsMode() !== 'demo') throw new ApiError(400, 'Demo payments are disabled');
    const order = await loadOwnOrder(req);
    if (order.status !== 'created' && order.status !== 'paid') {
      throw new ApiError(409, `Order is already ${order.status}`);
    }
    const { alreadyProcessed } = await markOrderPaid(order, 'system:demo-pay', {
      razorpayPaymentId: `demo_pay_${order._id}`,
    });
    res.json({ ok: true, alreadyProcessed, order });
  } catch (e) { next(e); }
};

/**
 * Handles incoming Razorpay webhooks (e.g., payment captured), verifies their signature, 
 * and asynchronously marks the corresponding order as paid.
 */
export const handleWebhook = async (req: any, res: any, next: any) => {
  try {
    const signature = req.headers['x-razorpay-signature'] as string;
    const rawBody = req.rawBody as Buffer;
    if (!signature || !rawBody) throw new ApiError(400, 'Missing signature');
    const expected = crypto.createHmac('sha256', env.RAZORPAY_WEBHOOK_SECRET)
      .update(rawBody).digest('hex');
    if (expected !== signature) throw new ApiError(400, 'Invalid webhook signature');

    const eventId = (req.headers['x-razorpay-event-id'] as string) || crypto.createHash('sha256').update(rawBody).digest('hex');
    try {
      await WebhookEvent.create({ eventId, event: req.body?.event });
    } catch (e: any) {
      if (e.code === 11000) return res.json({ status: 'duplicate_ignored' });
      throw e;
    }
    if (req.body?.event === 'payment.captured') {
      const payment = req.body.payload?.payment?.entity;
      const order = await Order.findOne({ 'payment.razorpayOrderId': payment?.order_id });
      if (order) {
        await markOrderPaid(order, 'system:webhook', { razorpayPaymentId: payment.id });
        logger.info({ orderId: order._id, razorpayPaymentId: payment.id }, 'Payment captured via webhook');
      } else {
        logger.warn({ razorpayOrderId: payment?.order_id }, 'Webhook received for unknown order');
      }
    }
    res.json({ status: 'processed' });
  } catch (e) { next(e); }
};
