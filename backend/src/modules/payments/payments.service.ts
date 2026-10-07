import crypto from 'node:crypto';
import { BadRequestError, ConflictError, NotFoundError } from '../../core/errors';
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

export interface RazorpayWebhookPayload {
  event?: string;
  payload?: {
    payment?: { entity?: { id: string; order_id: string } };
    refund?: { entity?: { id: string; payment_id: string; status?: string; error_description?: string | null } };
  };
}

export interface WebhookInput {
  rawBody?: Buffer;
  signature?: string;
  eventId?: string;
  payload: RazorpayWebhookPayload;
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
    const order = await this.orders.getOwned(orderId, user.id);
    if (order.status !== 'created') throw new ConflictError(`Order is already ${order.status}`);
    const reservedUntil = order.snapshot().reservedUntil;
    if (reservedUntil && reservedUntil.getTime() <= Date.now()) throw new ConflictError('The payment window for this order has expired');

    const session = await this.gateway.createPayment({ orderId: order.id, orderNumber: order.orderNumber, amount: order.total });
    await this.orders.attachPaymentSession(order.id, session.provider, session.gatewayOrderId);
    if (session.provider === 'demo') return { mode: 'demo' as const, orderId: order.id, amount: order.total };

    logger.info({ orderId: order.id, razorpayOrderId: session.gatewayOrderId }, 'Payment session created');
    return {
      mode: 'razorpay' as const,
      keyId: this.gateway.publicConfig().keyId,
      razorpayOrderId: session.gatewayOrderId,
      amount: session.amount,
      currency: session.currency,
      orderId: order.id,
    };
  }

  async verify(input: VerifyPaymentInput, user: AuthUser) {
    const order = await this.orders.getOwned(input.orderId, user.id);
    const valid =
      order.payment.razorpayOrderId === input.razorpay_order_id &&
      this.gateway.verifyPayment({
        gatewayOrderId: input.razorpay_order_id,
        paymentId: input.razorpay_payment_id,
        signature: input.razorpay_signature,
      });
    if (!valid) {
      logger.warn({ orderId: order.id }, 'Invalid payment signature received');
      throw new BadRequestError('Invalid payment signature');
    }
    const result = await this.orders.confirmPayment(
      { orderId: order.id },
      { by: 'system:razorpay-verify', paymentId: input.razorpay_payment_id, provider: this.gateway.name },
    );
    logger.info({ orderId: order.id, alreadyProcessed: result.alreadyProcessed }, 'Payment verified');
    return { ok: true, alreadyProcessed: result.alreadyProcessed, order: result.order };
  }

  async demoConfirm(orderId: string, user: AuthUser) {
    if (this.mode !== 'demo') throw new BadRequestError('Demo payments are disabled');
    const order = await this.orders.getOwned(orderId, user.id);
    if (order.status !== 'created' && order.status !== 'paid') throw new ConflictError(`Order is already ${order.status}`);
    const result = await this.orders.confirmPayment(
      { orderId },
      { by: 'system:demo-pay', paymentId: `demo_pay_${orderId}`, provider: 'demo' },
    );
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

  private async dispatchWebhook(payload: RazorpayWebhookPayload): Promise<void> {
    if (payload.event !== 'payment.captured') return;
    const payment = payload.payload?.payment?.entity;
    if (!payment) return;
    try {
      const result = await this.orders.confirmPayment(
        { gatewayOrderId: payment.order_id },
        { by: 'system:webhook', paymentId: payment.id, provider: this.gateway.name },
      );
      logger.info(
        { orderId: result.order.id, razorpayPaymentId: payment.id, alreadyProcessed: result.alreadyProcessed },
        'Payment captured via webhook',
      );
    } catch (err) {
      if (!(err instanceof NotFoundError)) throw err;
      logger.warn({ razorpayOrderId: payment.order_id }, 'Webhook received for unknown order');
    }
  }
}
