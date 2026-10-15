import crypto from 'node:crypto';
import { BadRequestError, ConflictError, NotFoundError } from '../../core/errors';
import type { AuthUser } from '../../core/http/types';
import { logger } from '../../core/logger';
import type { JobQueue } from '../../core/queue/job-queue';
import type { OrdersService } from '../orders/orders.service';
import type { PaymentGateway } from './gateways/payment-gateway';
import type { RefundSaga } from './refund.saga';
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

export const PROCESS_WEBHOOK_JOB = 'payments.process-webhook';

export interface WebhookJob {
  eventId: string;
  payload: RazorpayWebhookPayload;
}

export type WebhookStatus = 'processed' | 'accepted' | 'duplicate_ignored';

export class PaymentsService {
  /**
   * With a job queue, webhooks are acknowledged as soon as they are verified and deduplicated, and
   * processed by a retried job, so slow downstream work never makes the provider time out and resend.
   */
  constructor(
    private readonly gateway: PaymentGateway,
    private readonly orders: OrdersService,
    private readonly webhookEvents: WebhookEventRepository,
    private readonly refunds: RefundSaga,
    private readonly jobs?: JobQueue,
  ) {
    jobs?.register<WebhookJob>({
      name: PROCESS_WEBHOOK_JOB,
      queue: 'payments',
      attempts: 8,
      backoffMs: 5_000,
      concurrency: 4,
      handler: job => this.processWebhook(job.payload),
    });
  }

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

  async handleWebhook({ rawBody, signature, eventId, payload }: WebhookInput): Promise<{ status: WebhookStatus }> {
    if (!signature || !rawBody) throw new BadRequestError('Missing signature');
    if (!this.gateway.verifyWebhook(rawBody, signature)) throw new BadRequestError('Invalid webhook signature');

    const id = eventId || crypto.createHash('sha256').update(rawBody).digest('hex');
    if (!(await this.webhookEvents.recordOnce(id, payload.event))) return { status: 'duplicate_ignored' };

    try {
      if (this.jobs) {
        await this.jobs.enqueue<WebhookJob>(PROCESS_WEBHOOK_JOB, { eventId: id, payload }, { jobId: `webhook:${id}` });
        return { status: 'accepted' };
      }
      await this.processWebhook(payload);
    } catch (err) {
      // Forget the event so the provider's retry is processed instead of being dropped as a duplicate.
      await this.webhookEvents.forget(id);
      throw err;
    }
    return { status: 'processed' };
  }

  async processWebhook(payload: RazorpayWebhookPayload): Promise<void> {
    try {
      switch (payload.event) {
        case 'payment.captured':
          return await this.onPaymentCaptured(payload);
        case 'refund.processed':
        case 'refund.failed':
          return await this.onRefundSettled(payload);
      }
    } catch (err) {
      if (!(err instanceof NotFoundError)) throw err;
      logger.warn({ event: payload.event, error: err.message }, 'Webhook received for unknown order');
    }
  }

  private async onPaymentCaptured(payload: RazorpayWebhookPayload): Promise<void> {
    const payment = payload.payload?.payment?.entity;
    if (!payment) return;
    const result = await this.orders.confirmPayment(
      { gatewayOrderId: payment.order_id },
      { by: 'system:webhook', paymentId: payment.id, provider: this.gateway.name },
    );
    logger.info(
      { orderId: result.order.id, razorpayPaymentId: payment.id, alreadyProcessed: result.alreadyProcessed },
      'Payment captured via webhook',
    );
  }

  private async onRefundSettled(payload: RazorpayWebhookPayload): Promise<void> {
    const refund = payload.payload?.refund?.entity;
    if (!refund) return;
    const locator = await this.refunds.locateByGatewayRefund(refund.id, refund.payment_id);
    if (payload.event === 'refund.processed') {
      await this.refunds.complete(locator, refund.id, 'system:webhook');
    } else {
      await this.refunds.fail(locator, refund.error_description || 'Refund failed at the payment provider', 'system:webhook');
    }
  }
}
