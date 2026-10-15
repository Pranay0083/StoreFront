import type { Logger } from 'pino';
import { NotFoundError } from '../../core/errors';
import type { EventBus, HandlerContext } from '../../core/events/event-bus';
import type { InventoryService } from '../inventory/inventory.service';
import type { Order } from '../orders/order.aggregate';
import type { OrderLocator, OrdersService } from '../orders/orders.service';
import { PermanentGatewayError, type PaymentGateway, type RefundResult } from './gateways/payment-gateway';

const ACTOR = 'system:refund-saga';

/**
 * Orchestrates refunds (whole orders or individual lines) across the order, the payment provider and inventory:
 *   1. claim the refund (requested → processing) so only one worker submits it
 *   2. ask the gateway to refund the captured payment
 *   3. settle: complete + restock the refunded units (synchronously or via the refund webhook), or
 *      compensate by returning the order to its previous status.
 * Transient gateway errors release the claim and rethrow so the outbox retries with backoff.
 */
export class RefundSaga {
  constructor(
    private readonly orders: OrdersService,
    private readonly inventory: InventoryService,
    private readonly gateway: PaymentGateway,
    private readonly logger: Logger,
  ) {}

  register(bus: EventBus): void {
    bus.subscribe('RefundRequested', 'payments.submit-refund', (event, ctx) => this.submit(event.payload.orderId, ctx));
  }

  async submit(orderId: string, ctx: HandlerContext = { attempt: 1, maxAttempts: 1 }): Promise<void> {
    let claimed: Order | undefined;
    await this.orders.mutate({ orderId }, order => {
      if (!order.beginRefundSubmission()) return false;
      claimed = order;
    });
    if (!claimed) return;

    let result: RefundResult;
    try {
      const refund = claimed.openRefund!;
      result = await this.gateway.refund({
        paymentId: claimed.payment.razorpayPaymentId ?? '',
        amount: refund.amount,
        orderId,
        orderNumber: claimed.orderNumber,
        refundId: refund.id,
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      if (err instanceof PermanentGatewayError || ctx.attempt >= ctx.maxAttempts) {
        await this.fail({ orderId }, reason);
        return;
      }
      await this.orders.mutate({ orderId }, order => order.retryRefundSubmission());
      throw err;
    }

    if (result.status === 'processed') await this.complete({ orderId }, result.refundId);
    else if (result.status === 'failed') await this.fail({ orderId }, 'Refund was declined by the payment provider');
    else await this.orders.mutate({ orderId }, order => order.markRefundPending(result.refundId));
    this.logger.info({ orderId, refundId: result.refundId, status: result.status }, 'Refund submitted to gateway');
  }

  /** Settles a refund and puts exactly its units back into stock in the same transaction. Idempotent. */
  async complete(locator: OrderLocator, gatewayRefundId?: string, by = ACTOR): Promise<Order> {
    return this.orders.mutate(locator, async (order, session) => {
      const refund = order.completeRefund({ by, gatewayRefundId });
      if (!refund) return false;
      await this.inventory.restockLines(order.id, refund.lines, order.restockKind(), by, `Refund ${order.orderNumber}`, session);
    });
  }

  /** Compensation: the money could not be returned, so the order goes back to its pre-refund status. */
  async fail(locator: OrderLocator, reason: string, by = ACTOR): Promise<Order> {
    const order = await this.orders.mutate(locator, o => o.failRefund({ by, reason }));
    this.logger.warn({ orderId: order.id, reason }, 'Refund failed; order restored to previous status');
    return order;
  }

  /** Finds the order for a provider refund notification by refund id, falling back to the payment id. */
  async locateByGatewayRefund(refundId: string, paymentId?: string): Promise<OrderLocator> {
    if (await this.orders.locate({ gatewayRefundId: refundId })) return { gatewayRefundId: refundId };
    if (paymentId && (await this.orders.locate({ paymentId }))) return { paymentId };
    throw new NotFoundError(`No order found for refund ${refundId}`);
  }
}
