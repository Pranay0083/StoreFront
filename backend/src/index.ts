import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import pinoHttp from 'pino-http';

import { connectDB } from './config/db';
import { env } from './config/env';
import { globalLimiter } from './middleware/failsafes';
import { logger } from './utils/logger';
import { handleMcpPost, handleMcpUnsupported } from './services/mcp';
import { errorHandler } from './middleware';
import { seedIfNeeded } from './seed';

import adminRoutes from './routes/admin';
import agentRoutes from './routes/agent';
import authRoutes from './routes/auth';
import cartRoutes from './routes/cart';
import couponRoutes from './routes/coupons';
import orderRoutes from './routes/orders';
import paymentRoutes from './routes/payments';
import productRoutes from './routes/products';
import reviewRoutes from './routes/reviews';

const app = express();

app.use(helmet());
app.use(globalLimiter);
app.use(pinoHttp({ logger }));

app.use(cors({ origin: [env.FRONTEND_URL, 'http://localhost:3000'], credentials: true }));
app.use(express.json({
  limit: '2mb',
  verify: (req: any, _res, buf) => { req.rawBody = buf; },
}));
app.use(cookieParser());

const api = express.Router();
api.get('/', (_req, res) => res.json({ status: 'ok', service: 'storefront-api' }));
api.use('/auth', authRoutes);
api.use('/products', productRoutes);
api.use('/cart', cartRoutes);
api.use('/coupons', couponRoutes);
api.use('/orders', orderRoutes);
api.use('/payments', paymentRoutes);
api.use('/reviews', reviewRoutes);
api.use('/admin', adminRoutes);
api.use('/agent', agentRoutes);

const mcpCors = cors({ origin: '*', exposedHeaders: ['Mcp-Session-Id'], allowedHeaders: ['Content-Type', 'Accept', 'Mcp-Session-Id', 'Mcp-Protocol-Version'] });
api.options('/mcp', mcpCors);
api.post('/mcp', mcpCors, handleMcpPost);
api.get('/mcp', mcpCors, handleMcpUnsupported);
api.delete('/mcp', mcpCors, handleMcpUnsupported);

app.use('/api', api);
app.use(errorHandler);

/**
 * Bootstraps the application: connects to the database, runs seeders if needed,
 * and starts the Express HTTP server.
 */
async function main() {
  await connectDB();
  await seedIfNeeded();
  const host = process.env.HOST || '127.0.0.1';
  app.listen(env.PORT, host, () => {
    console.log(`[api] storefront-api listening on ${host}:${env.PORT}`);
  });
}

main().catch(err => {
  console.error('[fatal]', err);
  process.exit(1);
});
