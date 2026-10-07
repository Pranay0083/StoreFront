import { IdempotencyModel, type IdempotencyRecord } from './idempotency.model';

const DUPLICATE_KEY = 11000;

export type BeginResult = { acquired: true } | { acquired: false; existing: IdempotencyRecord };

export class IdempotencyStore {
  constructor(private readonly lockTimeoutMs = 60_000) {}

  /**
   * Claims the key for this request. A key left in progress by a request that died is taken over
   * once its lock is older than the timeout, so a crashed request cannot block retries for a day.
   */
  async begin(id: string, requestHash: string, now = new Date()): Promise<BeginResult> {
    try {
      await IdempotencyModel.create({ _id: id, requestHash, status: 'in_progress', lockedAt: now, createdAt: now });
      return { acquired: true };
    } catch (e) {
      if ((e as { code?: number }).code !== DUPLICATE_KEY) throw e;
    }
    const takenOver = await IdempotencyModel.findOneAndUpdate(
      { _id: id, requestHash, status: 'in_progress', lockedAt: { $lt: new Date(now.getTime() - this.lockTimeoutMs) } },
      { $set: { lockedAt: now } },
    ).lean();
    if (takenOver) return { acquired: true };
    const existing = await IdempotencyModel.findById(id).lean<IdempotencyRecord>();
    if (!existing) return this.begin(id, requestHash, now);
    return { acquired: false, existing };
  }

  async complete(id: string, responseStatus: number, responseBody: unknown): Promise<void> {
    await IdempotencyModel.updateOne({ _id: id }, { $set: { status: 'completed', responseStatus, responseBody } });
  }

  async release(id: string): Promise<void> {
    await IdempotencyModel.deleteOne({ _id: id, status: 'in_progress' });
  }
}
