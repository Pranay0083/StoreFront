import type { PriceBreakdown } from '@storefront/contracts';
import type { PricingContext, PricingLine } from './pricing-line';
import { listSubtotal } from './pricing-line';
import { CompiledPromotion, type PromotionDefinition } from './promotion';

let seq = 0;

export function line(overrides: Partial<PricingLine> & { slug?: string } = {}): PricingLine {
  seq += 1;
  const slug = overrides.slug ?? `product-${seq}`;
  return {
    productId: overrides.productId ?? `pid-${slug}`,
    slug,
    title: overrides.title ?? slug.replace(/-/g, ' '),
    category: 'Men',
    size: 'M',
    qty: 1,
    unitPrice: 100_000,
    stock: 10,
    productCreatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

export function context(lines: PricingLine[], overrides: Partial<PricingContext> = {}): PricingContext {
  return {
    now: new Date('2026-10-30T06:30:00Z'),
    lines,
    merchandiseSubtotal: listSubtotal(lines),
    customer: { id: 'u1', signedIn: true, isFirstOrder: false },
    ...overrides,
  };
}

export function promo(overrides: Partial<PromotionDefinition> & Pick<PromotionDefinition, 'id' | 'action'>): CompiledPromotion {
  return new CompiledPromotion({
    version: 1,
    name: overrides.id,
    description: '',
    status: 'active',
    activation: overrides.code ? 'code' : 'auto',
    priority: 100,
    exclusive: false,
    usedCount: 0,
    showOnStorefront: !overrides.code,
    ...overrides,
  });
}

/** Accounting identities every breakdown must satisfy. */
export function breakdownInvariantViolations(b: PriceBreakdown): string[] {
  const errors: string[] = [];
  const check = (ok: boolean, msg: string) => ok || errors.push(msg);
  const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
  check(b.total >= 0, 'total is negative');
  check(b.listSubtotal - b.markdownTotal === b.merchandiseSubtotal, 'markdowns do not reconcile');
  check(sum(b.lines.map(l => l.lineTotal)) === b.merchandiseSubtotal - b.discountTotal, 'line totals do not reconcile');
  check(b.total === b.merchandiseSubtotal - b.discountTotal + b.shipping - b.shippingDiscount, 'total does not reconcile');
  check(b.totalSavings === b.markdownTotal + b.discountTotal + b.shippingDiscount, 'savings do not reconcile');
  for (const l of b.lines) {
    check(l.lineTotal >= 0, `line ${l.slug} is negative`);
    check(l.lineSubtotal - sum(l.discounts.map(d => d.amount)) === l.lineTotal, `line ${l.slug} does not reconcile`);
    check(l.effectiveUnitPrice === l.unitPrice - l.markdownPerUnit, `line ${l.slug} markdown mismatch`);
  }
  for (const a of b.applied) {
    if (a.stage === 'markdown' || a.stage === 'shipping') continue;
    const allocated = sum(b.lines.flatMap(l => l.discounts.filter(d => d.promotionId === a.promotionId).map(d => d.amount)));
    check(allocated === a.amount, `allocation for ${a.promotionId} is ${allocated}, expected ${a.amount}`);
  }
  return errors;
}
