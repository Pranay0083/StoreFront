import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import pinoHttp from 'pino-http';

import type { Container } from './core/container';
import { errorHandler, notFoundHandler } from './core/http/error-handler';
import { logger } from './core/logger';
import { handleMcpPost, handleMcpUnsupported } from './services/mcp';

import adminRoutes from './routes/admin';
import agentRoutes from './routes/agent';
import cartRoutes from './routes/cart';
import couponRoutes from './routes/coupons';
import orderRoutes from './routes/orders';
import paymentRoutes from './routes/payments';
import productRoutes from './routes/products';
import reviewRoutes from './routes/reviews';

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
  api.use('/products', productRoutes);
  api.use('/cart', cartRoutes);
  api.use('/coupons', couponRoutes);
  api.use('/orders', orderRoutes);
  api.use('/payments', paymentRoutes);
  api.use('/reviews', reviewRoutes);
  api.use('/admin', adminRoutes);
  api.use('/agent', agentRoutes);

  const mcpCors = cors({
    origin: '*',
    exposedHeaders: ['Mcp-Session-Id'],
    allowedHeaders: ['Content-Type', 'Accept', 'Mcp-Session-Id', 'Mcp-Protocol-Version'],
  });
  api.options('/mcp', mcpCors);
  api.post('/mcp', mcpCors, handleMcpPost);
  api.get('/mcp', mcpCors, handleMcpUnsupported);
  api.delete('/mcp', mcpCors, handleMcpUnsupported);

  app.use('/api', api);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
