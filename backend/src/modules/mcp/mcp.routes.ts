import cors from 'cors';
import { Router } from 'express';
import { handler } from '../../core/http/handler';
import type { McpController } from './mcp.controller';

export function mcpRoutes(controller: McpController): Router {
  const router = Router();
  const mcpCors = cors({
    origin: '*',
    exposedHeaders: ['Mcp-Session-Id'],
    allowedHeaders: ['Content-Type', 'Accept', 'Mcp-Session-Id', 'Mcp-Protocol-Version'],
  });
  router.options('/', mcpCors);
  router.post('/', mcpCors, handler(controller.post));
  router.get('/', mcpCors, handler(controller.unsupported));
  router.delete('/', mcpCors, handler(controller.unsupported));
  return router;
}
