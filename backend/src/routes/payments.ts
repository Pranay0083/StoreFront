import crypto from 'crypto';
import { Router } from 'express';
import Razorpay from 'razorpay';
import { z } from 'zod';
import { env, paymentsMode } from '../env';
import { ApiError, requireAuth, validate } from '../middleware';
import { Order, WebhookEvent } from '../models';
import { markOrderPaid } from '../stateMachine';

const router = Router();

const rzp = () => new Razorpay({ key_id: env.RAZORPAY_KEY_ID, key_secret: env.RAZORPAY_KEY_SECRET });

router.get('/config', (_req, res) => {
  const mode = paymentsMode();
  res.json({ mode, keyId: mode === 'razorpay' ? env.RAZORPAY_KEY_ID : null });
});

const orderIdSchema = z.object({ orderId: z.string() });

async function loadOwnOrder(req: any) {
  const order = await Order.findById(req.body.orderId);
  if (!order) throw new ApiError(404, 'Order not found');
  if (String(order.userId) !== req.user.id) throw new ApiError(403, 'Forbidden');
  return order;
}

router.post('/create', requireAuth, validate(orderIdSchema), async (req, res, next) => {
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
  } catch (e) { next(e); }
});

const verifySchema = z.object({
  orderId: z.string(),
  razorpay_order_id: z.string(),
  razorpay_payment_id: z.string(),
  razorpay_signature: z.string(),
});

router.post('/verify', requireAuth, validate(verifySchema), async (req, res, next) => {
  try {
    const order = await loadOwnOrder(req);
    const expected = crypto.createHmac('sha256', env.RAZORPAY_KEY_SECRET)
      .update(`${req.body.razorpay_order_id}|${req.body.razorpay_payment_id}`)
      .digest('hex');
    if (expected !== req.body.razorpay_signature) throw new ApiError(400, 'Invalid payment signature');
    const { alreadyProcessed } = await markOrderPaid(order, 'system:razorpay-verify', {
      razorpayPaymentId: req.body.razorpay_payment_id,
    });
    res.json({ ok: true, alreadyProcessed, order });
  } catch (e) { next(e); }
});

// Demo mode: simulated capture exercising the same idempotent confirmation path.
router.post('/demo-confirm', requireAuth, validate(orderIdSchema), async (req, res, next) => {
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
});

// Razorpay webhook: signature-verified + deduplicated by event id (idempotent on retries).
router.post('/webhook', async (req, res, next) => {
  try {
    const signature = req.headers['x-razorpay-signature'] as string;
    const rawBody = (req as any).rawBody as Buffer;
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
      if (order) await markOrderPaid(order, 'system:webhook', { razorpayPaymentId: payment.id });
    }
    res.json({ status: 'processed' });
  } catch (e) { next(e); }
});

export default router;
