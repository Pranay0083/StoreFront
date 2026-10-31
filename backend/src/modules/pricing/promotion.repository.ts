import { defaultShowOnStorefront, type PromotionInput, type PromotionStatus, type PromotionUpdate } from '@storefront/contracts';
import mongoose, { type ClientSession } from 'mongoose';
import type { PromotionDefinition } from './domain/promotion';
import { PromotionModel, type PromotionRecord, PromotionVersionModel, type PromotionVersionRecord } from './promotion.model';

type Persisted = Omit<PromotionInput, 'startsAt' | 'endsAt'> & { startsAt?: Date; endsAt?: Date };

const toPersisted = <T extends Partial<PromotionInput>>(input: T) => {
  const { startsAt, endsAt, ...rest } = input;
  return {
    ...rest,
    ...(startsAt !== undefined && { startsAt: new Date(startsAt) }),
    ...(endsAt !== undefined && { endsAt: new Date(endsAt) }),
  } as Partial<Persisted>;
};

/** Documents written before migration 090 (or inserted raw, like the demo seed) take their activation's default. */
export const isAdvertised = (r: Pick<PromotionRecord, 'activation' | 'showOnStorefront'>): boolean =>
  r.showOnStorefront ?? defaultShowOnStorefront(r.activation as PromotionDefinition['activation']);

export function toDefinition(r: PromotionRecord): PromotionDefinition {
  return {
    id: String(r._id),
    version: r.version,
    name: r.name,
    description: r.description ?? '',
    status: r.status as PromotionStatus,
    activation: r.activation as PromotionDefinition['activation'],
    priority: r.priority,
    exclusive: r.exclusive,
    action: r.action,
    usedCount: r.usedCount,
    showOnStorefront: isAdvertised(r),
    ...(r.code && { code: r.code }),
    ...(r.stackGroup && { stackGroup: r.stackGroup }),
    ...(r.conditions && { conditions: r.conditions }),
    ...(r.startsAt && { startsAt: r.startsAt }),
    ...(r.endsAt && { endsAt: r.endsAt }),
    ...(r.usageLimit != null && { usageLimit: r.usageLimit }),
  };
}

export class PromotionRepository {
  findActive(): Promise<PromotionRecord[]> {
    return PromotionModel.find({ status: 'active' }).sort({ priority: -1, _id: 1 }).lean<PromotionRecord[]>();
  }

  findByStatuses(statuses: readonly PromotionStatus[]): Promise<PromotionRecord[]> {
    return PromotionModel.find({ status: { $in: statuses } })
      .sort({ priority: -1, _id: 1 })
      .lean<PromotionRecord[]>();
  }

  list(status?: PromotionStatus): Promise<PromotionRecord[]> {
    return PromotionModel.find(status ? { status } : {})
      .sort({ updatedAt: -1 })
      .lean<PromotionRecord[]>();
  }

  findById(id: string): Promise<PromotionRecord | null> {
    return PromotionModel.findById(id).lean<PromotionRecord>();
  }

  async codeTaken(code: string, exceptId?: string): Promise<boolean> {
    return (await PromotionModel.exists({ code, ...(exceptId && { _id: { $ne: exceptId } }) })) !== null;
  }

  /**
   * Creates the promotion and its version-1 snapshot atomically. Pass `session` to join the caller's
   * transaction (so an outbox event commits with the write); otherwise the repository opens its own.
   */
  async create(input: PromotionInput, by: string, session?: ClientSession): Promise<PromotionRecord> {
    return this.inTransaction(session, async s => {
      const showOnStorefront = input.showOnStorefront ?? defaultShowOnStorefront(input.activation);
      const [doc] = await PromotionModel.create([{ ...toPersisted(input), showOnStorefront, version: 1, createdBy: by, updatedBy: by }], {
        session: s,
      });
      const record = doc.toObject() as PromotionRecord;
      await this.snapshot(record, by, s);
      return record;
    });
  }

  /**
   * Applies a patch as a new version. With `expectedVersion`, the write only succeeds if nobody
   * else changed the promotion first (optimistic concurrency); returns null when that check fails
   * or the promotion does not exist.
   */
  async update(
    id: string,
    patch: PromotionUpdate,
    by: string,
    expectedVersion?: number,
    unset: readonly string[] = [],
    outer?: ClientSession,
  ): Promise<PromotionRecord | null> {
    return this.inTransaction(outer, async session => {
      const record = await PromotionModel.findOneAndUpdate(
        { _id: id, ...(expectedVersion !== undefined && { version: expectedVersion }) },
        {
          $set: { ...toPersisted(patch), updatedBy: by },
          $inc: { version: 1 },
          ...(unset.length && { $unset: Object.fromEntries(unset.map(f => [f, 1])) }),
        },
        { new: true, session, runValidators: true },
      ).lean<PromotionRecord>();
      if (record) await this.snapshot(record, by, session);
      return record;
    });
  }

  versions(id: string): Promise<PromotionVersionRecord[]> {
    return PromotionVersionModel.find({ promotionId: id }).sort({ version: -1 }).lean<PromotionVersionRecord[]>();
  }

  /** Counts one redemption unless that would exceed the usage limit. */
  async tryRedeem(id: string, session?: ClientSession): Promise<boolean> {
    const result = await PromotionModel.updateOne(
      {
        _id: id,
        $or: [{ usageLimit: { $exists: false } }, { usageLimit: null }, { $expr: { $lt: ['$usedCount', '$usageLimit'] } }],
      },
      { $inc: { usedCount: 1 } },
      { session },
    );
    return result.modifiedCount === 1;
  }

  async releaseRedemption(id: string, session?: ClientSession): Promise<void> {
    await PromotionModel.updateOne({ _id: id, usedCount: { $gt: 0 } }, { $inc: { usedCount: -1 } }, { session });
  }

  private inTransaction<T>(session: ClientSession | undefined, work: (session: ClientSession) => Promise<T>): Promise<T> {
    return session ? work(session) : mongoose.connection.transaction(work);
  }

  private async snapshot(record: PromotionRecord, by: string, session: ClientSession): Promise<void> {
    const { _id, usedCount: _usedCount, createdAt: _c, updatedAt: _u, ...snapshot } = record as PromotionRecord & { __v?: number };
    delete (snapshot as { __v?: number }).__v;
    await PromotionVersionModel.create([{ promotionId: _id, version: record.version, snapshot, changedBy: by }], { session });
  }
}
