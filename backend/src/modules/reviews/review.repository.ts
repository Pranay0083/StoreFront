import { ReviewModel, type ReviewRecord } from './review.model';

export interface ReviewWrite {
  rating: number;
  comment: string;
  userName: string;
  verifiedPurchase: boolean;
}

export class ReviewRepository {
  listForProduct(productId: string, limit = 50): Promise<ReviewRecord[]> {
    return ReviewModel.find({ productId }).sort({ createdAt: -1 }).limit(limit).lean<ReviewRecord[]>();
  }

  /** Inserts or replaces the user's review and returns the review it replaced, if any. */
  upsert(productId: string, userId: string, review: ReviewWrite): Promise<ReviewRecord | null> {
    return ReviewModel.findOneAndUpdate({ productId, userId }, { $set: review }, { upsert: true, new: false }).lean<ReviewRecord>();
  }
}
