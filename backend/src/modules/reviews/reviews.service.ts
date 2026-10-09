import type { ReviewInput } from '@storefront/contracts';
import { ForbiddenError, NotFoundError } from '../../core/errors';
import type { AuthUser } from '../../core/http/types';
import { logger } from '../../core/logger';
import type { ProductRepository } from '../catalog/product.repository';
import type { PurchaseVerifier } from './purchase-verifier';
import type { ReviewRecord } from './review.model';
import type { ReviewRepository } from './review.repository';

export interface ReviewResult {
  rating: number;
  numReviews: number;
  verifiedPurchase: true;
}

export class ReviewsService {
  constructor(
    private readonly reviews: ReviewRepository,
    private readonly products: ProductRepository,
    private readonly purchases: PurchaseVerifier,
  ) {}

  listForProduct(productId: string): Promise<ReviewRecord[]> {
    return this.reviews.listForProduct(productId);
  }

  async submit(input: ReviewInput, user: AuthUser): Promise<ReviewResult> {
    const product = await this.products.findById(input.productId);
    if (!product) throw new NotFoundError('Product not found');
    const productId = String(product._id);
    if (!(await this.purchases.hasReceived(user.id, productId))) {
      throw new ForbiddenError('Only customers who have received this product can review it');
    }

    const previous = await this.reviews.upsert(productId, user.id, {
      rating: input.rating,
      comment: input.comment,
      userName: user.name,
      verifiedPurchase: true,
    });
    const summary = await this.products.applyRatingDelta(productId, input.rating - (previous?.rating ?? 0), previous ? 0 : 1);
    logger.info({ userId: user.id, productId, rating: input.rating, updated: !!previous }, 'Review submitted');
    return { ...summary, verifiedPurchase: true };
  }
}
