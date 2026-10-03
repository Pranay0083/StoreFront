import './core/config/dotenv';
import { buildApp } from './app';
import { connectDB } from './core/config/db';
import { loadEnv } from './core/config/env';
import { buildContainer } from './core/container';
import { logger } from './core/logger';

try {
  const env = loadEnv();
  if (env.JWT_SECRETS_DERIVED) logger.warn('Deriving token keys from legacy JWT_SECRET; set JWT_ACCESS_SECRET and JWT_REFRESH_SECRET');
  await connectDB(env.MONGO_URL, env.DB_NAME);
  logger.info({ db: env.DB_NAME }, 'Connected to MongoDB');
  buildApp(buildContainer(env)).listen(env.PORT, env.HOST, () => {
    logger.info(`storefront-api listening on ${env.HOST}:${env.PORT}`);
  });
} catch (err) {
  console.error('[fatal] Failed to start storefront-api\n', err instanceof Error ? err.message : err);
  process.exit(1);
}
