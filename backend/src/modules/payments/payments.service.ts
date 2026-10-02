import crypto from 'node:crypto';
import Razorpay from 'razorpay';
import { BadRequestError, ConflictError } from '../../core/errors';
import type { AuthUser } from '../../core/http/types';
import { logger } from '../../core/logger';
import type { OrdersService } from '../orders/orders.service';
import type { WebhookEventRepository } from './webhook-event.repository';

export interface PaymentsConfig {
  keyId: string;
  keySecret: string;
  webhookSecret: string;
}

export type PaymentsMode = 'razorpay' | 'demo';

export interface VerifyPaymentInput {
  orderId: string;
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

export interface WebhookInput {
  rawBody?: Buffer;
  signature?: string;
  eventId?: string;
  payload: { event?: string; payload?: { payment?: { entity?: { id: string; order_id: string } } } };
}

export class PaymentsService {
  constructor(
    private readonly config: PaymentsConfig,
    private readonly orders: OrdersService,
    private readonly webhookEvents: WebhookEventRepository,
  ) {}

  get mode(): PaymentsMode {
    return this.config.keyId && this.config.keySecret ? 'razorpay' : 'demo';
  }

  publicConfig() {
    return { mode: this.mode, keyId: this.mode === 'razorpay' ? this.config.keyId : null };
  }

  async createPayment(orderId: string, user: AuthUser) {
    const order = await this.orders.getOwnedDocument(orderId, user.id);
    if (order.status !== 'created') throw new ConflictError(`Order is already ${order.status}`);
    if (this.mode === 'demo') {
      order.set('payment.provider', 'demo');
      await order.save();
      return { mode: 'demo' as const, orderId: String(order._id), amount: order.total };
    }
    const razorOrder = await this.razorpay().orders.create({
      amount: order.total,
      currency: 'INR',
      receipt: order.orderNumber.slice(0, 40),
      payment_capture: true,
    });
    order.set('payment.provider', 'razorpay');
    order.set('payment.razorpayOrderId', razorOrder.id);
    await order.save();
    logger.info({ orderId: order._id, razorpayOrderId: razorOrder.id }, 'Payment session created');
    return {
      mode: 'razorpay' as const,
      keyId: this.config.keyId,
      razorpayOrderId: razorOrder.id,
      amount: razorOrder.amount,
      currency: 'INR',
      orderId: String(order._id),
    };
  }

  async verify(input: VerifyPaymentInput, user: AuthUser) {
    const order = await this.orders.getOwnedDocument(input.orderId, user.id);
    const expected = crypto
      .createHmac('sha256', this.config.keySecret)
      .update(`${input.razorpay_order_id}|${input.razorpay_payment_id}`)
      .digest('hex');
    if (expected !== input.razorpay_signature) {
      logger.warn({ orderId: order._id }, 'Invalid payment signature received');
      throw new BadRequestError('Invalid payment signature');
    }
    const result = await this.orders.markPaid(order, 'system:razorpay-verify', { razorpayPaymentId: input.razorpay_payment_id });
    logger.info({ orderId: order._id, alreadyProcessed: result.alreadyProcessed }, 'Payment verified');
    return { ok: true, alreadyProcessed: result.alreadyProcessed, order: result.order };
  }

  async demoConfirm(orderId: string, user: AuthUser) {
    if (this.mode !== 'demo') throw new BadRequestError('Demo payments are disabled');
    const order = await this.orders.getOwnedDocument(orderId, user.id);
    if (order.status !== 'created' && order.status !== 'paid') throw new ConflictError(`Order is already ${order.status}`);
    const result = await this.orders.markPaid(order, 'system:demo-pay', { razorpayPaymentId: `demo_pay_${order._id}` });
    return { ok: true, alreadyProcessed: result.alreadyProcessed, order: result.order };
  }

  async handleWebhook({ rawBody, signature, eventId, payload }: WebhookInput): Promise<{ status: 'processed' | 'duplicate_ignored' }> {
    if (!signature || !rawBody) throw new BadRequestError('Missing signature');
    const expected = crypto.createHmac('sha256', this.config.webhookSecret).update(rawBody).digest('hex');
    if (expected !== signature) throw new BadRequestError('Invalid webhook signature');

    const id = eventId || crypto.createHash('sha256').update(rawBody).digest('hex');
    if (!(await this.webhookEvents.recordOnce(id, payload.event))) return { status: 'duplicate_ignored' };

    if (payload.event === 'payment.captured') {
      const payment = payload.payload?.payment?.entity;
      const order = payment ? await this.orders.findByRazorpayOrderId(payment.order_id) : null;
      if (order && payment) {
        await this.orders.markPaid(order, 'system:webhook', { razorpayPaymentId: payment.id });
        logger.info({ orderId: order._id, razorpayPaymentId: payment.id }, 'Payment captured via webhook');
      } else {
        logger.warn({ razorpayOrderId: payment?.order_id }, 'Webhook received for unknown order');
      }
    }
    return { status: 'processed' };
  }

  private razorpay() {
    return new Razorpay({ key_id: this.config.keyId, key_secret: this.config.keySecret });
  }
}
