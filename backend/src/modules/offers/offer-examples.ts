import { MAX_LINE_QTY, type Paise, type PricingItem } from '@storefront/contracts';
import type { CatalogProduct } from '../pricing/pricing.ports';

/**
 * Candidate bags for an offer's worked example. These only choose *which* pieces to show; every
 * price, saving and total shown is then computed by the pricing engine on the chosen bag.
 */
export interface ExampleLine {
  product: CatalogProduct;
  size: string;
  stock: number;
  qty: number;
}
export type ExampleCart = ExampleLine[];

/** The first size with at least `minStock` units. */
export function firstSize(product: CatalogProduct, minStock = 1): { size: string; stock: number } | undefined {
  return product.sizes.find(s => s.stock >= Math.max(1, minStock));
}

const listTotal = (cart: ExampleCart) => cart.reduce((s, l) => s + l.product.price * l.qty, 0);
const key = (cart: ExampleCart) =>
  cart
    .map(l => `${l.product.id}:${l.qty}`)
    .sort()
    .join('|');

function line(product: CatalogProduct, qty: number, minStock = 1): ExampleLine | undefined {
  const size = firstSize(product, Math.max(minStock, qty));
  return size && { product, size: size.size, stock: size.stock, qty };
}

function cheapestFirst(carts: ExampleCart[], max: number): ExampleCart[] {
  const seen = new Set<string>();
  return carts
    .sort((a, b) => listTotal(a) - listTotal(b))
    .filter(c => !seen.has(key(c)) && seen.add(key(c)))
    .slice(0, max);
}

export const toItems = (cart: ExampleCart): PricingItem[] => cart.map(l => ({ productId: l.product.id, size: l.size, qty: l.qty }));

/** One piece per bundle slot, all different, whose list total is above the bundle price; cheapest sets first. */
export function bundleCarts(
  slots: ReadonlyArray<{ products: readonly CatalogProduct[]; qty: number }>,
  price: Paise,
  max = 3,
): ExampleCart[] {
  const out: ExampleCart[] = [];
  const walk = (i: number, picked: ExampleCart) => {
    if (out.length > 2_000) return;
    if (i === slots.length) {
      if (listTotal(picked) > price) out.push(picked);
      return;
    }
    for (const product of slots[i].products) {
      if (picked.some(l => l.product.id === product.id)) continue;
      const l = line(product, slots[i].qty);
      if (l) walk(i + 1, [...picked, l]);
    }
  };
  walk(0, []);
  return cheapestFirst(out, max);
}

function combinations<T>(items: readonly T[], k: number, limit = 2_000): T[][] {
  const out: T[][] = [];
  const walk = (start: number, picked: T[]) => {
    if (out.length >= limit) return;
    if (picked.length === k) return void out.push(picked);
    for (let i = start; i <= items.length - (k - picked.length); i++) walk(i + 1, [...picked, items[i]]);
  };
  walk(0, []);
  return out;
}

/**
 * `units` pieces drawn from one selector (any-N-for and buy-X-get-Y), cheapest qualifying sets first:
 * different pieces where the catalogue has enough, otherwise repeats of the cheapest in stock. With
 * `above`, a set only qualifies when its list total is above that price (otherwise nothing is saved).
 */
export function multiUnitCarts(products: readonly CatalogProduct[], units: number, above?: Paise, max = 3): ExampleCart[] {
  const qualifies = (c: ExampleCart) => above === undefined || listTotal(c) > above;
  const singles = products.slice(0, 12).flatMap(p => line(p, 1) ?? []);
  const distinct = combinations(singles, units).filter(qualifies);
  if (distinct.length) return cheapestFirst(distinct, max);

  // Too few different pieces (or none dear enough): fill with repeats, cheapest first, then dearest first.
  const fill = (ordered: readonly CatalogProduct[]): ExampleCart | undefined => {
    const cart: ExampleCart = [];
    let left = units;
    for (const p of ordered) {
      const size = firstSize(p);
      if (!size || left === 0) continue;
      const qty = Math.min(left, size.stock, MAX_LINE_QTY);
      cart.push({ product: p, size: size.size, stock: size.stock, qty });
      left -= qty;
    }
    return left === 0 ? cart : undefined;
  };
  const filled = [fill(products), fill([...products].reverse())].filter((c): c is ExampleCart => Boolean(c && qualifies(c)));
  return cheapestFirst(filled, max);
}

/** Single pieces for a sale or order offer; with a minimum spend, the cheapest piece that reaches it. */
export function singleCarts(
  products: readonly CatalogProduct[],
  opts: { minSpend?: Paise; minStock?: number } = {},
  max = 3,
): ExampleCart[] {
  const { minSpend = 0, minStock = 1 } = opts;
  const reaching = products.flatMap(p => (p.price >= minSpend ? (line(p, 1, minStock) ?? []) : [])).map(l => [l]);
  if (reaching.length) return cheapestFirst(reaching, max);
  const dearest = [...products].sort((a, b) => b.price - a.price)[0];
  if (!dearest || minSpend === 0) return [];
  const qty = Math.ceil(minSpend / dearest.price);
  const l = qty <= MAX_LINE_QTY ? line(dearest, qty, minStock) : undefined;
  return l ? [[l]] : [];
}
