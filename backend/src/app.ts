import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import { env } from './env';
import { errorHandler } from './middleware';
import adminRoutes from './routes/admin';
import authRoutes from './routes/auth';
import cartRoutes from './routes/cart';
import couponRoutes from './routes/coupons';
import orderRoutes from './routes/orders';
import paymentRoutes from './routes/payments';
import productRoutes from './routes/products';
import reviewRoutes from './routes/reviews';

export function createApp() {
  const app = express();
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
  app.use('/api', api);

  app.use(errorHandler);
  return app;
}
