import './core/config/dotenv';
import express from 'express';
import { connectDB, disconnectDB } from './core/config/db';
import { loadEnv } from './core/config/env';
import { buildContainer } from './core/container';
import { buildInfrastructure } from './core/infrastructure';
import { logger } from './core/logger';
import { Metrics, metricsHandler } from './core/observability/metrics';
import { closeHttpServer, GracefulShutdown } from './core/runtime/graceful-shutdown';
import { shutdownTracing } from './instrumentation';

try {
  const env = loadEnv();
  if (!env.REDIS_URL) {
    throw new Error('The worker needs REDIS_URL to share a queue with the API. Without Redis the API runs jobs in-process.');
  }
  await connectDB(env.MONGO_URL, env.DB_NAME);
  const metrics = new Metrics();
  const infra = buildInfrastructure(env, metrics.jobObserver());
  const container = buildContainer(env, infra, metrics);
  await container.background.start();
  logger.info({ queuePrefix: env.QUEUE_PREFIX }, 'storefront-worker processing jobs');

  const probes = express();
  probes.disable('x-powered-by');
  probes.use(container.health.routes());
  probes.get('/metrics', metricsHandler(metrics, env.METRICS_TOKEN));
  const server = probes.listen(env.WORKER_PORT, env.HOST, () => logger.info(`storefront-worker probes on ${env.HOST}:${env.WORKER_PORT}`));

  new GracefulShutdown(logger, env.SHUTDOWN_TIMEOUT_MS)
    .onBegin(() => container.health.markDraining())
    .add('probe server', () => closeHttpServer(server))
    .add('background work', () => container.background.stop())
    .add('infrastructure', () => infra.close())
    .add('mongodb', () => disconnectDB())
    .add('tracing', () => shutdownTracing())
    .listen();
} catch (err) {
  console.error('[fatal] Failed to start storefront-worker\n', err instanceof Error ? err.message : err);
  process.exit(1);
}
