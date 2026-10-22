import { Router, type Response } from 'express';
import { z } from 'zod';
import { handler } from '../../core/http/handler';
import type { AuthedReq, Req } from '../../core/http/types';
import { validate } from '../../core/http/validate';
import type { JobQueue } from '../../core/queue/job-queue';
import type { AuthGuards } from '../auth/auth.guards';
import { REBUILD_RECOMMENDATIONS_JOB, type RecommendationsService } from './recommendations.service';

export const ProductIdParamsSchema = z.object({ id: z.string().regex(/^[a-f\d]{24}$/i, 'Must be a valid id') });
export const RecommendationsQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(12).catch(4).default(4) });

export class RecommendationsController {
  constructor(
    private readonly recommendations: RecommendationsService,
    private readonly jobs: JobQueue,
  ) {}

  forProduct = async (req: Req<unknown, { limit: number }, { id: string }>, res: Response) => {
    res.set('Cache-Control', 'public, max-age=300');
    res.json(await this.recommendations.forProduct(req.params.id, req.query.limit));
  };

  rebuild = async (req: AuthedReq, res: Response) => {
    await this.jobs.enqueue(REBUILD_RECOMMENDATIONS_JOB, {}, { jobId: `recommendations-manual-${Math.floor(Date.now() / 60_000)}` });
    res.locals.audit = { targets: ['recommendations'], changes: { action: 'rebuild', by: req.user.id } };
    res.status(202).json({ queued: true });
  };
}

export function recommendationsRoutes(controller: RecommendationsController): Router {
  const router = Router();
  router.get(
    '/:id/recommendations',
    validate({ params: ProductIdParamsSchema, query: RecommendationsQuerySchema }),
    handler(controller.forProduct),
  );
  return router;
}

export function adminRecommendationsRoutes(controller: RecommendationsController, guards: AuthGuards): Router {
  const router = Router();
  router.post('/rebuild', guards.requirePermission('catalog:write'), handler(controller.rebuild));
  return router;
}
