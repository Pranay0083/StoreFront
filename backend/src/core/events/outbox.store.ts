import type { Session } from '../persistence/transaction';
import type { AnyDomainEvent, DomainEvent } from './domain-events';
import { OutboxModel, type OutboxRecord } from './outbox.model';

const DUPLICATE_KEY = 11000;

/** Write side of the transactional outbox: events are persisted in the same transaction as the state change. */
export class OutboxStore {
  async append(events: readonly DomainEvent[], session?: Session): Promise<void> {
    if (!events.length) return;
    const docs = events.map(e => ({
      _id: e.id,
      name: e.name,
      aggregateId: e.aggregateId,
      payload: e.payload as unknown as Record<string, unknown>,
      occurredAt: e.occurredAt,
      status: 'pending' as const,
      attempts: 0,
      nextAttemptAt: e.occurredAt,
      handlersDone: [],
    }));
    if (session) {
      await OutboxModel.insertMany(docs, { session });
      return;
    }
    try {
      await OutboxModel.insertMany(docs, { ordered: false });
    } catch (e) {
      // Deterministic event ids make re-publishing the same fact a no-op.
      const writeErrors = (e as { writeErrors?: Array<{ code?: number; err?: { code?: number } }> }).writeErrors ?? [];
      const allDuplicates = writeErrors.length > 0 && writeErrors.every(w => (w.code ?? w.err?.code) === DUPLICATE_KEY);
      if (!allDuplicates && (e as { code?: number }).code !== DUPLICATE_KEY) throw e;
    }
  }

  /** Atomically leases the next due event; stale leases from crashed workers are reclaimed. */
  async claimNext(now: Date, leaseMs: number, excludeIds: string[] = []): Promise<OutboxRecord | null> {
    return OutboxModel.findOneAndUpdate(
      {
        ...(excludeIds.length && { _id: { $nin: excludeIds } }),
        $or: [
          { status: 'pending', nextAttemptAt: { $lte: now } },
          { status: 'processing', lockedUntil: { $lt: now } },
        ],
      },
      { $set: { status: 'processing', lockedUntil: new Date(now.getTime() + leaseMs) }, $inc: { attempts: 1 } },
      { sort: { occurredAt: 1 }, new: true },
    ).lean<OutboxRecord>();
  }

  async markHandlerDone(id: string, handlerId: string): Promise<void> {
    await OutboxModel.updateOne({ _id: id }, { $addToSet: { handlersDone: handlerId } });
  }

  async complete(id: string, now: Date): Promise<void> {
    await OutboxModel.updateOne({ _id: id }, { $set: { status: 'done', processedAt: now }, $unset: { lockedUntil: 1, lastError: 1 } });
  }

  async reschedule(id: string, error: string, nextAttemptAt: Date): Promise<void> {
    await OutboxModel.updateOne({ _id: id }, { $set: { status: 'pending', nextAttemptAt, lastError: error }, $unset: { lockedUntil: 1 } });
  }

  async deadLetter(id: string, error: string, now: Date): Promise<void> {
    await OutboxModel.updateOne({ _id: id }, { $set: { status: 'dead', lastError: error, processedAt: now }, $unset: { lockedUntil: 1 } });
  }

  find(id: string): Promise<OutboxRecord | null> {
    return OutboxModel.findById(id).lean<OutboxRecord>();
  }

  list(filter: Partial<Pick<OutboxRecord, 'status' | 'name' | 'aggregateId'>> = {}): Promise<OutboxRecord[]> {
    return OutboxModel.find(filter).sort({ occurredAt: 1 }).lean<OutboxRecord[]>();
  }

  static toEvent(record: OutboxRecord): AnyDomainEvent {
    return {
      id: record._id,
      name: record.name,
      aggregateId: record.aggregateId,
      occurredAt: record.occurredAt,
      payload: record.payload,
    } as unknown as AnyDomainEvent;
  }
}
