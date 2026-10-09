import cookieParser from 'cookie-parser';
import express from 'express';
import pinoHttp from 'pino-http';

import type { Container } from './core/container';
import { errorHandler, notFoundHandler } from './core/http/error-handler';
import { API_PREFIX } from './core/http/paths';
import { corsPolicy, securityHeaders } from './core/http/security';
import { logger } from './core/logger';

export { API_PREFIX };

export function buildApp(container: Container) {
  const { env, limiters } = container;
  const app = express();
  app.set('trust proxy', env.TRUST_PROXY);
  app.disable('x-powered-by');

  app.use(securityHeaders(env));
  app.use(pinoHttp({ logger }));

  app.use(corsPolicy(env));
  app.use(
    express.json({
      limit: '2mb',
      verify: (req, _res, buf) => {
        (req as express.Request).rawBody = buf;
      },
    }),
  );
  app.use(cookieParser());

  const api = express.Router();
  api.use(limiters.middleware);
  api.get('/', (_req, res) => res.json({ status: 'ok', service: 'storefront-api' }));
  api.use(container.csrf.middleware);
  api.use(container.http.auditTrail);
  for (const [path, router] of container.routes) api.use(path, router);

  app.use(API_PREFIX, api);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
