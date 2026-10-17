import {
  PARTIAL_REFUND_STATUSES,
  REFUND_WINDOW_DAYS,
  refundableAmount,
  type Address,
  type LineDiscount,
  type OrderPricing,
  type OrderRefundLine,
  type OrderStatus,
  type Paise,
  type RefundKind,
  type RefundState,
} from '@storefront/contracts';
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
  markdownPerUnit: Paise;
  discounts: LineDiscount[];
  lineTotal: Paise;
  refundedQty: number;
  refundedAmount: Paise;
}

export type NewOrderLine = Omit<OrderLine, 'refundedQty' | 'refundedAmount'>;

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
  id: string;
  kind: RefundKind;
  status: RefundState;
  amount: Paise;
  lines: OrderRefundLine[];
  shippingAmount: Paise;
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
  pricing?: OrderPricing;
  status: OrderStatus;
  statusHistory: StatusEvent[];
  payment: PaymentState;
  refunds: RefundDetails[];
  refundedAmount: Paise;
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
  items: NewOrderLine[];
  address: Address;
  subtotal: Paise;
  shipping: Paise;
  discount: Paise;
  pricing?: OrderPricing;
  reservedUntil: Date;
}

export interface CapturedPayment {
  by: string;
  paymentId?: string;
  provider?: string;
}

export interface RefundRequestDetails {
  by: string;
  reason: string;
  windowDays?: number;
  /** Units to refund; omitted means everything not yet refunded. */
  lines?: ReadonlyArray<{ productId: string; size: string; qty: number }>;
}

const OPEN_REFUND_STATES: readonly RefundState[] = ['requested', 'processing', 'pending'];
const lineKey = (l: { productId: string; size: string }) => `${l.productId}::${l.size}`;

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
    const linesTotal = input.items.reduce((sum, i) => sum + i.lineTotal, 0);
    if (linesTotal !== input.subtotal - input.discount) {
      throw new BadRequestError('Order lines do not add up to the discounted subtotal');
    }
    if (input.pricing && input.pricing.stages.total !== total) throw new BadRequestError('Order total does not match its pricing');
    const order = new Order({
      ...input,
      items: input.items.map(i => ({ ...i, refundedQty: 0, refundedAmount: 0 })),
      id: new Types.ObjectId().toHexString(),
      total,
      refunds: [],
      refundedAmount: 0,
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
      ...(input.pricing?.applied.length && { promotionIds: input.pricing.applied.map(a => a.promotionId) }),
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
  get payment(): Readonly<PaymentState> {
    return this.props.payment;
  }
  get refunds(): readonly RefundDetails[] {
    return this.props.refunds;
  }
  /** The refund currently being processed, if any; at most one is open at a time. */
  get openRefund(): Readonly<RefundDetails> | undefined {
    return this.findOpenRefund();
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
    });
  }

  /**
   * Opens a refund for specific units, or for everything not yet refunded. Line amounts come from
   * each line's paid total split over its units, so successive partial refunds add up to exactly
   * what was paid; shipping is only returned by the refund that leaves nothing unrefunded.
   */
  requestRefund(request: RefundRequestDetails, now = new Date()): RefundDetails {
    if (!this.isPaymentCaptured) throw new ConflictError('Only paid orders can be refunded');
    if (PARTIAL_REFUND_STATUSES.includes(this.status)) {
      const windowDays = request.windowDays ?? REFUND_WINDOW_DAYS;
      const deliveredAt = this.props.deliveredAt ?? this.lastTransitionTo('delivered') ?? now;
      if (now.getTime() - deliveredAt.getTime() > windowDays * DAY_MS) {
        throw new ConflictError(`The ${windowDays}-day refund window for this order has closed`);
      }
    }

    const wanted = this.refundUnits(request.lines);
    const remainingUnits = this.props.items.reduce((s, i) => s + i.qty - i.refundedQty, 0);
    const requestedUnits = [...wanted.values()].reduce((s, q) => s + q, 0);
    if (requestedUnits === 0) throw new ConflictError('Nothing left to refund on this order');
    const kind: RefundKind = requestedUnits === remainingUnits ? 'full' : 'partial';
    if (kind === 'partial' && !PARTIAL_REFUND_STATUSES.includes(this.status)) {
      throw new ConflictError('Individual items can be returned once the order is delivered; cancel the whole order instead');
    }

    const lines: OrderRefundLine[] = this.props.items
      .filter(i => wanted.has(lineKey(i)))
      .map(i => {
        const qty = wanted.get(lineKey(i))!;
        return { productId: i.productId, size: i.size, qty, amount: refundableAmount(i, i.refundedQty, qty) };
      });
    const shippingAmount = kind === 'full' ? this.props.shipping : 0;
    const amount = lines.reduce((s, l) => s + l.amount, 0) + shippingAmount;

    const previousStatus = this.status;
    this.transition('refund_requested', request.by, request.reason, now);
    const refund: RefundDetails = {
      id: new Types.ObjectId().toHexString(),
      kind,
      status: 'requested',
      amount,
      lines,
      shippingAmount,
      reason: request.reason,
      requestedBy: request.by,
      requestedAt: now,
      previousStatus,
    };
    this.props.refunds = [...this.props.refunds, refund];
    this.record('RefundRequested', {
      orderId: this.id,
      orderNumber: this.orderNumber,
      userId: this.userId,
      refundId: refund.id,
      kind,
      amount,
      lines,
      reason: request.reason,
      by: request.by,
      previousStatus,
    });
    return refund;
  }

  /** Claims the open refund for submission to the gateway; false if another worker already claimed it. */
  beginRefundSubmission(): boolean {
    const refund = this.findOpenRefund();
    if (this.status !== 'refund_requested' || refund?.status !== 'requested') return false;
    refund.status = 'processing';
    return true;
  }

  /** Returns a claimed refund to the queue after a transient gateway error. */
  retryRefundSubmission(): void {
    const refund = this.findOpenRefund();
    if (refund?.status === 'processing') refund.status = 'requested';
  }

  markRefundPending(gatewayRefundId: string): void {
    const refund = this.requireOpenRefund();
    refund.status = 'pending';
    refund.gatewayRefundId = gatewayRefundId;
  }

  /**
   * Settles the open refund: marks its units refunded and moves the order to `refunded` once nothing
   * is left, otherwise to `partially_refunded`. Returns the settled refund, or null when there is
   * nothing to settle (a webhook replay, or a notification about a different refund).
   */
  completeRefund(settlement: { by: string; gatewayRefundId?: string }, now = new Date()): RefundDetails | null {
    const refund = this.findOpenRefund();
    if (!refund || this.status !== 'refund_requested') return null;
    if (settlement.gatewayRefundId && refund.gatewayRefundId && refund.gatewayRefundId !== settlement.gatewayRefundId) return null;

    const settled = new Map(refund.lines.map(l => [lineKey(l), l]));
    this.props.items = this.props.items.map(i => {
      const line = settled.get(lineKey(i));
      return line ? { ...i, refundedQty: i.refundedQty + line.qty, refundedAmount: i.refundedAmount + line.amount } : i;
    });
    this.props.refundedAmount += refund.amount;
    const fullyRefunded = this.props.items.every(i => i.refundedQty >= i.qty);
    this.transition(fullyRefunded ? 'refunded' : 'partially_refunded', settlement.by, 'Refund processed', now);

    const gatewayRefundId = settlement.gatewayRefundId ?? refund.gatewayRefundId;
    refund.status = 'processed';
    refund.completedAt = now;
    if (gatewayRefundId) refund.gatewayRefundId = gatewayRefundId;
    this.record('RefundCompleted', {
      orderId: this.id,
      orderNumber: this.orderNumber,
      userId: this.userId,
      refundId: refund.id,
      amount: refund.amount,
      lines: refund.lines,
      fullyRefunded,
      ...(gatewayRefundId && { gatewayRefundId }),
    });
    return { ...refund };
  }

  /** Saga compensation: the refund could not be made, so the order returns to where it was. */
  failRefund(failure: { by: string; reason: string }, now = new Date()): boolean {
    const refund = this.findOpenRefund();
    if (this.status !== 'refund_requested' || !refund) return false;
    this.transition(refund.previousStatus, failure.by, `Refund failed: ${failure.reason}`, now);
    refund.status = 'failed';
    refund.failureReason = failure.reason;
    this.record('RefundFailed', {
      orderId: this.id,
      orderNumber: this.orderNumber,
      userId: this.userId,
      refundId: refund.id,
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

  private findOpenRefund(): RefundDetails | undefined {
    return [...this.props.refunds].reverse().find(r => OPEN_REFUND_STATES.includes(r.status));
  }

  private requireOpenRefund(): RefundDetails {
    const refund = this.findOpenRefund();
    if (this.status !== 'refund_requested' || !refund) throw new ConflictError(`Order ${this.orderNumber} has no refund in progress`);
    return refund;
  }

  /** Validates requested units against what is still refundable; defaults to everything that is. */
  private refundUnits(lines: RefundRequestDetails['lines']): Map<string, number> {
    const remaining = new Map(this.props.items.map(i => [lineKey(i), i.qty - i.refundedQty]));
    if (!lines) return new Map([...remaining].filter(([, qty]) => qty > 0));
    const wanted = new Map<string, number>();
    for (const line of lines) wanted.set(lineKey(line), (wanted.get(lineKey(line)) ?? 0) + line.qty);
    for (const [key, qty] of wanted) {
      if (!remaining.has(key)) throw new BadRequestError(`This order has no item ${key.replace('::', ' in size ')}`);
      if (qty > remaining.get(key)!) throw new ConflictError(`Only ${remaining.get(key)} of that item can still be refunded`);
    }
    return wanted;
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
