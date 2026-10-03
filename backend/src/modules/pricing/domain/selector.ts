import type { ProductSelector } from '@storefront/contracts';

export interface SelectableProduct {
  productId: string;
  slug: string;
  category: string;
}

/** An absent selector means "the whole cart". */
export function matchesSelector(selector: ProductSelector | undefined, product: SelectableProduct): boolean {
  if (!selector) return true;
  return Boolean(
    selector.productIds?.includes(product.productId) || selector.slugs?.includes(product.slug) || selector.categories?.includes(product.category),
  );
}

const humanize = (slug: string) => slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

export function describeSelector(selector: ProductSelector | undefined): string {
  if (!selector) return 'any item';
  const parts = [...(selector.slugs ?? []).map(humanize), ...(selector.categories ?? []).map(c => `${c} items`)];
  if (selector.productIds?.length) parts.push(selector.productIds.length === 1 ? 'a selected product' : 'selected products');
  if (parts.length <= 2) return parts.join(' or ');
  return `${parts.slice(0, -1).join(', ')} or ${parts[parts.length - 1]}`;
}
