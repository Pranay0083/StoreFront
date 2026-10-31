import { Router, type Request, type Response } from 'express';
import { handler } from '../../core/http/handler';
import type { OffersService } from './offers.service';

export class OffersController {
  constructor(private readonly offers: OffersService) {}

  live = async (_req: Request, res: Response) => {
    res.json(await this.offers.live());
  };
}

/** Public, read-only: what the storefront advertises right now. */
export function offersRoutes(controller: OffersController): Router {
  const router = Router();
  router.get('/', handler(controller.live));
  return router;
}
