import { Router, type Request, type Response } from 'express';
import { handler } from '../../core/http/handler';
import type { AuthedReq, IdParams } from '../../core/http/types';
import type { AuthGuards } from '../auth/auth.guards';
import type { ImportsService } from './imports.service';

export class ImportsController {
  constructor(private readonly imports: ImportsService) {}

  upload = async (req: AuthedReq, res: Response) => {
    const result = await this.imports.upload(req as unknown as Request, `admin:${req.user.id}`);
    res.locals.audit = {
      targets: [result.import.id],
      changes: { action: 'import', filename: result.import.filename, duplicate: result.duplicate },
    };
    res.status(result.duplicate ? 200 : 202).json(result);
  };

  list = async (_req: AuthedReq, res: Response) => {
    res.json(await this.imports.list());
  };

  get = async (req: AuthedReq<unknown, unknown, IdParams>, res: Response) => {
    res.json(await this.imports.get(req.params.id));
  };

  errors = async (req: AuthedReq<unknown, unknown, IdParams>, res: Response) => {
    const report = await this.imports.errorReport(req.params.id);
    res.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${report.filename.replace(/"/g, '')}"`,
    });
    res.send(report.csv);
  };
}

export function importsRoutes(controller: ImportsController, guards: AuthGuards): Router {
  const router = Router();
  router.use(guards.requirePermission('catalog:write'));
  router.get('/', handler(controller.list));
  router.post('/', handler(controller.upload));
  router.get('/:id', handler(controller.get));
  router.get('/:id/errors.csv', handler(controller.errors));
  return router;
}
