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
  const container = buildContainer(env);
  const server = buildApp(container).listen(env.PORT, env.HOST, () => {
    logger.info(`storefront-api listening on ${env.HOST}:${env.PORT}`);
  });
  container.background.start();

  const shutdown = (signal: string) => {
    logger.info({ signal }, 'Shutting down');
    server.close();
    container.background.stop().finally(() => process.exit(0));
  };
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
} catch (err) {
  console.error('[fatal] Failed to start storefront-api\n', err instanceof Error ? err.message : err);
  process.exit(1);
}
