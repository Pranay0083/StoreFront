import type { mongo } from 'mongoose';
import { logger } from '../core/logger';
import type { Migration } from './migration';

interface AppliedMigration {
  _id: string;
  description: string;
  appliedAt: Date;
  durationMs: number;
}

interface LockDoc {
  _id: string;
  owner: string;
  acquiredAt: Date;
}

const LOCK_ID = 'migrations';
const STALE_LOCK_MS = 10 * 60 * 1000;

export class MigrationLockedError extends Error {}

/** Applies versioned migrations exactly once, in id order, guarded by a lock document. */
export class Migrator {
  private readonly owner = `${process.pid}-${Math.random().toString(36).slice(2, 8)}`;

  constructor(
    private readonly db: mongo.Db,
    private readonly migrations: readonly Migration[],
  ) {
    const ids = migrations.map(m => m.id);
    if (new Set(ids).size !== ids.length) throw new Error('Duplicate migration ids');
    if (ids.join() !== [...ids].sort().join()) throw new Error('Migrations must be registered in id order');
  }

  private get applied() {
    return this.db.collection<AppliedMigration>('migrations');
  }

  private get locks() {
    return this.db.collection<LockDoc>('migration_locks');
  }

  async status(): Promise<Array<{ id: string; description: string; appliedAt: Date | null }>> {
    const done = new Map((await this.applied.find().toArray()).map(m => [m._id, m.appliedAt]));
    return this.migrations.map(m => ({ id: m.id, description: m.description, appliedAt: done.get(m.id) ?? null }));
  }

  async pending(): Promise<Migration[]> {
    const done = new Set((await this.applied.find({}, { projection: { _id: 1 } }).toArray()).map(m => m._id));
    return this.migrations.filter(m => !done.has(m.id));
  }

  async up(): Promise<string[]> {
    await this.acquireLock();
    try {
      const ran: string[] = [];
      for (const migration of await this.pending()) {
        const started = Date.now();
        logger.info({ migration: migration.id }, 'Applying migration');
        await migration.up(this.db);
        await this.applied.insertOne({
          _id: migration.id,
          description: migration.description,
          appliedAt: new Date(),
          durationMs: Date.now() - started,
        });
        ran.push(migration.id);
      }
      return ran;
    } finally {
      await this.locks.deleteOne({ _id: LOCK_ID, owner: this.owner });
    }
  }

  private async acquireLock(): Promise<void> {
    await this.locks.deleteOne({ _id: LOCK_ID, acquiredAt: { $lt: new Date(Date.now() - STALE_LOCK_MS) } });
    try {
      await this.locks.insertOne({ _id: LOCK_ID, owner: this.owner, acquiredAt: new Date() });
    } catch (e) {
      if ((e as { code?: number }).code === 11000) throw new MigrationLockedError('Another process is running migrations');
      throw e;
    }
  }
}
