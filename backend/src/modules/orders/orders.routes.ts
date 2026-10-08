import { Router, type RequestHandler } from 'express';
import { handler } from '../../core/http/handler';
import { validate } from '../../core/http/validate';
import type { AuthGuards } from '../auth/auth.guards';
import type { OrdersController } from './orders.controller';
import { CreateOrderSchema, OrderIdParamsSchema, RefundRequestSchema } from './orders.schemas';

export function ordersRoutes(controller: OrdersController, guards: AuthGuards, idempotent: RequestHandler): Router {
  const router = Router();
  router.use(guards.requireAuth);
  router.post('/', validate({ body: CreateOrderSchema }), idempotent, handler(controller.create));
  router.get('/', handler(controller.listMine));
  router.get('/:id', validate({ params: OrderIdParamsSchema }), handler(controller.getById));
  router.post('/:id/cancel', validate({ params: OrderIdParamsSchema }), handler(controller.cancel));
  router.post('/:id/refund', validate({ params: OrderIdParamsSchema, body: RefundRequestSchema }), handler(controller.requestRefund));
  return router;
}
