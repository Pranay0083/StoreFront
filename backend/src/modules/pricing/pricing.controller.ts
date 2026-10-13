import type {
  PricingQuoteRequest,
  PromotionInput,
  PromotionSimulationInput,
  PromotionStatus,
  PromotionUpdate,
} from '@storefront/contracts';
import type { Response } from 'express';
import { BadRequestError } from '../../core/errors';
import type { AuthedReq, IdParams, Req } from '../../core/http/types';
import type { PricingService } from './pricing.service';
import type { PromotionsService } from './promotions.service';

export class PricingController {
  constructor(private readonly pricing: PricingService) {}

  quote = async (req: Req<PricingQuoteRequest>, res: Response) => {
    res.json(await this.pricing.quote(req.body, { userId: req.user?.id }));
  };

  bundles = async (req: Req<unknown, unknown, IdParams>, res: Response) => {
    res.json({ productId: req.params.id, offers: await this.pricing.bundlesForProduct(req.params.id) });
  };
}

/** Optional optimistic-concurrency guard: `If-Match: <version>`. */
function expectedVersion(header: string | undefined): number | undefined {
  if (header === undefined) return undefined;
  const version = Number(header.replace(/"/g, ''));
  if (!Number.isInteger(version) || version < 1) throw new BadRequestError('If-Match must be a promotion version number');
  return version;
}

export class PromotionsController {
  constructor(private readonly promotions: PromotionsService) {}

  list = async (req: AuthedReq<unknown, { status?: PromotionStatus }>, res: Response) => {
    res.json(await this.promotions.list(req.query.status));
  };

  get = async (req: AuthedReq<unknown, unknown, IdParams>, res: Response) => {
    const promotion = await this.promotions.get(req.params.id);
    res.set('ETag', `"${promotion.version}"`).json(promotion);
  };

  versions = async (req: AuthedReq<unknown, unknown, IdParams>, res: Response) => {
    res.json(await this.promotions.versions(req.params.id));
  };

  create = async (req: AuthedReq<PromotionInput>, res: Response) => {
    res.status(201).json(await this.promotions.create(req.body, req.user.id));
  };

  update = async (req: AuthedReq<PromotionUpdate, unknown, IdParams>, res: Response) => {
    const promotion = await this.promotions.update(req.params.id, req.body, req.user.id, expectedVersion(req.get('If-Match')));
    res.set('ETag', `"${promotion.version}"`).json(promotion);
  };

  archive = async (req: AuthedReq<unknown, unknown, IdParams>, res: Response) => {
    res.json(await this.promotions.archive(req.params.id, req.user.id));
  };

  simulate = async (req: AuthedReq<PromotionSimulationInput>, res: Response) => {
    res.json(await this.promotions.simulate(req.body));
  };
}
