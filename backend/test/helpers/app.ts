import type { Express } from 'express';
import mongoose from 'mongoose';
import supertest from 'supertest';
import { afterAll, beforeAll, beforeEach } from 'vitest';
import { buildApp } from '../../src/app';
import { connectDB, disconnectDB } from '../../src/core/config/db';

export const API = '/api';

export interface TestApp {
  app: Express;
  http: () => supertest.Agent;
}

export function useTestApp(): TestApp {
  const ctx = {} as TestApp;

  beforeAll(async () => {
    await connectDB(process.env.MONGO_URL!, process.env.DB_NAME!);
    await Promise.all(Object.values(mongoose.models).map(m => m.syncIndexes()));
    ctx.app = buildApp();
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
