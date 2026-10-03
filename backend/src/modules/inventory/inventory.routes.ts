import { Router } from 'express';
import { z } from 'zod';
import { handler } from '../../core/http/handler';
import { validate } from '../../core/http/validate';
import type { AuthGuards } from '../auth/auth.guards';
import type { InventoryController } from './inventory.controller';

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Must be a valid id');

export const MovementsQuerySchema = z.object({
  productId: objectId.optional(),
  orderId: objectId.optional(),
  limit: z.coerce
    .number()
    .int()
    .positive()
    .catch(100)
    .transform(n => Math.min(500, n)),
});

export function inventoryRoutes(controller: InventoryController, guards: AuthGuards): Router {
  const router = Router();
  router.use(guards.requireAdmin);
  router.get('/reconcile', handler(controller.reconcile));
  router.get('/movements', validate({ query: MovementsQuerySchema }), handler(controller.movements));
  return router;
}
