import type { CartItem } from '@storefront/contracts';
import { logger } from '../../core/logger';
import type { CartRepository } from './cart.repository';

export class CartService {
  constructor(private readonly carts: CartRepository) {}

  async getItems(userId: string) {
    return (await this.carts.findByUser(userId))?.items ?? [];
  }

  async replaceItems(userId: string, items: CartItem[]): Promise<void> {
    await this.carts.replaceItems(userId, items);
    logger.debug({ userId, itemsCount: items.length }, 'Cart updated');
  }

  clear(userId: string): Promise<void> {
    return this.carts.clear(userId);
  }
}
