import type { ReviewInput } from '@storefront/contracts';
import type { Response } from 'express';
import type { AuthedReq, Req } from '../../core/http/types';
import type { ReviewsService } from './reviews.service';

export class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  listForProduct = async (req: Req<unknown, unknown, { productId: string }>, res: Response) => {
    res.json(await this.reviews.listForProduct(req.params.productId));
  };

  submit = async (req: AuthedReq<ReviewInput>, res: Response) => {
    const result = await this.reviews.submit(req.body, req.user);
    res.status(201).json({ ok: true, ...result });
  };
}
