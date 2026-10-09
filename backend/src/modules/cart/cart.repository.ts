import type { CartLine } from '@storefront/contracts';
import { CartModel, type CartRecord } from './cart.model';

export class CartRepository {
  findByUser(userId: string): Promise<CartRecord | null> {
    return CartModel.findOne({ userId }).lean<CartRecord>();
  }

  async replaceLines(userId: string, lines: CartLine[]): Promise<void> {
    await CartModel.updateOne({ userId }, { $set: { items: lines } }, { upsert: true });
  }

  async clear(userId: string): Promise<void> {
    await CartModel.updateOne({ userId }, { $set: { items: [] } });
  }

  countNonEmpty(): Promise<number> {
    return CartModel.countDocuments({ 'items.0': { $exists: true } });
  }
}
