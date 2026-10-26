import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { connectDB, disconnectDB } from '../config/db';
import { TransactionRunner } from './transaction';

const counters = () => mongoose.connection.db!.collection<{ _id: string; n: number; log: number[] }>('tx_counters');

describe('TransactionRunner', () => {
  beforeAll(() => connectDB(process.env.MONGO_URL!, process.env.DB_NAME!));
  beforeEach(async () => {
    await mongoose.connection.db!.dropDatabase();
    await counters().insertOne({ _id: 'hot', n: 0, log: [] });
  });
  afterAll(async () => {
    await mongoose.connection.db!.dropDatabase();
    await disconnectDB();
  });

  it('serialises conflicting writers on one document through backoff retries', async () => {
    const tx = new TransactionRunner();
    const writers = 40;
    await Promise.all(
      Array.from({ length: writers }, (_, i) =>
        tx.run(async session => {
          const doc = await counters().findOne({ _id: 'hot' }, { session });
          await counters().updateOne({ _id: 'hot' }, { $set: { n: doc!.n + 1 }, $push: { log: i } }, { session });
        }),
      ),
    );
    const doc = await counters().findOne({ _id: 'hot' });
    expect(doc!.n).toBe(writers);
    expect(new Set(doc!.log).size).toBe(writers);
    expect(tx.stats.retries).toBeGreaterThan(0);
  });

  it('does not retry application errors and leaves no partial writes', async () => {
    const tx = new TransactionRunner();
    let calls = 0;
    await expect(
      tx.run(async session => {
        calls++;
        await counters().updateOne({ _id: 'hot' }, { $inc: { n: 1 } }, { session });
        throw new Error('sold out');
      }),
    ).rejects.toThrow('sold out');
    expect(calls).toBe(1);
    expect((await counters().findOne({ _id: 'hot' }))!.n).toBe(0);
  });

  it('gives up after the configured number of attempts', async () => {
    const tx = new TransactionRunner({ maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 2 });
    const transient = Object.assign(new Error('write conflict'), { hasErrorLabel: (l: string) => l === 'TransientTransactionError' });
    let calls = 0;
    await expect(
      tx.run(async () => {
        calls++;
        throw transient;
      }),
    ).rejects.toThrow('write conflict');
    expect(calls).toBe(3);
  });
});
