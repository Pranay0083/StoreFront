import { Router } from 'express';
import { handler } from '../../core/http/handler';
import type { RateLimiters } from '../../core/http/rate-limit';
import { validate } from '../../core/http/validate';
import type { AuthController } from './auth.controller';
import type { AuthGuards } from './auth.guards';
import { LoginSchema, RegisterSchema, SessionIdParamsSchema } from './auth.schemas';

export function authRoutes(controller: AuthController, guards: AuthGuards, limiters: RateLimiters): Router {
  const router = Router();
  router.post('/register', limiters.auth, validate({ body: RegisterSchema }), handler(controller.register));
  router.post('/login', limiters.auth, validate({ body: LoginSchema }), handler(controller.login));
  router.post('/logout', handler(controller.logout));
  router.post('/logout-all', guards.requireAuth, handler(controller.logoutAll));
  router.get('/me', guards.requireAuth, handler(controller.me));
  router.post('/refresh', handler(controller.refresh));
  router.get('/sessions', guards.requireAuth, handler(controller.sessions));
  router.delete('/sessions/:id', guards.requireAuth, validate({ params: SessionIdParamsSchema }), handler(controller.revokeSession));
  return router;
}
