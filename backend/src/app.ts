import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import pinoHttp from 'pino-http';

import type { Container } from './core/container';
import { errorHandler, notFoundHandler } from './core/http/error-handler';
import { logger } from './core/logger';

export const API_PREFIX = '/api/v1';

export function buildApp(container: Container) {
  const { env, limiters } = container;
  const app = express();

  app.use(helmet());
  app.use(limiters.global);
  app.use(pinoHttp({ logger }));

  app.use(cors({ origin: [env.FRONTEND_URL, 'http://localhost:3000'], credentials: true }));
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
  api.get('/', (_req, res) => res.json({ status: 'ok', service: 'storefront-api' }));
  for (const [path, router] of container.routes) api.use(path, router);

  app.use(API_PREFIX, api);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
