import { Router } from 'express';
import { handler } from '../../core/http/handler';
import { validate } from '../../core/http/validate';
import type { AuthGuards } from '../auth/auth.guards';
import type { CouponsController } from './coupons.controller';
import { CouponInputSchema, CouponUpdateSchema, ValidateCouponSchema } from './coupons.schemas';

export function couponsRoutes(controller: CouponsController, guards: AuthGuards): Router {
  const router = Router();
  router.post('/validate', guards.requireAuth, validate({ body: ValidateCouponSchema }), handler(controller.validate));
  return router;
}

export function adminCouponsRoutes(controller: CouponsController, guards: AuthGuards): Router {
  const router = Router();
  router.use(guards.requirePermission('promotions:write'));
  router.get('/', handler(controller.list));
  router.post('/', validate({ body: CouponInputSchema }), handler(controller.create));
  router.put('/:id', validate({ body: CouponUpdateSchema }), handler(controller.update));
  router.delete('/:id', handler(controller.remove));
  return router;
}
