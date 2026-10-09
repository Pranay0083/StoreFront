import { Router } from 'express';
import { handler } from '../../core/http/handler';
import { validate } from '../../core/http/validate';
import type { AuthGuards } from '../auth/auth.guards';
import type { CatalogController } from './catalog.controller';
import { ProductInputSchema, ProductListQuerySchema, ProductUpdateSchema, SlugParamsSchema } from './catalog.schemas';

export function catalogRoutes(controller: CatalogController, guards: AuthGuards): Router {
  const router = Router();
  router.get('/', validate({ query: ProductListQuerySchema }), handler(controller.list));
  router.get('/categories', handler(controller.categories));
  router.get('/:slug', validate({ params: SlugParamsSchema }), handler(controller.getBySlug));
  const catalogWrite = guards.requirePermission('catalog:write');
  router.post('/', catalogWrite, validate({ body: ProductInputSchema }), handler(controller.create));
  router.put('/:id', catalogWrite, validate({ body: ProductUpdateSchema }), handler(controller.update));
  router.delete('/:id', catalogWrite, handler(controller.remove));
  return router;
}
