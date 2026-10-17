import type { Express } from 'express';
import mongoose from 'mongoose';
import supertest from 'supertest';
import { afterAll, beforeAll, beforeEach } from 'vitest';
import { buildApp } from '../../src/app';
import { loadEnv } from '../../src/core/config/env';
import { connectDB, disconnectDB } from '../../src/core/config/db';
import { buildContainer, type Container } from '../../src/core/container';
import { MemoryJobQueue } from '../../src/core/queue/memory-job-queue';

export const API = '/api/v1';

export interface TestApp {
  app: Express;
  container: Container;
  http: () => supertest.Agent;
  /** Delivers pending outbox events and runs due jobs, repeatedly, until nothing is left to do. */
  settle: () => Promise<void>;
}

export async function settle(container: Container): Promise<void> {
  for (let round = 0; round < 20; round++) {
    const events = await container.services.relay.drain();
    const jobs = container.jobs instanceof MemoryJobQueue ? await container.jobs.drain() : 0;
    if (!events && !jobs) return;
  }
  throw new Error('Background work did not settle');
}

export function useTestApp(): TestApp {
  const ctx = {} as TestApp;

  beforeAll(async () => {
    await connectDB(process.env.MONGO_URL!, process.env.DB_NAME!);
    await Promise.all(Object.values(mongoose.models).map(m => m.syncIndexes()));
    ctx.container = buildContainer(loadEnv());
    ctx.app = buildApp(ctx.container);
    ctx.http = () => supertest.agent(ctx.app);
    ctx.settle = () => settle(ctx.container);
  });

  beforeEach(async () => {
    const collections = await mongoose.connection.db!.collections();
    await Promise.all(collections.map(c => c.deleteMany({})));
    ctx.container.services.promotionCache.invalidate();
    await ctx.container.services.cachedCatalog.invalidate();
  });

  afterAll(async () => {
    await mongoose.connection.dropDatabase();
    await disconnectDB();
  });

  return ctx;
}

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
