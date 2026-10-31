import { describe, expect, it } from 'vitest';
import { MAX_LINE_QTY } from './cart';
import { FREE_SHIPPING_THRESHOLD, SHIPPING_FEE, formatINR, shippingFor } from './money';
import {
  CUSTOMER_CANCELLABLE_STATUSES,
  CreateOrderSchema,
  ORDER_STATUSES,
  PARTIAL_REFUND_STATUSES,
  REFUND_WINDOW_DAYS,
  canTransition,
  refundableAmount,
} from './orders';
import {
  ORDER_LIMITS,
  POLICIES,
  POLICY_HIGHLIGHTS,
  POLICY_SLUGS,
  SIZE_RANGES,
  getPolicy,
  policyDigest,
  policyPath,
  policyText,
  type PolicySlug,
} from './policies';

const text = (slug: PolicySlug) => policyText(slug) + '\n' + policyDigest(slug);

describe('policy documents', () => {
  it('has exactly one document per slug, each with content and unique section anchors', () => {
    expect(POLICIES.map(d => d.slug).sort()).toEqual([...POLICY_SLUGS].sort());
    for (const doc of POLICIES) {
      expect(getPolicy(doc.slug)).toBe(doc);
      expect(doc.summary.length).toBeLessThanOrEqual(120);
      expect(doc.lastUpdated).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(doc.keyPoints.length).toBeGreaterThan(0);
      const ids = doc.sections.map(s => s.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const s of doc.sections) expect(s.blocks.length).toBeGreaterThan(0);
    }
    expect(getPolicy('nope')).toBeUndefined();
  });

  it('points every highlight at a section that exists', () => {
    for (const h of Object.values(POLICY_HIGHLIGHTS)) {
      const doc = getPolicy(h.slug)!;
      if ('section' in h) expect(doc.sections.map(s => s.id)).toContain(h.section);
    }
    expect(policyPath('returns')).toBe('/policies/returns');
    expect(policyPath('payments', 'stock-hold')).toBe('/policies/payments#stock-hold');
  });

  it('never invents contact details or legal entities', () => {
    const all = POLICY_SLUGS.map(policyText).join('\n');
    expect(all).not.toMatch(/@[a-z0-9-]+\.[a-z]/i);
    expect(all).not.toMatch(/\+91|\b\d{10}\b|GSTIN|CIN\b|Pvt\.? Ltd|Private Limited|LLP\b/);
  });
});

describe('policies state the rules the code enforces', () => {
  it('delivery: the free-shipping threshold and flat fee come from shippingFor', () => {
    expect(shippingFor(FREE_SHIPPING_THRESHOLD)).toBe(0);
    expect(shippingFor(FREE_SHIPPING_THRESHOLD - 1)).toBe(SHIPPING_FEE);
    for (const t of [text('shipping'), POLICY_HIGHLIGHTS.delivery.text]) {
      expect(t).toContain(formatINR(FREE_SHIPPING_THRESHOLD));
      expect(t).toContain(formatINR(SHIPPING_FEE));
    }
  });

  it('returns: the refund window, partial returns after delivery and refunds at the price paid', () => {
    expect(PARTIAL_REFUND_STATUSES).toContain('delivered');
    expect(text('returns')).toContain(`${REFUND_WINDOW_DAYS} days of delivery`);
    expect(POLICY_HIGHLIGHTS.returns.text).toContain(`${REFUND_WINDOW_DAYS} days`);
    // Units of a line add back up to what was paid for it, so "refunded at what you paid" holds.
    const line = { lineTotal: 100_001, qty: 3 };
    expect(refundableAmount(line, 0, 1) + refundableAmount(line, 1, 1) + refundableAmount(line, 2, 1)).toBe(line.lineTotal);
    expect(text('returns')).toMatch(/Delivery is refunded .*nothing on the order unrefunded/);
  });

  it('cancellations: possible before shipping and never after', () => {
    expect(CUSTOMER_CANCELLABLE_STATUSES).not.toContain('shipped');
    expect(CUSTOMER_CANCELLABLE_STATUSES).not.toContain('delivered');
    expect(canTransition('shipped', 'cancelled')).toBe(false);
    expect(canTransition('shipped', 'refund_requested')).toBe(false);
    for (const s of CUSTOMER_CANCELLABLE_STATUSES) expect(ORDER_STATUSES.indexOf(s)).toBeLessThan(ORDER_STATUSES.indexOf('shipped'));
    expect(text('cancellations')).toContain('waiting for payment, paid or packed');
  });

  it('terms: order limits are read from the checkout schema', () => {
    expect(ORDER_LIMITS.perLine).toBe(MAX_LINE_QTY);
    const tooMany = (n: number) => Array.from({ length: n }, (_, i) => ({ productId: `p${i}`, size: 'M', qty: 1 }));
    const address = { name: 'Asha', line1: '12 Lake Road', city: 'Pune', state: 'MH', pincode: '411001', phone: '9876543210' };
    expect(CreateOrderSchema.safeParse({ items: tooMany(ORDER_LIMITS.distinctPieces), address }).success).toBe(true);
    expect(CreateOrderSchema.safeParse({ items: tooMany(ORDER_LIMITS.distinctPieces + 1), address }).success).toBe(false);
    const codes = (n: number) => Array.from({ length: n }, (_, i) => `CODE${i}`);
    expect(CreateOrderSchema.safeParse({ items: tooMany(1), address, codes: codes(ORDER_LIMITS.promoCodes) }).success).toBe(true);
    expect(CreateOrderSchema.safeParse({ items: tooMany(1), address, codes: codes(ORDER_LIMITS.promoCodes + 1) }).success).toBe(false);
    expect(text('terms')).toContain(`Up to ${ORDER_LIMITS.promoCodes} promo codes`);
  });

  it('size guide: covers apparel XS to XXL and footwear UK 6 to UK 11', () => {
    expect(SIZE_RANGES.apparel).toEqual(['XS', 'S', 'M', 'L', 'XL', 'XXL']);
    expect(SIZE_RANGES.footwear).toEqual(['UK 6', 'UK 7', 'UK 8', 'UK 9', 'UK 10', 'UK 11']);
  });

  it('privacy: names what is stored and that payment details stay with Razorpay', () => {
    const privacy = text('privacy');
    for (const subject of ['password', 'delivery address', 'cookie', 'visitor ID', 'transcript', 'Razorpay', 'AI provider']) {
      expect(privacy).toContain(subject);
    }
  });
});
