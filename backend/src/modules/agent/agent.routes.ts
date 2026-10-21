import { Router } from 'express';
import { handler } from '../../core/http/handler';
import { validate } from '../../core/http/validate';
import type { AuthGuards } from '../auth/auth.guards';
import type { AgentController } from './agent.controller';
import { ActionParamsSchema, ChatSchema, HistoryQuerySchema, UsageQuerySchema } from './agent.schemas';

export function agentRoutes(controller: AgentController, guards: AuthGuards): Router {
  const router = Router();
  router.post('/chat', guards.optionalAuth, validate({ body: ChatSchema }), handler(controller.chat));
  router.post('/chat/stream', guards.optionalAuth, validate({ body: ChatSchema }), handler(controller.stream));
  router.get('/history', validate({ query: HistoryQuerySchema }), handler(controller.history));
  router.post('/actions/:id/confirm', guards.requireAuth, validate({ params: ActionParamsSchema }), handler(controller.confirm));
  router.post('/actions/:id/decline', guards.requireAuth, validate({ params: ActionParamsSchema }), handler(controller.decline));
  return router;
}

export function adminAgentRoutes(controller: AgentController, guards: AuthGuards): Router {
  const router = Router();
  router.get('/usage', guards.requirePermission('chats:read'), validate({ query: UsageQuerySchema }), handler(controller.usageSummary));
  return router;
}
