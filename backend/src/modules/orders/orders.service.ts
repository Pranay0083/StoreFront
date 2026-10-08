import {
  ADMIN_ORDER_ACTIONS,
  CUSTOMER_CANCELLABLE_STATUSES,
  shippingFor,
  type CreateOrderInput,
  type OrderStatus,
} from '@storefront/contracts';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../../core/errors';
import type { OutboxRelay } from '../../core/events/outbox-relay';
import type { OutboxStore } from '../../core/events/outbox.store';
import type { AuthUser } from '../../core/http/types';
import { logger } from '../../core/logger';
import type { Session, TransactionRunner } from '../../core/persistence/transaction';
import type { CartService } from '../cart/cart.service';
import type { ProductRepository } from '../catalog/product.repository';
import type { CouponService } from '../coupons/coupons.service';
import type { InventoryService } from '../inventory/inventory.service';
import { generateOrderNumber } from './order-number';
import { Order, type CapturedPayment, type OrderLine } from './order.aggregate';
import type { OrderRecord } from './order.model';
import type { OrderRepository } from './order.repository';

export interface OrdersConfig {
  reservationTtlMs: number;
  refundWindowDays: number;
}

export type OrderLocator = { orderId: string } | { gatewayOrderId: string } | { gatewayRefundId: string } | { paymentId: string };

/** Returning `false` from a change means "nothing to do" and skips the write. */
export type OrderChange = (order: Order, session: Session) => Promise<void | boolean> | void | boolean;

export interface PaymentConfirmation {
  order: Order;
  alreadyProcessed: boolean;
}

const SWEEP_ACTOR = 'system:reservation-expiry';

export class OrdersService {
  constructor(
    private readonly orders: OrderRepository,
    private readonly products: ProductRepository,
    private readonly coupons: CouponService,
    private readonly cart: CartService,
    private readonly inventory: InventoryService,
    private readonly outbox: OutboxStore,
    private readonly relay: OutboxRelay,
    private readonly tx: TransactionRunner,
    private readonly config: OrdersConfig,
  ) {}

  /**
   * Places an order in one transaction: price from current catalog data, reserve stock with guarded
   * decrements, reserve the coupon use and record OrderPlaced. Either all of it commits or none.
   */
  async create(input: CreateOrderInput, user: AuthUser): Promise<Order> {
    const order = await this.tx.run(async session => {
      const items = await this.priceLines(input.items, session);
      const subtotal = items.reduce((sum, i) => sum + i.price * i.qty, 0);
      const coupon = input.couponCode ? await this.coupons.quote(input.couponCode, subtotal) : undefined;

      const placed = Order.place({
        orderNumber: generateOrderNumber(),
        userId: user.id,
        items,
        address: input.address,
        subtotal,
        shipping: shippingFor(subtotal),
        discount: coupon?.discount ?? 0,
        couponCode: coupon?.coupon.code,
        reservedUntil: new Date(Date.now() + this.config.reservationTtlMs),
      });
      await this.orders.insert(placed, session);
      await this.inventory.reserve(placed.id, items, placed.snapshot().reservedUntil!, `user:${user.id}`, session);
      if (coupon) await this.coupons.redeem(coupon.coupon.code, placed.id, user.id, session);
      await this.outbox.append(placed.pullEvents(), session);
      return placed;
    });

    await this.cart.clear(user.id);
    this.relay.notify();
    logger.info({ orderId: order.id, orderNumber: order.orderNumber, userId: user.id, total: order.total }, 'Order created');
    return order;
  }

  listForUser(userId: string): Promise<OrderRecord[]> {
    return this.orders.listForUser(userId);
  }

  async getVisibleTo(id: string, user: AuthUser): Promise<OrderRecord> {
    const order = await this.orders.findById(id);
    if (!order) throw new NotFoundError('Order not found');
    if (String(order.userId) !== user.id && user.role !== 'admin') throw new ForbiddenError();
    return order;
  }

  async getOwned(id: string, userId: string): Promise<Order> {
    const order = await this.orders.load(id);
    if (!order) throw new NotFoundError('Order not found');
    if (order.userId !== userId) throw new ForbiddenError();
    return order;
  }

  async attachPaymentSession(orderId: string, provider: string, gatewayOrderId?: string): Promise<Order> {
    return this.mutate({ orderId }, order => order.attachPaymentSession(provider, gatewayOrderId));
  }

  /**
   * Atomically and idempotently applies a captured payment. Concurrent confirmations of the same
   * order (client verify racing the webhook) conflict inside the transaction; the loser retries,
   * sees the order already paid and reports `alreadyProcessed` without touching stock again.
   */
  async confirmPayment(locator: OrderLocator, payment: CapturedPayment): Promise<PaymentConfirmation> {
    const result = await this.tx.run(async session => {
      const order = await this.locate(locator, session);
      if (!order) throw new NotFoundError('Order not found');

      if (order.status === 'created') {
        if (!(await this.inventory.commit(order.id, payment.by, session))) {
          // Orders placed before reservations existed hold no stock yet.
          const lines = [...order.items];
          if (await this.inventory.canReserve(lines, session)) {
            await this.inventory.reserve(order.id, lines, new Date(), payment.by, session);
            await this.inventory.commit(order.id, payment.by, session);
          } else {
            order.cancel(payment.by, 'Stock no longer available');
            order.acceptLatePayment(payment);
            return this.persist(order, session);
          }
        }
        order.pay(payment);
        return this.persist(order, session);
      }

      if (order.status === 'cancelled' && !order.isPaymentCaptured) {
        order.acceptLatePayment(payment);
        return this.persist(order, session);
      }

      return { order, alreadyProcessed: true };
    });
    if (!result.alreadyProcessed) this.relay.notify();
    return result;
  }

  async cancel(id: string, user: AuthUser): Promise<Order> {
    const by = `user:${user.id}`;
    return this.mutate({ orderId: id }, async (order, session) => {
      if (order.userId !== user.id) throw new ForbiddenError();
      if (!CUSTOMER_CANCELLABLE_STATUSES.includes(order.status)) throw new ConflictError(`Illegal transition: ${order.status} → cancelled`);
      if (order.status === 'created') await this.cancelUnpaid(order, by, 'Cancelled by customer', session);
      else order.requestRefund({ by, reason: 'Cancelled by customer', windowDays: this.config.refundWindowDays });
    });
  }

  async requestRefund(id: string, user: AuthUser, reason: string): Promise<Order> {
    return this.mutate({ orderId: id }, order => {
      if (order.userId !== user.id) throw new ForbiddenError();
      order.requestRefund({ by: `user:${user.id}`, reason, windowDays: this.config.refundWindowDays });
    });
  }

  /** Operator actions are limited to ADMIN_ORDER_ACTIONS; payment and refund settlement stay gateway-driven. */
  async adminTransition(id: string, to: OrderStatus, adminId: string, note = ''): Promise<Order> {
    const by = `admin:${adminId}`;
    return this.mutate({ orderId: id }, async (order, session) => {
      if (!ADMIN_ORDER_ACTIONS[order.status].includes(to)) throw new ConflictError(`Illegal transition: ${order.status} → ${to}`);
      switch (to) {
        case 'packed':
          return order.pack(by, note);
        case 'shipped':
          return order.ship(by, note);
        case 'delivered':
          return order.deliver(by, note);
        case 'cancelled':
          return this.cancelUnpaid(order, by, note || 'Cancelled by admin', session);
        case 'refund_requested':
          return order.requestRefund({ by, reason: note || 'Refund issued by admin', windowDays: Number.POSITIVE_INFINITY });
        default:
          throw new ConflictError(`Illegal transition: ${order.status} → ${to}`);
      }
    });
  }

  /** Cancels an unpaid order whose reservation expired. Safe to call repeatedly and concurrently. */
  async expireReservation(orderId: string): Promise<boolean> {
    const expired = await this.tx.run(async session => {
      const order = await this.orders.load(orderId, session);
      if (!order || order.status !== 'created') return false;
      if (!(await this.inventory.release(order.id, SWEEP_ACTOR, 'Payment window expired', session))) return false;
      order.cancel(SWEEP_ACTOR, 'Payment window expired');
      await this.persist(order, session);
      return true;
    });
    if (expired) {
      this.relay.notify();
      logger.info({ orderId }, 'Unpaid order expired and stock released');
    }
    return expired;
  }

  async sweepExpiredReservations(now = new Date()): Promise<number> {
    let expired = 0;
    for (const orderId of await this.inventory.expiredReservations(now)) {
      if (await this.expireReservation(orderId)) expired++;
    }
    return expired;
  }

  /** Loads, changes and saves an order together with its domain events in one transaction. */
  async mutate(locator: OrderLocator, change: OrderChange): Promise<Order> {
    const order = await this.tx.run(async session => {
      const loaded = await this.locate(locator, session);
      if (!loaded) throw new NotFoundError('Order not found');
      if ((await change(loaded, session)) === false) return loaded;
      return (await this.persist(loaded, session)).order;
    });
    this.relay.notify();
    return order;
  }

  locate(locator: OrderLocator, session?: Session): Promise<Order | null> {
    if ('orderId' in locator) return this.orders.load(locator.orderId, session);
    if ('gatewayOrderId' in locator) return this.orders.loadByGatewayOrderId(locator.gatewayOrderId, session);
    if ('gatewayRefundId' in locator) return this.orders.loadByGatewayRefundId(locator.gatewayRefundId, session);
    return this.orders.loadByPaymentId(locator.paymentId, session);
  }

  private async persist(order: Order, session: Session): Promise<PaymentConfirmation> {
    await this.orders.save(order, session);
    await this.outbox.append(order.pullEvents(), session);
    return { order, alreadyProcessed: false };
  }

  private async cancelUnpaid(order: Order, by: string, reason: string, session: Session): Promise<void> {
    order.cancel(by, reason);
    await this.inventory.release(order.id, by, reason, session);
  }

  private async priceLines(lines: CreateOrderInput['items'], session: Session): Promise<Array<OrderLine & { title: string }>> {
    const items = [];
    for (const line of lines) {
      const product = await this.products.findById(line.productId, session);
      if (!product) throw new BadRequestError(`Product not found: ${line.productId}`);
      if (!product.sizes.some(s => s.size === line.size)) throw new BadRequestError(`Size ${line.size} not available for ${product.title}`);
      items.push({
        productId: String(product._id),
        title: product.title,
        image: product.images[0],
        price: product.price,
        size: line.size,
        qty: line.qty,
        slug: product.slug,
      });
    }
    return items;
  }
}
