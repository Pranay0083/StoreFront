import { Router } from 'express';
import { handler } from '../../core/http/handler';
import { validate } from '../../core/http/validate';
import type { AuthGuards } from '../auth/auth.guards';
import type { AgentController } from './agent.controller';
import { ChatSchema, HistoryQuerySchema } from './agent.schemas';

export function agentRoutes(controller: AgentController, guards: AuthGuards): Router {
  const router = Router();
  router.post('/chat', guards.optionalAuth, validate({ body: ChatSchema }), handler(controller.chat));
  router.get('/history', validate({ query: HistoryQuerySchema }), handler(controller.history));
  return router;
}
