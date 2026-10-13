import { formatINR, type CustomerSegment, type Paise, type PaymentMethod, type ProductSelector } from '@storefront/contracts';
import type { PricingContext } from './pricing-line';
import { describeSelector, matchesSelector } from './selector';

export interface ConditionResult {
  ok: boolean;
  reason?: string;
}

const PASS: ConditionResult = { ok: true };
const fail = (reason: string): ConditionResult => ({ ok: false, reason });

/** Specification pattern: composable eligibility rules evaluated against a pricing context. */
export abstract class Condition {
  abstract evaluate(ctx: PricingContext): ConditionResult;
  abstract describe(): string;

  isSatisfiedBy(ctx: PricingContext): boolean {
    return this.evaluate(ctx).ok;
  }

  and(other: Condition): Condition {
    return new AllOf([this, other]);
  }

  or(other: Condition): Condition {
    return new AnyOf([this, other]);
  }

  not(): Condition {
    return new Not(this);
  }
}

export class AlwaysTrue extends Condition {
  evaluate(): ConditionResult {
    return PASS;
  }

  describe(): string {
    return 'always';
  }
}

export class AllOf extends Condition {
  constructor(readonly children: readonly Condition[]) {
    super();
  }

  evaluate(ctx: PricingContext): ConditionResult {
    for (const child of this.children) {
      const result = child.evaluate(ctx);
      if (!result.ok) return result;
    }
    return PASS;
  }

  describe(): string {
    return this.children.map(c => c.describe()).join(' and ');
  }
}

export class AnyOf extends Condition {
  constructor(readonly children: readonly Condition[]) {
    super();
  }

  evaluate(ctx: PricingContext): ConditionResult {
    const results = this.children.map(c => c.evaluate(ctx));
    if (results.some(r => r.ok)) return PASS;
    return fail(`Requires ${this.describe()}`);
  }

  describe(): string {
    return this.children.map(c => c.describe()).join(' or ');
  }
}

export class Not extends Condition {
  constructor(readonly child: Condition) {
    super();
  }

  evaluate(ctx: PricingContext): ConditionResult {
    return this.child.evaluate(ctx).ok ? fail(`Not available when ${this.child.describe()}`) : PASS;
  }

  describe(): string {
    return `not (${this.child.describe()})`;
  }
}

export class CartContains extends Condition {
  constructor(
    readonly selector: ProductSelector,
    readonly minQty: number,
  ) {
    super();
  }

  evaluate(ctx: PricingContext): ConditionResult {
    const have = ctx.lines.filter(l => matchesSelector(this.selector, l)).reduce((s, l) => s + l.qty, 0);
    if (have >= this.minQty) return PASS;
    const missing = this.minQty - have;
    return fail(`Add ${missing} more ${missing === 1 ? 'item' : 'items'} from ${describeSelector(this.selector)}`);
  }

  describe(): string {
    return `${this.minQty} or more of ${describeSelector(this.selector)}`;
  }
}

export class MinSubtotal extends Condition {
  constructor(readonly amount: Paise) {
    super();
  }

  evaluate(ctx: PricingContext): ConditionResult {
    return ctx.merchandiseSubtotal >= this.amount ? PASS : fail(`Minimum order of ${formatINR(this.amount)} required`);
  }

  describe(): string {
    return `an order of at least ${formatINR(this.amount)}`;
  }
}

const SEGMENT_LABELS: Record<CustomerSegment, string> = {
  guest: 'guest checkout',
  signedIn: 'signed-in customers',
  firstOrder: "a customer's first order",
  returning: 'returning customers',
};

export class CustomerSegmentCondition extends Condition {
  constructor(readonly segment: CustomerSegment) {
    super();
  }

  evaluate(ctx: PricingContext): ConditionResult {
    const { signedIn, isFirstOrder } = ctx.customer;
    const ok = {
      guest: !signedIn,
      signedIn,
      firstOrder: signedIn && isFirstOrder,
      returning: signedIn && !isFirstOrder,
    }[this.segment];
    if (ok) return PASS;
    return fail(this.segment === 'guest' ? 'Only available at guest checkout' : `Only available for ${SEGMENT_LABELS[this.segment]}`);
  }

  describe(): string {
    return SEGMENT_LABELS[this.segment];
  }
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const STORE_TIME_ZONE = 'Asia/Kolkata';
const storeClock = new Intl.DateTimeFormat('en-US', { timeZone: STORE_TIME_ZONE, weekday: 'short', hour: 'numeric', hourCycle: 'h23' });

function storeTime(now: Date): { day: number; hour: number } {
  const parts = Object.fromEntries(storeClock.formatToParts(now).map(p => [p.type, p.value]));
  return { day: WEEKDAYS.indexOf(parts.weekday), hour: Number(parts.hour) };
}

/** Time windows are evaluated in the store's time zone (IST) so flash sales match the storefront clock. */
export class DateWindow extends Condition {
  constructor(
    readonly from?: Date,
    readonly to?: Date,
    readonly daysOfWeek?: readonly number[],
    readonly hours?: { start: number; end: number },
  ) {
    super();
  }

  evaluate(ctx: PricingContext): ConditionResult {
    const closed = fail('This offer is not active right now');
    if (this.from && ctx.now < this.from) return closed;
    if (this.to && ctx.now >= this.to) return closed;
    const { day, hour } = storeTime(ctx.now);
    if (this.daysOfWeek && !this.daysOfWeek.includes(day)) return closed;
    if (this.hours && (hour < this.hours.start || hour >= this.hours.end)) return closed;
    return PASS;
  }

  describe(): string {
    const parts = [];
    if (this.daysOfWeek) parts.push(`on ${this.daysOfWeek.map(d => WEEKDAYS[d]).join('/')}`);
    if (this.hours) parts.push(`between ${this.hours.start}:00 and ${this.hours.end}:00 IST`);
    if (this.from || this.to) parts.push('during the sale window');
    return parts.join(' ') || 'any time';
  }
}

const METHOD_LABELS: Record<PaymentMethod, string> = {
  upi: 'UPI',
  card: 'card',
  netbanking: 'netbanking',
  wallet: 'wallet',
  demo: 'demo pay',
};

export class PaymentMethodCondition extends Condition {
  constructor(readonly methods: readonly PaymentMethod[]) {
    super();
  }

  evaluate(ctx: PricingContext): ConditionResult {
    if (ctx.paymentMethod && this.methods.includes(ctx.paymentMethod)) return PASS;
    return fail(`Pay with ${this.describeMethods()} to use this offer`);
  }

  describe(): string {
    return `paying with ${this.describeMethods()}`;
  }

  private describeMethods() {
    return this.methods.map(m => METHOD_LABELS[m]).join(' or ');
  }
}
