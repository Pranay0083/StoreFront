import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

/**
 * Boots the API for end-to-end tests: an in-memory replica set (transactions need one), migrations
 * plus the demo seed, and in-process jobs, so no Redis or real database is required.
 */
const backendDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });

const env = {
  ...process.env,
  NODE_ENV: 'development',
  HOST: '127.0.0.1',
  PORT: process.env.E2E_API_PORT ?? '4801',
  LOG_LEVEL: process.env.LOG_LEVEL ?? 'warn',
  MONGO_URL: replSet.getUri(),
  DB_NAME: 'storefront_e2e',
  JWT_ACCESS_SECRET: 'e2e-access-secret-0123456789abcdef0123',
  JWT_REFRESH_SECRET: 'e2e-refresh-secret-0123456789abcdef012',
  CSRF_SECRET: 'e2e-csrf-secret-0123456789abcdef0123456',
  ADMIN_EMAIL: 'admin@storefront.dev',
  ADMIN_PASSWORD: 'Admin@12345',
  SEED_DEMO_DATA: 'true',
  FRONTEND_URL: process.env.E2E_WEB_URL ?? 'http://127.0.0.1:3100',
  CORS_ORIGINS: `${process.env.E2E_WEB_URL ?? 'http://127.0.0.1:3100'},http://localhost:3100`,
  COOKIE_SAMESITE: 'lax',
  COOKIE_SECURE: 'false',
  RATE_LIMIT_ENABLED: 'false',
  JOBS_IN_PROCESS: 'true',
  REDIS_URL: '',
  MEILI_URL: '',
  RAZORPAY_KEY_ID: '',
  RAZORPAY_KEY_SECRET: '',
  STOREFRONT_REVALIDATE_SECRET: process.env.STOREFRONT_REVALIDATE_SECRET ?? 'e2e-revalidate-secret-0123',
};

const tsx = path.join(backendDir, '..', 'node_modules', '.bin', 'tsx');
// Asynchronous on purpose: blocking the event loop would stop mongod's output being drained and stall it.
const setupCode = await new Promise<number>(resolve =>
  spawn(tsx, ['src/db/cli.ts', 'setup'], { cwd: backendDir, env, stdio: 'inherit' }).on('exit', code => resolve(code ?? 1)),
);
if (setupCode !== 0) {
  await replSet.stop();
  process.exit(setupCode);
}

const api = spawn(tsx, ['src/server.ts'], { cwd: backendDir, env, stdio: 'inherit' });
const stop = async (code = 0) => {
  api.kill('SIGTERM');
  await replSet.stop();
  process.exit(code);
};
api.on('exit', code => void stop(code ?? 0));
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
