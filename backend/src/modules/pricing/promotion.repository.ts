import type { PromotionInput, PromotionStatus, PromotionUpdate } from '@storefront/contracts';
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

  /** Creates the promotion and its version-1 snapshot atomically. */
  async create(input: PromotionInput, by: string): Promise<PromotionRecord> {
    return mongoose.connection.transaction(async session => {
      const [doc] = await PromotionModel.create([{ ...toPersisted(input), version: 1, createdBy: by, updatedBy: by }], { session });
      const record = doc.toObject() as PromotionRecord;
      await this.snapshot(record, by, session);
      return record;
    });
  }

  /**
   * Applies a patch as a new version. With `expectedVersion`, the write only succeeds if nobody
   * else changed the promotion first (optimistic concurrency); returns null when that check fails
   * or the promotion does not exist.
   */
  async update(id: string, patch: PromotionUpdate, by: string, expectedVersion?: number): Promise<PromotionRecord | null> {
    return mongoose.connection.transaction(async session => {
      const record = await PromotionModel.findOneAndUpdate(
        { _id: id, ...(expectedVersion !== undefined && { version: expectedVersion }) },
        { $set: { ...toPersisted(patch), updatedBy: by }, $inc: { version: 1 } },
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
  async tryRedeem(id: string): Promise<boolean> {
    const result = await PromotionModel.updateOne(
      {
        _id: id,
        $or: [{ usageLimit: { $exists: false } }, { usageLimit: null }, { $expr: { $lt: ['$usedCount', '$usageLimit'] } }],
      },
      { $inc: { usedCount: 1 } },
    );
    return result.modifiedCount === 1;
  }

  async releaseRedemption(id: string): Promise<void> {
    await PromotionModel.updateOne({ _id: id, usedCount: { $gt: 0 } }, { $inc: { usedCount: -1 } });
  }

  private async snapshot(record: PromotionRecord, by: string, session: ClientSession): Promise<void> {
    const { _id, usedCount: _usedCount, createdAt: _c, updatedAt: _u, ...snapshot } = record as PromotionRecord & { __v?: number };
    delete (snapshot as { __v?: number }).__v;
    await PromotionVersionModel.create([{ promotionId: _id, version: record.version, snapshot, changedBy: by }], { session });
  }
}
