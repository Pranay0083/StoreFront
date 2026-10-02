import { Router } from 'express';
import { handler } from '../../core/http/handler';
import { validate } from '../../core/http/validate';
import type { AuthGuards } from '../auth/auth.guards';
import type { PaymentsController } from './payments.controller';
import { OrderIdBodySchema, VerifyPaymentSchema } from './payments.schemas';

export function paymentsRoutes(controller: PaymentsController, guards: AuthGuards): Router {
  const router = Router();
  router.get('/config', handler(controller.config));
  router.post('/create', guards.requireAuth, validate({ body: OrderIdBodySchema }), handler(controller.create));
  router.post('/verify', guards.requireAuth, validate({ body: VerifyPaymentSchema }), handler(controller.verify));
  router.post('/demo-confirm', guards.requireAuth, validate({ body: OrderIdBodySchema }), handler(controller.demoConfirm));
  router.post('/webhook', handler(controller.webhook));
  return router;
}
