import { REFUND_WINDOW_DAYS, type Address, type OrderStatus, type Paise, type RefundState } from '@storefront/contracts';
import { Types } from 'mongoose';
import { BadRequestError, ConflictError } from '../../core/errors';
import { domainEvent, type DomainEvent, type StockLine } from '../../core/events/domain-events';
import { OrderStateMachine } from './order-state-machine';

const DAY_MS = 86_400_000;

export interface OrderLine {
  productId: string;
  title: string;
  image?: string;
  price: Paise;
  size: string;
  qty: number;
  slug?: string;
}

export interface StatusEvent {
  from: OrderStatus | null;
  to: OrderStatus;
  by: string;
  note: string;
  at: Date;
}

export interface PaymentState {
  provider: string;
  razorpayOrderId?: string;
  razorpayPaymentId?: string;
  status: 'pending' | 'captured';
  capturedAt?: Date;
}

export interface RefundDetails {
  status: RefundState;
  amount: Paise;
  reason: string;
  requestedBy: string;
  requestedAt: Date;
  previousStatus: OrderStatus;
  gatewayRefundId?: string;
  completedAt?: Date;
  failureReason?: string;
}

export interface OrderProps {
  id: string;
  orderNumber: string;
  userId: string;
  items: OrderLine[];
  address: Address;
  subtotal: Paise;
  shipping: Paise;
  discount: Paise;
  couponCode?: string;
  total: Paise;
  status: OrderStatus;
  statusHistory: StatusEvent[];
  payment: PaymentState;
  refund?: RefundDetails;
  paidAt?: Date;
  deliveredAt?: Date;
  reservedUntil?: Date;
  version: number;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface PlaceOrderInput {
  orderNumber: string;
  userId: string;
  items: OrderLine[];
  address: Address;
  subtotal: Paise;
  shipping: Paise;
  discount: Paise;
  couponCode?: string;
  reservedUntil: Date;
}

export interface CapturedPayment {
  by: string;
  paymentId?: string;
  provider?: string;
}

/**
 * Order aggregate root. Every status change goes through a method that enforces the lifecycle
 * rules, appends to the audit trail and records the domain event; the repository persists the
 * result with an optimistic version check and the events go to the outbox in the same transaction.
 */
export class Order {
  private pendingEvents: DomainEvent[] = [];

  private constructor(private props: OrderProps) {}

  static place(input: PlaceOrderInput, now = new Date()): Order {
    if (!input.items.length) throw new BadRequestError('Order must contain at least one item');
    const total = input.subtotal - input.discount + input.shipping;
    if (total < 0) throw new BadRequestError('Order total cannot be negative');
    const order = new Order({
      ...input,
      id: new Types.ObjectId().toHexString(),
      total,
      status: 'created',
      statusHistory: [{ from: null, to: 'created', by: `user:${input.userId}`, note: 'Order placed', at: now }],
      payment: { provider: 'demo', status: 'pending' },
      version: 0,
    });
    order.record('OrderPlaced', {
      orderId: order.id,
      orderNumber: order.orderNumber,
      userId: order.userId,
      total,
      items: order.stockLines(),
      ...(input.couponCode && { couponCode: input.couponCode }),
    });
    return order;
  }

  static rehydrate(props: OrderProps): Order {
    return new Order(props);
  }

  get id() {
    return this.props.id;
  }
  get orderNumber() {
    return this.props.orderNumber;
  }
  get userId() {
    return this.props.userId;
  }
  get status() {
    return this.props.status;
  }
  get total() {
    return this.props.total;
  }
  get items(): readonly OrderLine[] {
    return this.props.items;
  }
  get couponCode() {
    return this.props.couponCode;
  }
  get payment(): Readonly<PaymentState> {
    return this.props.payment;
  }
  get refund(): Readonly<RefundDetails> | undefined {
    return this.props.refund;
  }
  get version() {
    return this.props.version;
  }
  get isPaymentCaptured() {
    return this.props.payment.status === 'captured';
  }

  stockLines(): StockLine[] {
    return this.props.items.map(i => ({ productId: i.productId, size: i.size, qty: i.qty }));
  }

  attachPaymentSession(provider: string, gatewayOrderId?: string): void {
    if (this.status !== 'created') throw new ConflictError(`Order is already ${this.status}`);
    this.props.payment = { ...this.props.payment, provider, ...(gatewayOrderId && { razorpayOrderId: gatewayOrderId }) };
  }

  pay(payment: CapturedPayment, now = new Date()): void {
    this.capture(payment, now);
    this.transition('paid', payment.by, 'Payment captured', now);
    this.props.paidAt = now;
    this.props.reservedUntil = undefined;
    this.record('OrderPaid', {
      orderId: this.id,
      orderNumber: this.orderNumber,
      userId: this.userId,
      total: this.total,
      provider: this.props.payment.provider,
      items: this.stockLines(),
      ...(payment.paymentId && { paymentId: payment.paymentId }),
    });
  }

  /** A capture that arrives after the order was cancelled (e.g. its reservation expired) is refunded automatically. */
  acceptLatePayment(payment: CapturedPayment, now = new Date()): void {
    if (this.status !== 'cancelled') throw new ConflictError(`Order is ${this.status}, not cancelled`);
    this.capture(payment, now);
    this.requestRefund({ by: payment.by, reason: 'Payment received after the order was cancelled' }, now);
  }

  pack(by: string, note = '', now = new Date()): void {
    this.transition('packed', by, note, now);
  }

  ship(by: string, note = '', now = new Date()): void {
    this.transition('shipped', by, note, now);
    this.record('OrderShipped', { orderId: this.id, orderNumber: this.orderNumber, userId: this.userId, by, ...(note && { note }) });
  }

  deliver(by: string, note = '', now = new Date()): void {
    this.transition('delivered', by, note, now);
    this.props.deliveredAt = now;
    this.record('OrderDelivered', { orderId: this.id, orderNumber: this.orderNumber, userId: this.userId, by });
  }

  cancel(by: string, reason: string, now = new Date()): void {
    this.transition('cancelled', by, reason, now);
    this.props.reservedUntil = undefined;
    this.record('OrderCancelled', {
      orderId: this.id,
      orderNumber: this.orderNumber,
      userId: this.userId,
      reason,
      by,
      ...(this.couponCode && { couponCode: this.couponCode }),
    });
  }

  requestRefund(request: { by: string; reason: string; windowDays?: number }, now = new Date()): void {
    if (!this.isPaymentCaptured) throw new ConflictError('Only paid orders can be refunded');
    if (this.status === 'delivered') {
      const windowDays = request.windowDays ?? REFUND_WINDOW_DAYS;
      const deliveredAt = this.props.deliveredAt ?? this.lastTransitionTo('delivered') ?? now;
      if (now.getTime() - deliveredAt.getTime() > windowDays * DAY_MS) {
        throw new ConflictError(`The ${windowDays}-day refund window for this order has closed`);
      }
    }
    const previousStatus = this.status;
    this.transition('refund_requested', request.by, request.reason, now);
    this.props.refund = {
      status: 'requested',
      amount: this.total,
      reason: request.reason,
      requestedBy: request.by,
      requestedAt: now,
      previousStatus,
    };
    this.record('RefundRequested', {
      orderId: this.id,
      orderNumber: this.orderNumber,
      userId: this.userId,
      amount: this.total,
      reason: request.reason,
      by: request.by,
      previousStatus,
    });
  }

  /** Claims the refund for submission to the gateway; false if another worker already claimed it. */
  beginRefundSubmission(): boolean {
    if (this.status !== 'refund_requested' || this.props.refund?.status !== 'requested') return false;
    this.props.refund.status = 'processing';
    return true;
  }

  /** Returns a claimed refund to the queue after a transient gateway error. */
  retryRefundSubmission(): void {
    if (this.props.refund?.status === 'processing') this.props.refund.status = 'requested';
  }

  markRefundPending(gatewayRefundId: string): void {
    this.assertRefundOpen();
    this.props.refund = { ...this.props.refund!, status: 'pending', gatewayRefundId };
  }

  /** Settles the refund. Returns false when it was already settled, making webhook replays harmless. */
  completeRefund(settlement: { by: string; gatewayRefundId?: string }, now = new Date()): boolean {
    if (this.status === 'refunded') return false;
    this.assertRefundOpen();
    const gatewayRefundId = settlement.gatewayRefundId ?? this.props.refund!.gatewayRefundId;
    this.transition('refunded', settlement.by, 'Refund processed', now);
    this.props.refund = { ...this.props.refund!, status: 'processed', completedAt: now, ...(gatewayRefundId && { gatewayRefundId }) };
    this.record('RefundCompleted', {
      orderId: this.id,
      orderNumber: this.orderNumber,
      userId: this.userId,
      amount: this.props.refund.amount,
      ...(gatewayRefundId && { gatewayRefundId }),
    });
    return true;
  }

  /** Saga compensation: the refund could not be made, so the order returns to where it was. */
  failRefund(failure: { by: string; reason: string }, now = new Date()): boolean {
    if (this.status !== 'refund_requested') return false;
    const refund = this.props.refund!;
    this.transition(refund.previousStatus, failure.by, `Refund failed: ${failure.reason}`, now);
    this.props.refund = { ...refund, status: 'failed', failureReason: failure.reason };
    this.record('RefundFailed', {
      orderId: this.id,
      orderNumber: this.orderNumber,
      userId: this.userId,
      amount: refund.amount,
      reason: failure.reason,
      restoredStatus: refund.previousStatus,
    });
    return true;
  }

  /** Units go back to stock as RETURN only if they could have reached the customer. */
  restockKind(): 'RELEASE' | 'RETURN' {
    const shipped = this.props.statusHistory.some(e => e.to === 'shipped');
    return shipped ? 'RETURN' : 'RELEASE';
  }

  pullEvents(): DomainEvent[] {
    const events = this.pendingEvents;
    this.pendingEvents = [];
    return events;
  }

  markPersisted(): void {
    this.props.version++;
  }

  snapshot(): Readonly<OrderProps> {
    return this.props;
  }

  toJSON() {
    const { id, version, ...rest } = this.props;
    return { _id: id, ...rest, version };
  }

  private capture(payment: CapturedPayment, now: Date): void {
    this.props.payment = {
      ...this.props.payment,
      ...(payment.provider && { provider: payment.provider }),
      ...(payment.paymentId && { razorpayPaymentId: payment.paymentId }),
      status: 'captured',
      capturedAt: now,
    };
  }

  private assertRefundOpen(): void {
    if (this.status !== 'refund_requested' || !this.props.refund) {
      throw new ConflictError(`Order ${this.orderNumber} has no refund in progress`);
    }
  }

  private lastTransitionTo(status: OrderStatus): Date | undefined {
    return [...this.props.statusHistory].reverse().find(e => e.to === status)?.at;
  }

  private transition(to: OrderStatus, by: string, note: string, now: Date): void {
    const from = this.props.status;
    OrderStateMachine.assert(from, to);
    this.props.status = to;
    this.props.statusHistory = [...this.props.statusHistory, { from, to, by, note, at: now }];
  }

  private record<N extends Parameters<typeof domainEvent>[0]>(name: N, payload: Parameters<typeof domainEvent<N>>[2]): void {
    this.pendingEvents.push(domainEvent(name, this.id, payload));
  }
}
