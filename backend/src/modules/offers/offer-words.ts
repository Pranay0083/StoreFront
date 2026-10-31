import { formatINR, type ActionSpec, type ConditionSpec, type CustomerSegment, type PaymentMethod } from '@storefront/contracts';
import { buildCondition } from '../pricing/domain/condition.factory';
import { describeSelector } from '../pricing/domain/selector';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const SEGMENTS: Record<CustomerSegment, string> = {
  guest: 'At guest checkout',
  signedIn: 'When you are signed in',
  firstOrder: 'On your first order',
  returning: 'For returning customers',
};
const METHODS: Record<PaymentMethod, string> = { upi: 'UPI', card: 'card', netbanking: 'netbanking', wallet: 'a wallet', demo: 'demo pay' };
const storeDate = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });

const joinWords = (words: readonly string[], last = 'and') =>
  words.length <= 1 ? (words[0] ?? '') : `${words.slice(0, -1).join(', ')} ${last} ${words[words.length - 1]}`;
const hour = (h: number) => `${String(h % 24).padStart(2, '0')}:00`;
const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function term(spec: ConditionSpec): string[] {
  switch (spec.type) {
    case 'all':
      return spec.conditions.flatMap(term);
    case 'minSubtotal':
      return [`On orders of ${formatINR(spec.amount)} or more`];
    case 'customerSegment':
      return [SEGMENTS[spec.segment]];
    case 'paymentMethod':
      return [
        `When you pay by ${joinWords(
          spec.methods.map(m => METHODS[m]),
          'or',
        )}`,
      ];
    case 'cartContains':
      return [`With at least ${spec.minQty} of ${describeSelector(spec.selector)} in the bag`];
    case 'dateWindow': {
      const out: string[] = [];
      if (spec.daysOfWeek) out.push(`Every ${joinWords(spec.daysOfWeek.map(d => DAYS[d]))}`);
      if (spec.hours) out.push(`From ${hour(spec.hours.start)} to ${hour(spec.hours.end)} IST`);
      if (spec.from) out.push(`From ${storeDate.format(new Date(spec.from))}`);
      if (spec.to) out.push(`Until ${storeDate.format(new Date(spec.to))}`);
      return out;
    }
    default:
      return [`Requires ${buildCondition(spec).describe()}`];
  }
}

/** The conditions as short sentences a shopper can act on. */
export function offerTerms(spec: ConditionSpec | null | undefined): string[] {
  return spec ? term(spec).map(capitalise) : [];
}

/** The segment the offer is limited to, if a top-level condition names one. */
export function segmentOf(spec: ConditionSpec | null | undefined): CustomerSegment | undefined {
  if (!spec) return undefined;
  if (spec.type === 'customerSegment') return spec.segment;
  if (spec.type === 'all') return spec.conditions.map(segmentOf).find(Boolean);
  return undefined;
}

/** The first payment method a top-level condition asks for, so the example can be priced with it. */
export function paymentMethodOf(spec: ConditionSpec | null | undefined): PaymentMethod | undefined {
  if (!spec) return undefined;
  if (spec.type === 'paymentMethod') return spec.methods[0];
  if (spec.type === 'all') return spec.conditions.map(paymentMethodOf).find(Boolean);
  return undefined;
}

/** The highest minimum spend a top-level condition sets. */
export function minSpendOf(spec: ConditionSpec | null | undefined): number | undefined {
  if (!spec) return undefined;
  if (spec.type === 'minSubtotal') return spec.amount;
  if (spec.type === 'all') {
    const amounts = spec.conditions.map(minSpendOf).filter((a): a is number => a !== undefined);
    return amounts.length ? Math.max(...amounts) : undefined;
  }
  return undefined;
}

/** The reward in a few words, straight from the rule. */
export function offerHeadline(action: ActionSpec): string {
  switch (action.type) {
    case 'fixedBundle':
      return `The set for ${formatINR(action.price)}`;
    case 'mixAndMatch':
      return `Any ${action.quantity} for ${formatINR(action.price)}`;
    case 'buyXGetY':
      return `Buy ${action.buyQty}, get ${action.getQty} ${action.percentOff === 100 ? 'free' : `at ${action.percentOff}% off`}`;
    case 'tiered': {
      const top = action.tiers[action.tiers.length - 1];
      const reward = top.percentOff !== undefined ? `${top.percentOff}% off` : `${formatINR(top.amountOff ?? 0)} off`;
      return action.tiers.length > 1 ? `Up to ${reward}` : `${capitalise(reward)} over ${formatINR(top.minSubtotal)}`;
    }
    case 'percentOff':
      return `${action.percent}% off`;
    case 'flatOff':
      return `${formatINR(action.amount)} off`;
    case 'freeShipping':
      return 'Free delivery';
    case 'markdown':
    case 'clearance':
      return `${action.percentOff}% off`;
  }
}
