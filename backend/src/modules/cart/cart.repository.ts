import type { CartItem } from '@storefront/contracts';
import { CartModel, type CartRecord } from './cart.model';

export class CartRepository {
  findByUser(userId: string): Promise<CartRecord | null> {
    return CartModel.findOne({ userId }).lean<CartRecord>();
  }

  async replaceItems(userId: string, items: CartItem[]): Promise<void> {
    await CartModel.updateOne({ userId }, { $set: { items } }, { upsert: true });
  }

  async clear(userId: string): Promise<void> {
    await CartModel.updateOne({ userId }, { $set: { items: [] } });
  }

  countNonEmpty(): Promise<number> {
    return CartModel.countDocuments({ 'items.0': { $exists: true } });
  }
}
