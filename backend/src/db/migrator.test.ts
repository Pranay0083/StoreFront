import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { connectDB, disconnectDB } from '../core/config/db';
import type { Migration } from './migration';
import { MigrationLockedError, Migrator } from './migrator';

const db = () => mongoose.connection.db!;

function recording(id: string, log: string[]): Migration {
  return {
    id,
    description: `migration ${id}`,
    up: async database => {
      log.push(id);
      await database.collection('widgets').insertOne({ from: id });
    },
  };
}

describe('Migrator', () => {
  beforeAll(() => connectDB(process.env.MONGO_URL!, process.env.DB_NAME!));
  beforeEach(() => db().dropDatabase());
  afterAll(async () => {
    await db().dropDatabase();
    await disconnectDB();
  });

  it('applies pending migrations once, in order', async () => {
    const log: string[] = [];
    const migrator = new Migrator(db(), [recording('001-a', log), recording('002-b', log)]);

    expect(await migrator.up()).toEqual(['001-a', '002-b']);
    expect(await migrator.up()).toEqual([]);
    expect(log).toEqual(['001-a', '002-b']);

    const status = await migrator.status();
    expect(status.map(s => s.id)).toEqual(['001-a', '002-b']);
    expect(status.every(s => s.appliedAt instanceof Date)).toBe(true);
  });

  it('only runs migrations added since the last run', async () => {
    const log: string[] = [];
    await new Migrator(db(), [recording('001-a', log)]).up();
    expect(await new Migrator(db(), [recording('001-a', log), recording('002-b', log)]).up()).toEqual(['002-b']);
    expect(log).toEqual(['001-a', '002-b']);
  });

  it('does not record a migration that fails, and releases the lock', async () => {
    const failing: Migration = { id: '001-boom', description: 'fails', up: () => Promise.reject(new Error('boom')) };
    const migrator = new Migrator(db(), [failing]);
    await expect(migrator.up()).rejects.toThrow('boom');
    expect(await migrator.pending()).toHaveLength(1);
    await expect(migrator.up()).rejects.toThrow('boom');
  });

  it('refuses to run while another process holds the lock', async () => {
    await db().collection('migration_locks').insertOne({ _id: 'migrations' as never, owner: 'other', acquiredAt: new Date() });
    await expect(new Migrator(db(), [recording('001-a', [])]).up()).rejects.toThrow(MigrationLockedError);
  });

  it('takes over a stale lock', async () => {
    await db().collection('migration_locks').insertOne({ _id: 'migrations' as never, owner: 'dead', acquiredAt: new Date(Date.now() - 60 * 60 * 1000) });
    expect(await new Migrator(db(), [recording('001-a', [])]).up()).toEqual(['001-a']);
  });

  it('rejects duplicate or unordered registrations', () => {
    expect(() => new Migrator(db(), [recording('001-a', []), recording('001-a', [])])).toThrow(/Duplicate/);
    expect(() => new Migrator(db(), [recording('002-b', []), recording('001-a', [])])).toThrow(/order/);
  });
});
