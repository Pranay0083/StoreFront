import {
  EvaluateQuerySchema,
  ExperimentInputSchema,
  ExperimentUpdateSchema,
  ExposureInputSchema,
  FlagInputSchema,
  FlagUpdateSchema,
  type EvaluateQuery,
  type ExperimentInput,
  type ExperimentUpdate,
  type ExposureInput,
  type FlagInput,
  type FlagUpdate,
} from '@storefront/contracts';
import { Router, type Response } from 'express';
import { z } from 'zod';
import type { EventBus } from '../../core/events/event-bus';
import { handler } from '../../core/http/handler';
import type { AuthedReq, Req } from '../../core/http/types';
import { validate } from '../../core/http/validate';
import type { AuthGuards } from '../auth/auth.guards';
import type { ExperimentsService } from './experiments.service';

export const KeyParamsSchema = z.object({ key: z.string().regex(/^[a-z0-9][a-z0-9-]{1,48}$/, 'Invalid key') });
type KeyParams = z.infer<typeof KeyParamsSchema>;

export class ExperimentsController {
  constructor(private readonly experiments: ExperimentsService) {}

  evaluate = async (req: Req<unknown, EvaluateQuery>, res: Response) => {
    res.set('Cache-Control', 'private, no-store');
    res.json(await this.experiments.evaluate(req.user, req.query.anonymousId));
  };

  exposure = async (req: Req<ExposureInput>, res: Response) => {
    res.json({ recorded: await this.experiments.recordExposure(req.body.experiment, req.user, req.body.anonymousId) });
  };

  listFlags = async (_req: AuthedReq, res: Response) => {
    res.json(await this.experiments.listFlags());
  };

  createFlag = async (req: AuthedReq<FlagInput>, res: Response) => {
    const flag = await this.experiments.createFlag(req.body, `admin:${req.user.id}`);
    res.locals.audit = { targets: [flag.key], changes: req.body };
    res.status(201).json(flag);
  };

  updateFlag = async (req: AuthedReq<FlagUpdate, unknown, KeyParams>, res: Response) => {
    const flag = await this.experiments.updateFlag(req.params.key, req.body, `admin:${req.user.id}`);
    res.locals.audit = { targets: [flag.key], changes: req.body };
    res.json(flag);
  };

  deleteFlag = async (req: AuthedReq<unknown, unknown, KeyParams>, res: Response) => {
    await this.experiments.deleteFlag(req.params.key);
    res.locals.audit = { targets: [req.params.key], changes: { action: 'delete' } };
    res.json({ ok: true });
  };

  listExperiments = async (_req: AuthedReq, res: Response) => {
    res.json(await this.experiments.listExperiments());
  };

  getExperiment = async (req: AuthedReq<unknown, unknown, KeyParams>, res: Response) => {
    res.json(await this.experiments.getExperiment(req.params.key));
  };

  createExperiment = async (req: AuthedReq<ExperimentInput>, res: Response) => {
    const experiment = await this.experiments.createExperiment(req.body, `admin:${req.user.id}`);
    res.locals.audit = { targets: [experiment.key], changes: req.body };
    res.status(201).json(experiment);
  };

  updateExperiment = async (req: AuthedReq<ExperimentUpdate, unknown, KeyParams>, res: Response) => {
    const experiment = await this.experiments.updateExperiment(req.params.key, req.body, `admin:${req.user.id}`);
    res.locals.audit = { targets: [experiment.key], changes: req.body };
    res.json(experiment);
  };

  deleteExperiment = async (req: AuthedReq<unknown, unknown, KeyParams>, res: Response) => {
    await this.experiments.deleteExperiment(req.params.key);
    res.locals.audit = { targets: [req.params.key], changes: { action: 'delete' } };
    res.json({ ok: true });
  };

  results = async (req: AuthedReq<unknown, unknown, KeyParams>, res: Response) => {
    res.json(await this.experiments.results(req.params.key));
  };
}

export function experimentsRoutes(controller: ExperimentsController, guards: AuthGuards): Router {
  const router = Router();
  router.get('/evaluate', guards.optionalAuth, validate({ query: EvaluateQuerySchema }), handler(controller.evaluate));
  router.post('/exposures', guards.optionalAuth, validate({ body: ExposureInputSchema }), handler(controller.exposure));
  return router;
}

export function adminFlagsRoutes(controller: ExperimentsController, guards: AuthGuards): Router {
  const router = Router();
  router.use(guards.requirePermission('experiments:manage'));
  router.get('/', handler(controller.listFlags));
  router.post('/', validate({ body: FlagInputSchema }), handler(controller.createFlag));
  router.put('/:key', validate({ params: KeyParamsSchema, body: FlagUpdateSchema }), handler(controller.updateFlag));
  router.delete('/:key', validate({ params: KeyParamsSchema }), handler(controller.deleteFlag));
  return router;
}

export function adminExperimentsRoutes(controller: ExperimentsController, guards: AuthGuards): Router {
  const router = Router();
  router.use(guards.requirePermission('experiments:manage'));
  router.get('/', handler(controller.listExperiments));
  router.post('/', validate({ body: ExperimentInputSchema }), handler(controller.createExperiment));
  router.get('/:key', validate({ params: KeyParamsSchema }), handler(controller.getExperiment));
  router.get('/:key/results', validate({ params: KeyParamsSchema }), handler(controller.results));
  router.put('/:key', validate({ params: KeyParamsSchema, body: ExperimentUpdateSchema }), handler(controller.updateExperiment));
  router.delete('/:key', validate({ params: KeyParamsSchema }), handler(controller.deleteExperiment));
  return router;
}

export function registerExperimentHandlers(eventBus: EventBus, experiments: ExperimentsService): void {
  eventBus.subscribe('OrderPaid', 'experiments.attribute-conversion', async event => {
    await experiments.recordConversion(
      { orderId: event.payload.orderId, userId: event.payload.userId, total: event.payload.total },
      new Date(event.occurredAt),
    );
  });
}
