import type { Express } from 'express';
import mongoose from 'mongoose';
import supertest from 'supertest';
import { afterAll, beforeAll, beforeEach } from 'vitest';
import { buildApp } from '../../src/app';
import { loadEnv } from '../../src/core/config/env';
import { connectDB, disconnectDB } from '../../src/core/config/db';
import { buildContainer, type Container } from '../../src/core/container';

export const API = '/api/v1';

export interface TestApp {
  app: Express;
  container: Container;
  http: () => supertest.Agent;
}

export function useTestApp(): TestApp {
  const ctx = {} as TestApp;

  beforeAll(async () => {
    await connectDB(process.env.MONGO_URL!, process.env.DB_NAME!);
    await Promise.all(Object.values(mongoose.models).map(m => m.syncIndexes()));
    ctx.container = buildContainer(loadEnv());
    ctx.app = buildApp(ctx.container);
    ctx.http = () => supertest.agent(ctx.app);
  });

  beforeEach(async () => {
    const collections = await mongoose.connection.db!.collections();
    await Promise.all(collections.map(c => c.deleteMany({})));
  });

  afterAll(async () => {
    await mongoose.connection.dropDatabase();
    await disconnectDB();
  });

  return ctx;
}

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
