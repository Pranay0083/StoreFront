import { Router } from 'express';
import { handler } from '../../core/http/handler';
import { validate } from '../../core/http/validate';
import type { AuthController } from './auth.controller';
import type { AuthGuards } from './auth.guards';
import { LoginSchema, RegisterSchema, SessionIdParamsSchema } from './auth.schemas';

export function authRoutes(controller: AuthController, guards: AuthGuards): Router {
  const router = Router();
  router.get('/csrf', handler(controller.csrfToken));
  router.post('/register', validate({ body: RegisterSchema }), handler(controller.register));
  router.post('/login', validate({ body: LoginSchema }), handler(controller.login));
  router.post('/logout', handler(controller.logout));
  router.post('/logout-all', guards.requireAuth, handler(controller.logoutAll));
  router.get('/me', guards.requireAuth, handler(controller.me));
  router.get('/session', guards.optionalAuth, handler(controller.session));
  router.post('/refresh', handler(controller.refresh));
  router.get('/sessions', guards.requireAuth, handler(controller.sessions));
  router.delete('/sessions/:id', guards.requireAuth, validate({ params: SessionIdParamsSchema }), handler(controller.revokeSession));
  return router;
}
