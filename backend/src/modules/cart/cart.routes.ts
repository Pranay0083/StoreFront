import { Router } from 'express';
import { handler } from '../../core/http/handler';
import { validate } from '../../core/http/validate';
import type { AuthGuards } from '../auth/auth.guards';
import type { CartController } from './cart.controller';
import { UpdateCartSchema } from './cart.schemas';

export function cartRoutes(controller: CartController, guards: AuthGuards): Router {
  const router = Router();
  router.use(guards.requireAuth);
  router.get('/', handler(controller.get));
  router.put('/', validate({ body: UpdateCartSchema }), handler(controller.replace));
  return router;
}
