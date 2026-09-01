import mongoose from 'mongoose';
import { ApiError } from '../middleware';
import { Product, Review } from '../models';
import { logger } from '../utils/logger';

/**
 * Retrieves up to 50 recent reviews for a specific product.
 */
export const getReviews = async (req: any, res: any, next: any) => {
  try {
    const reviews = await Review.find({ productId: req.params.productId }).sort({ createdAt: -1 }).limit(50).lean();
    res.json(reviews);
  } catch (e) { next(e); }
};

/**
 * Creates or updates a review for a product by the authenticated user.
 * Recomputes and updates the average rating on the product document.
 */
export const createReview = async (req: any, res: any, next: any) => {
  try {
    const user = req.user;
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
    logger.info({ userId: user.id, productId: product._id, rating: req.body.rating }, 'Review created or updated');
    res.status(201).json({ ok: true, rating: product.rating, numReviews: product.numReviews });
  } catch (e) { next(e); }
};
