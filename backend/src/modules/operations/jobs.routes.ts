import { Router, type Response } from 'express';
import { z } from 'zod';
import { handler } from '../../core/http/handler';
import type { AuthedReq, Req } from '../../core/http/types';
import { validate } from '../../core/http/validate';
import type { AuthGuards } from '../auth/auth.guards';
import type { DeadLetterSource, JobsAdminService } from './jobs.service';

const DeadLetterQuerySchema = z.object({
  source: z.enum(['job', 'event']).optional(),
  limit: z.coerce.number().int().positive().max(500).catch(100).default(100),
});

const DeadLetterParamsSchema = z.object({
  source: z.enum(['job', 'event']),
  id: z.string().min(1).max(64),
});

type DeadLetterParams = z.infer<typeof DeadLetterParamsSchema>;

export class JobsController {
  constructor(private readonly jobs: JobsAdminService) {}

  overview = async (_req: Req, res: Response) => {
    res.json(await this.jobs.overview());
  };

  deadLetters = async (req: Req<unknown, z.infer<typeof DeadLetterQuerySchema>>, res: Response) => {
    res.json({ items: await this.jobs.list(req.query) });
  };

  retry = async (req: AuthedReq<unknown, unknown, DeadLetterParams>, res: Response) => {
    await this.jobs.retry(req.params.source as DeadLetterSource, req.params.id, req.user.id);
    res.locals.audit = { targets: [req.params.id], changes: { action: 'retry', source: req.params.source } };
    res.json({ ok: true });
  };

  discard = async (req: AuthedReq<unknown, unknown, DeadLetterParams>, res: Response) => {
    await this.jobs.discard(req.params.source as DeadLetterSource, req.params.id, req.user.id);
    res.locals.audit = { targets: [req.params.id], changes: { action: 'discard', source: req.params.source } };
    res.json({ ok: true });
  };
}

export function jobsAdminRoutes(controller: JobsController, guards: AuthGuards): Router {
  const router = Router();
  router.use(guards.requirePermission('jobs:manage'));
  router.get('/', handler(controller.overview));
  router.get('/dead-letters', validate({ query: DeadLetterQuerySchema }), handler(controller.deadLetters));
  router.post('/dead-letters/:source/:id/retry', validate({ params: DeadLetterParamsSchema }), handler(controller.retry));
  router.delete('/dead-letters/:source/:id', validate({ params: DeadLetterParamsSchema }), handler(controller.discard));
  return router;
}
