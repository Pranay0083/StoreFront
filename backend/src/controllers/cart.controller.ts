import { Cart } from '../models';
import { logger } from '../utils/logger';

/**
 * Retrieves the authenticated user's cart.
 */
export const getCart = async (req: any, res: any, next: any) => {
  try {
    const cart = await Cart.findOne({ userId: req.user.id }).lean();
    res.json({ items: cart?.items ?? [] });
  } catch (e) { next(e); }
};

/**
 * Updates the user's cart items, creating a new cart if one doesn't exist.
 */
export const updateCart = async (req: any, res: any, next: any) => {
  try {
    await Cart.updateOne(
      { userId: req.user.id },
      { $set: { items: req.body.items } },
      { upsert: true }
    );
    logger.info({ userId: req.user.id, itemsCount: req.body.items.length }, 'User cart updated');
    res.json({ ok: true });
  } catch (e) { next(e); }
};
