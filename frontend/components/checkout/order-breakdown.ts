import type { Order, PriceBreakdown, PricedLine } from '@storefront/contracts';

/**
 * An order's own receipt, in the shape the live quote has, so a placed order prints on the same paper
 * as the bag did. Orders placed before the optimizer carry only a discount total, set as one line.
 */
export function orderBreakdown(order: Order): PriceBreakdown {
  const lines: PricedLine[] = order.items.map(i => {
    const markdown = i.markdownPerUnit ?? 0;
    return {
      productId: i.productId,
      slug: i.slug,
      title: i.title,
      image: i.image,
      category: '',
      size: i.size,
      qty: i.qty,
      unitPrice: i.price,
      markdownPerUnit: markdown,
      effectiveUnitPrice: i.price - markdown,
      lineSubtotal: (i.price - markdown) * i.qty,
      discounts: i.discounts ?? [],
      lineTotal: i.lineTotal,
    };
  });
  const common = { currency: 'INR' as const, lines, suggestions: [], rejectedCodes: [] };

  const p = order.pricing;
  if (p) {
    const s = p.stages;
    return {
      ...common,
      ...s,
      merchandiseSubtotal: s.listSubtotal - s.markdownTotal,
      discountTotal: s.bundleDiscount + s.cartDiscount + s.codeDiscount,
      applied: p.applied,
      explanations: p.explanations ?? [],
      optimizer: p.optimizer,
    };
  }

  return {
    ...common,
    listSubtotal: order.subtotal,
    markdownTotal: 0,
    merchandiseSubtotal: order.subtotal,
    bundleDiscount: 0,
    cartDiscount: order.discount,
    codeDiscount: 0,
    discountTotal: order.discount,
    shipping: order.shipping,
    shippingDiscount: 0,
    total: order.total,
    totalSavings: order.discount,
    applied: [],
    explanations: order.couponCode ? [`Coupon ${order.couponCode} was applied when this order was placed.`] : [],
    optimizer: { strategy: 'greedy-fallback', nodesExplored: 0, bundleSavings: 0, greedySavings: 0 },
  };
}
