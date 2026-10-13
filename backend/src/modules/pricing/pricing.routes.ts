import { Router } from 'express';
import { handler } from '../../core/http/handler';
import { validate } from '../../core/http/validate';
import type { AuthGuards } from '../auth/auth.guards';
import type { PricingController, PromotionsController } from './pricing.controller';
import {
  ObjectIdParamsSchema,
  PricingQuoteRequestSchema,
  PromotionInputSchema,
  PromotionListQuerySchema,
  PromotionSimulationSchema,
  PromotionUpdateSchema,
} from './pricing.schemas';

export function pricingRoutes(controller: PricingController, guards: AuthGuards): Router {
  const router = Router();
  router.post('/quote', guards.optionalAuth, validate({ body: PricingQuoteRequestSchema }), handler(controller.quote));
  router.get('/products/:id/bundles', validate({ params: ObjectIdParamsSchema }), handler(controller.bundles));
  return router;
}

export function adminPromotionsRoutes(controller: PromotionsController, guards: AuthGuards): Router {
  const router = Router();
  router.use(guards.requireAdmin);
  router.get('/', validate({ query: PromotionListQuerySchema }), handler(controller.list));
  router.post('/', validate({ body: PromotionInputSchema }), handler(controller.create));
  router.post('/simulate', validate({ body: PromotionSimulationSchema }), handler(controller.simulate));
  router.get('/:id', validate({ params: ObjectIdParamsSchema }), handler(controller.get));
  router.get('/:id/versions', validate({ params: ObjectIdParamsSchema }), handler(controller.versions));
  router.put('/:id', validate({ params: ObjectIdParamsSchema, body: PromotionUpdateSchema }), handler(controller.update));
  router.delete('/:id', validate({ params: ObjectIdParamsSchema }), handler(controller.archive));
  return router;
}
