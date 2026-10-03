import crypto from 'node:crypto';
import { BadRequestError, ConflictError } from '../../core/errors';
import type { AuthUser } from '../../core/http/types';
import { logger } from '../../core/logger';
import type { OrdersService } from '../orders/orders.service';
import type { PaymentGateway } from './gateways/payment-gateway';
import type { WebhookEventRepository } from './webhook-event.repository';

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
    private readonly gateway: PaymentGateway,
    private readonly orders: OrdersService,
    private readonly webhookEvents: WebhookEventRepository,
  ) {}

  get mode() {
    return this.gateway.name;
  }

  publicConfig() {
    return this.gateway.publicConfig();
  }

  async createPayment(orderId: string, user: AuthUser) {
    const order = await this.orders.getOwnedDocument(orderId, user.id);
    if (order.status !== 'created') throw new ConflictError(`Order is already ${order.status}`);
    const session = await this.gateway.createPayment({ orderId: String(order._id), orderNumber: order.orderNumber, amount: order.total });
    order.set('payment.provider', session.provider);
    if (session.gatewayOrderId) order.set('payment.razorpayOrderId', session.gatewayOrderId);
    await order.save();
    if (session.provider === 'demo') return { mode: 'demo' as const, orderId: String(order._id), amount: order.total };
    logger.info({ orderId: order._id, razorpayOrderId: session.gatewayOrderId }, 'Payment session created');
    return {
      mode: 'razorpay' as const,
      keyId: this.gateway.publicConfig().keyId,
      razorpayOrderId: session.gatewayOrderId,
      amount: session.amount,
      currency: session.currency,
      orderId: String(order._id),
    };
  }

  async verify(input: VerifyPaymentInput, user: AuthUser) {
    const order = await this.orders.getOwnedDocument(input.orderId, user.id);
    const valid = this.gateway.verifyPayment({
      gatewayOrderId: input.razorpay_order_id,
      paymentId: input.razorpay_payment_id,
      signature: input.razorpay_signature,
    });
    if (!valid) {
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
    if (!this.gateway.verifyWebhook(rawBody, signature)) throw new BadRequestError('Invalid webhook signature');

    const id = eventId || crypto.createHash('sha256').update(rawBody).digest('hex');
    if (!(await this.webhookEvents.recordOnce(id, payload.event))) return { status: 'duplicate_ignored' };

    try {
      await this.dispatchWebhook(payload);
    } catch (err) {
      // Forget the event so the provider's retry is processed instead of being dropped as a duplicate.
      await this.webhookEvents.forget(id);
      throw err;
    }
    return { status: 'processed' };
  }

  private async dispatchWebhook(payload: WebhookInput['payload']): Promise<void> {
    if (payload.event !== 'payment.captured') return;
    const payment = payload.payload?.payment?.entity;
    const order = payment ? await this.orders.findByRazorpayOrderId(payment.order_id) : null;
    if (!order || !payment) {
      logger.warn({ razorpayOrderId: payment?.order_id }, 'Webhook received for unknown order');
      return;
    }
    await this.orders.markPaid(order, 'system:webhook', { razorpayPaymentId: payment.id });
    logger.info({ orderId: order._id, razorpayPaymentId: payment.id }, 'Payment captured via webhook');
  }
}
