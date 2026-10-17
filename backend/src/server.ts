import './core/config/dotenv';
import { buildApp } from './app';
import { connectDB, disconnectDB } from './core/config/db';
import { loadEnv } from './core/config/env';
import { buildContainer } from './core/container';
import { buildInfrastructure, runsJobsInProcess } from './core/infrastructure';
import { logger } from './core/logger';
import { Metrics } from './core/observability/metrics';
import { closeHttpServer, GracefulShutdown } from './core/runtime/graceful-shutdown';
import { shutdownTracing } from './instrumentation';

try {
  const env = loadEnv();
  if (env.JWT_SECRETS_DERIVED) logger.warn('Deriving token keys from legacy JWT_SECRET; set JWT_ACCESS_SECRET and JWT_REFRESH_SECRET');
  await connectDB(env.MONGO_URL, env.DB_NAME);
  logger.info({ db: env.DB_NAME }, 'Connected to MongoDB');

  const metrics = new Metrics();
  const infra = buildInfrastructure(env, metrics.jobObserver());
  const container = buildContainer(env, infra, metrics);
  const server = buildApp(container).listen(env.PORT, env.HOST, () => {
    logger.info(`storefront-api listening on ${env.HOST}:${env.PORT}`);
  });

  const inProcess = runsJobsInProcess(env, infra);
  if (inProcess) await container.background.start();
  logger.info({ infrastructure: infra.kind, jobs: inProcess ? 'in-process' : 'external worker' }, 'Background processing configured');

  new GracefulShutdown(logger, env.SHUTDOWN_TIMEOUT_MS)
    .onBegin(() => {
      container.health.markDraining();
      container.services.realtime.close();
    })
    .add('http server', () => closeHttpServer(server))
    .add('background work', () => (inProcess ? container.background.stop() : undefined))
    .add('infrastructure', () => infra.close())
    .add('mongodb', () => disconnectDB())
    .add('tracing', () => shutdownTracing())
    .listen();
} catch (err) {
  console.error('[fatal] Failed to start storefront-api\n', err instanceof Error ? err.message : err);
  process.exit(1);
}
