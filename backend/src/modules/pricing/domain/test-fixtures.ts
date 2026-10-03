import type { PricingContext, PricingLine } from './pricing-line';
import { listSubtotal } from './pricing-line';

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
