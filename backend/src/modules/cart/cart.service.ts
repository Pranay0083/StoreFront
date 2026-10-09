import { MAX_CART_LINES, MAX_LINE_QTY, toCartLine, type CartItem, type CartLine } from '@storefront/contracts';
import { logger } from '../../core/logger';
import type { ProductRepository } from '../catalog/product.repository';
import type { CartRepository } from './cart.repository';

const keyOf = (l: CartLine) => `${l.productId}::${l.size}`;

export class CartService {
  constructor(
    private readonly carts: CartRepository,
    private readonly products: ProductRepository,
  ) {}

  /** Merges duplicate lines and enforces the per-line and per-cart caps. */
  static normalize(lines: CartLine[]): CartLine[] {
    const merged = new Map<string, CartLine>();
    for (const line of lines) {
      const existing = merged.get(keyOf(line));
      merged.set(keyOf(line), { ...toCartLine(line), qty: Math.min(MAX_LINE_QTY, (existing?.qty ?? 0) + line.qty) });
    }
    return [...merged.values()].slice(0, MAX_CART_LINES);
  }

  /** Fills in title, image, price and stock from the catalog; lines for deleted products are dropped. */
  async hydrate(lines: CartLine[]): Promise<CartItem[]> {
    if (!lines.length) return [];
    const products = await this.products.findManyByIds([...new Set(lines.map(l => String(l.productId)))]);
    const byId = new Map(products.map(p => [String(p._id), p]));
    return lines.flatMap(line => {
      const product = byId.get(String(line.productId));
      if (!product) return [];
      const stock = product.sizes.find(s => s.size === line.size)?.stock ?? 0;
      return [
        {
          productId: String(product._id),
          size: line.size,
          qty: line.qty,
          title: product.title,
          image: product.images[0] ?? '',
          price: product.price,
          slug: product.slug,
          stock,
          available: stock >= line.qty,
        },
      ];
    });
  }

  async getItems(userId: string): Promise<CartItem[]> {
    const cart = await this.carts.findByUser(userId);
    return this.hydrate((cart?.items ?? []).map(i => ({ productId: String(i.productId), size: i.size, qty: i.qty })));
  }

  async replaceItems(userId: string, lines: CartLine[]): Promise<CartItem[]> {
    const items = await this.hydrate(CartService.normalize(lines));
    await this.carts.replaceLines(userId, items.map(toCartLine));
    logger.debug({ userId, itemsCount: items.length }, 'Cart updated');
    return items;
  }

  clear(userId: string): Promise<void> {
    return this.carts.clear(userId);
  }
}
