import { Router, type NextFunction, type Request, type Response } from 'express';
import swaggerUi from 'swagger-ui-express';
import type { OpenApiDocument, OperationOverride } from '../../core/http/openapi';

/** Request/response shapes the route table cannot express (uploads, streams, files). */
export const OPENAPI_OVERRIDES: Record<string, OperationOverride> = {
  'POST /admin/imports': {
    summary: 'Upload a product CSV for background import',
    requestContentType: 'multipart/form-data',
    requestSchema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } }, required: ['file'] },
  },
  'GET /admin/imports/{id}/errors.csv': { summary: 'Download the per-row error report', responseContentType: 'text/csv' },
  'GET /realtime/stream': { summary: 'Server-Sent Events stream of order and stock updates', responseContentType: 'text/event-stream' },
  'POST /payments/webhook': { summary: 'Razorpay webhook (HMAC-SHA256 signed raw body)' },
  'POST /mcp': { summary: 'Model Context Protocol endpoint (JSON-RPC over streamable HTTP)' },
};

export class ApiDocs {
  private cached?: OpenApiDocument;

  constructor(private readonly build: () => OpenApiDocument) {}

  /** Built once on first use, after every module has registered its routes. */
  spec(): OpenApiDocument {
    this.cached ??= this.build();
    return this.cached;
  }
}

export function openApiRoutes(docs: ApiDocs): Router {
  const router = Router();
  router.get('/', (_req: Request, res: Response) => {
    res.set('Cache-Control', 'public, max-age=300');
    res.json(docs.spec());
  });
  return router;
}

const DOCS_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
].join('; ');

/** Swagger UI needs its own scripts and styles, so this page relaxes the API's deny-all CSP. */
export function docsUiRoutes(specUrl: string): Router {
  const router = Router();
  router.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Content-Security-Policy', DOCS_CSP);
    if (req.path === '/' && !req.originalUrl.split('?')[0].endsWith('/')) return res.redirect(301, `${req.originalUrl.split('?')[0]}/`);
    next();
  });
  router.use(swaggerUi.serveFiles(undefined, { swaggerOptions: { url: specUrl } }));
  router.get('/', swaggerUi.setup(undefined, { customSiteTitle: 'STOREFRONT API', swaggerOptions: { url: specUrl } }));
  return router;
}
