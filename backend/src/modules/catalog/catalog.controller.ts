import type { ProductInput, ProductListQuery } from '@storefront/contracts';
import type { Request, Response } from 'express';
import type { AuthedReq, IdParams, Req } from '../../core/http/types';
import type { SearchService } from '../search/search.service';
import type { Catalog } from './caching-catalog';

export class CatalogController {
  constructor(
    private readonly catalog: Catalog,
    private readonly searchService: SearchService,
  ) {}

  suggest = async (req: Req<unknown, { q: string; limit: number }>, res: Response) => {
    res.json({ suggestions: await this.searchService.suggest(req.query.q, req.query.limit) });
  };

  list = async (req: Req<unknown, ProductListQuery>, res: Response) => {
    res.json(await this.catalog.list(req.query));
  };

  categories = async (_req: Request, res: Response) => {
    res.json(await this.catalog.categories());
  };

  getBySlug = async (req: Req<unknown, unknown, { slug: string }>, res: Response) => {
    res.json(await this.catalog.getBySlug(req.params.slug));
  };

  create = async (req: AuthedReq<ProductInput>, res: Response) => {
    res.status(201).json(await this.catalog.create(req.body, req.user.id));
  };

  update = async (req: AuthedReq<Partial<ProductInput>, unknown, IdParams>, res: Response) => {
    res.json(await this.catalog.update(req.params.id, req.body, req.user.id));
  };

  remove = async (req: AuthedReq<unknown, unknown, IdParams>, res: Response) => {
    await this.catalog.delete(req.params.id, req.user.id);
    res.json({ ok: true });
  };
}
