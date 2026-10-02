import type { ReviewInput } from '@storefront/contracts';
import { NotFoundError } from '../../core/errors';
import type { AuthUser } from '../../core/http/types';
import { logger } from '../../core/logger';
import type { ProductRepository } from '../catalog/product.repository';
import type { ReviewRecord } from './review.model';
import type { ReviewRepository } from './review.repository';

export class ReviewsService {
  constructor(
    private readonly reviews: ReviewRepository,
    private readonly products: ProductRepository,
  ) {}

  listForProduct(productId: string): Promise<ReviewRecord[]> {
    return this.reviews.listForProduct(productId);
  }

  async submit(input: ReviewInput, user: AuthUser): Promise<{ rating: number; numReviews: number }> {
    const product = await this.products.findById(input.productId);
    if (!product) throw new NotFoundError('Product not found');
    const productId = String(product._id);
    await this.reviews.upsert(productId, user.id, { rating: input.rating, comment: input.comment, userName: user.name });
    const summary = await this.reviews.summary(productId);
    const rating = Math.round(summary.average * 10) / 10;
    await this.products.setRating(productId, rating, summary.count);
    logger.info({ userId: user.id, productId, rating: input.rating }, 'Review submitted');
    return { rating, numReviews: summary.count };
  }
}
