import { Router } from 'express';
import { handler } from '../../core/http/handler';
import { validate } from '../../core/http/validate';
import type { AuthGuards } from '../auth/auth.guards';
import type { OrdersController } from './orders.controller';
import { CreateOrderSchema, OrderIdParamsSchema } from './orders.schemas';

export function ordersRoutes(controller: OrdersController, guards: AuthGuards): Router {
  const router = Router();
  router.use(guards.requireAuth);
  router.post('/', validate({ body: CreateOrderSchema }), handler(controller.create));
  router.get('/', handler(controller.listMine));
  router.get('/:id', validate({ params: OrderIdParamsSchema }), handler(controller.getById));
  router.post('/:id/cancel', validate({ params: OrderIdParamsSchema }), handler(controller.cancel));
  return router;
}
