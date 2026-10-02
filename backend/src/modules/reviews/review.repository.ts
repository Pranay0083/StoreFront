import { Types } from 'mongoose';
import { ReviewModel, type ReviewRecord } from './review.model';

export interface RatingSummary {
  average: number;
  count: number;
}

export class ReviewRepository {
  listForProduct(productId: string, limit = 50): Promise<ReviewRecord[]> {
    return ReviewModel.find({ productId }).sort({ createdAt: -1 }).limit(limit).lean<ReviewRecord[]>();
  }

  async upsert(productId: string, userId: string, review: { rating: number; comment: string; userName: string }): Promise<void> {
    await ReviewModel.updateOne({ productId, userId }, { $set: review }, { upsert: true });
  }

  async summary(productId: string): Promise<RatingSummary> {
    const [row] = await ReviewModel.aggregate<{ avg: number; count: number }>([
      { $match: { productId: new Types.ObjectId(productId) } },
      { $group: { _id: null, avg: { $avg: '$rating' }, count: { $sum: 1 } } },
    ]);
    return { average: row?.avg ?? 0, count: row?.count ?? 0 };
  }
}
