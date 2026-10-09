import type { Migration } from '../migration';

export const reviewAggregates: Migration = {
  id: '033-review-aggregates',
  description: 'Mark existing reviews unverified and backfill ratingSum for incremental ratings',
  async up(db) {
    await db.collection('reviews').updateMany({ verifiedPurchase: { $exists: false } }, { $set: { verifiedPurchase: false } });

    const totals = await db
      .collection('reviews')
      .aggregate<{ _id: unknown; sum: number; count: number }>([
        { $group: { _id: '$productId', sum: { $sum: '$rating' }, count: { $sum: 1 } } },
      ])
      .toArray();
    const products = db.collection('products');
    for (const t of totals) {
      await products.updateOne(
        { _id: t._id as never },
        { $set: { ratingSum: t.sum, numReviews: t.count, rating: Math.round((t.sum / t.count) * 10) / 10 } },
      );
    }
    await products.updateMany({ ratingSum: { $exists: false } }, [
      { $set: { ratingSum: { $multiply: [{ $ifNull: ['$rating', 0] }, { $ifNull: ['$numReviews', 0] }] } } },
    ]);
  },
};
