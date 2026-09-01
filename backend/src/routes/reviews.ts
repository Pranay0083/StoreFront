import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, validate } from '../middleware';
import * as reviewsController from '../controllers/reviews.controller';

const router = Router();

router.get('/product/:productId', reviewsController.getReviews);

const reviewSchema = z.object({
  productId: z.string({ required_error: 'Product ID is required' }),
  rating: z.number({ required_error: 'Rating is required' }).int('Rating must be a whole number').min(1, 'Minimum rating is 1').max(5, 'Maximum rating is 5'),
  comment: z.string().max(1000, 'Comment cannot exceed 1000 characters').default(''),
}).strict();

router.post('/', requireAuth, validate(reviewSchema), reviewsController.createReview);

export default router;
