import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, validate } from '../middleware';
import { Cart } from '../models';

const router = Router();
router.use(requireAuth);

router.get('/', async (req, res, next) => {
  try {
    const cart = await Cart.findOne({ userId: (req as any).user.id }).lean();
    res.json({ items: cart?.items ?? [] });
  } catch (e) { next(e); }
});

const cartSchema = z.object({
  items: z.array(z.object({
    productId: z.string(),
    title: z.string(),
    image: z.string(),
    price: z.number(),
    size: z.string(),
    qty: z.number().int().min(1).max(20),
    slug: z.string(),
  })).max(50),
});

router.put('/', validate(cartSchema), async (req, res, next) => {
  try {
    await Cart.updateOne(
      { userId: (req as any).user.id },
      { $set: { items: req.body.items } },
      { upsert: true }
    );
    res.json({ ok: true });
  } catch (e) { next(e); }
});

export default router;
