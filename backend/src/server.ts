import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.env') });

try {
  const { loadEnv } = await import('./core/config/env');
  const env = loadEnv();
  const { connectDB } = await import('./core/config/db');
  const { seedIfNeeded } = await import('./seed');
  const { buildApp } = await import('./app');
  const { buildContainer } = await import('./core/container');
  const { logger } = await import('./core/logger');

  await connectDB(env.MONGO_URL, env.DB_NAME);
  logger.info({ db: env.DB_NAME }, 'Connected to MongoDB');
  await seedIfNeeded();
  buildApp(buildContainer(env)).listen(env.PORT, env.HOST, () => {
    logger.info(`storefront-api listening on ${env.HOST}:${env.PORT}`);
  });
} catch (err) {
  console.error('[fatal] Failed to start storefront-api\n', err instanceof Error ? err.message : err);
  process.exit(1);
}
