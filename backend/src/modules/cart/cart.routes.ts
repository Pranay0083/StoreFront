import { Router } from 'express';
import { handler } from '../../core/http/handler';
import { validate } from '../../core/http/validate';
import type { AuthGuards } from '../auth/auth.guards';
import type { CartController } from './cart.controller';
import { UpdateCartSchema } from './cart.schemas';

export function cartRoutes(controller: CartController, guards: AuthGuards): Router {
  const router = Router();
  router.post('/hydrate', validate({ body: UpdateCartSchema }), handler(controller.hydrate));
  router.get('/', guards.requireAuth, handler(controller.get));
  router.put('/', guards.requireAuth, validate({ body: UpdateCartSchema }), handler(controller.replace));
  return router;
}
