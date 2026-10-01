import { Router } from 'express';
import { handler } from '../../core/http/handler';
import { validate } from '../../core/http/validate';
import type { AuthGuards } from '../auth/auth.guards';
import type { ReviewsController } from './reviews.controller';
import { ProductIdParamsSchema, ReviewInputSchema } from './reviews.schemas';

export function reviewsRoutes(controller: ReviewsController, guards: AuthGuards): Router {
  const router = Router();
  router.get('/product/:productId', validate({ params: ProductIdParamsSchema }), handler(controller.listForProduct));
  router.post('/', guards.requireAuth, validate({ body: ReviewInputSchema }), handler(controller.submit));
  return router;
}
