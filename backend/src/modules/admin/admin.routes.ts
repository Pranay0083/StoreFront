import { Router } from 'express';
import { handler } from '../../core/http/handler';
import { validate } from '../../core/http/validate';
import type { AuthGuards } from '../auth/auth.guards';
import type { AdminController } from './admin.controller';
import { AdminOrdersQuerySchema, BulkTransitionSchema, LowStockQuerySchema, RevenueQuerySchema } from './admin.schemas';

export function adminRoutes(controller: AdminController, guards: AuthGuards): Router {
  const router = Router();
  router.use(guards.requireAdmin);
  router.get('/stats', handler(controller.stats));
  router.get('/revenue-by-day', validate({ query: RevenueQuerySchema }), handler(controller.revenueByDay));
  router.get('/funnel', handler(controller.funnel));
  router.get('/top-products', handler(controller.topProducts));
  router.get('/low-stock', validate({ query: LowStockQuerySchema }), handler(controller.lowStock));
  router.get('/orders', validate({ query: AdminOrdersQuerySchema }), handler(controller.orders));
  router.post('/orders/bulk-transition', validate({ body: BulkTransitionSchema }), handler(controller.bulkTransition));
  router.get('/conversations', handler(controller.conversations));
  return router;
}
