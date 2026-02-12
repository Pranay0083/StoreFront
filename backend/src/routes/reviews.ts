import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { ApiError, requireAuth, validate } from '../middleware';
import { Product, Review } from '../models';

const router = Router();

router.get('/product/:productId', async (req, res, next) => {
  try {
    const reviews = await Review.find({ productId: req.params.productId }).sort({ createdAt: -1 }).limit(50).lean();
    res.json(reviews);
  } catch (e) { next(e); }
});

const reviewSchema = z.object({
  productId: z.string(),
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(1000).default(''),
});

router.post('/', requireAuth, validate(reviewSchema), async (req, res, next) => {
  try {
    const user = (req as any).user;
    const product = await Product.findById(req.body.productId);
    if (!product) throw new ApiError(404, 'Product not found');
    await Review.updateOne(
      { productId: product._id, userId: user.id },
      { $set: { rating: req.body.rating, comment: req.body.comment, userName: user.name } },
      { upsert: true }
    );
    const [agg] = await Review.aggregate([
      { $match: { productId: new mongoose.Types.ObjectId(String(product._id)) } },
      { $group: { _id: null, avg: { $avg: '$rating' }, count: { $sum: 1 } } },
    ]);
    product.rating = Math.round((agg?.avg ?? 0) * 10) / 10;
    product.numReviews = agg?.count ?? 0;
    await product.save();
    res.status(201).json({ ok: true, rating: product.rating, numReviews: product.numReviews });
  } catch (e) { next(e); }
});

export default router;
