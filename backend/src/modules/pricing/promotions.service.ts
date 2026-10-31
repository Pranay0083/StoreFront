import {
  defaultShowOnStorefront,
  type CustomerSegment,
  type PriceBreakdown,
  type Promotion,
  type PromotionInput,
  type PromotionSimulationInput,
  type PromotionStatus,
  type PromotionUpdate,
} from '@storefront/contracts';
import { domainEvent, type DomainEventMap } from '../../core/events/domain-events';
import type { OutboxStore } from '../../core/events/outbox.store';
import { BadRequestError, ConflictError, NotFoundError } from '../../core/errors';
import { logger } from '../../core/logger';
import type { Session, TransactionRunner } from '../../core/persistence/transaction';
import type { ActivePromotionCache } from './active-promotion.cache';
import { type CustomerProfile, GUEST } from './domain/pricing-line';
import { CompiledPromotion } from './domain/promotion';
import type { PricingService } from './pricing.service';
import type { PromotionRecord } from './promotion.model';
import { isAdvertised, type PromotionRepository, toDefinition } from './promotion.repository';

export interface PromotionVersionView {
  version: number;
  changedBy?: string | null;
  createdAt: string;
  snapshot: Record<string, unknown>;
}

const SEGMENT_PROFILES: Record<CustomerSegment, CustomerProfile> = {
  guest: GUEST,
  signedIn: { id: 'simulated', signedIn: true, isFirstOrder: false },
  returning: { id: 'simulated', signedIn: true, isFirstOrder: false },
  firstOrder: { id: 'simulated', signedIn: true, isFirstOrder: true },
};

export function toPromotion(r: PromotionRecord): Promotion {
  return {
    _id: String(r._id),
    name: r.name,
    description: r.description ?? '',
    status: r.status as PromotionStatus,
    activation: r.activation as Promotion['activation'],
    priority: r.priority,
    exclusive: r.exclusive,
    action: r.action,
    usedCount: r.usedCount,
    version: r.version,
    showOnStorefront: isAdvertised(r),
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    ...(r.code && { code: r.code }),
    ...(r.stackGroup && { stackGroup: r.stackGroup }),
    ...(r.conditions && { conditions: r.conditions }),
    ...(r.startsAt && { startsAt: r.startsAt.toISOString() }),
    ...(r.endsAt && { endsAt: r.endsAt.toISOString() }),
    ...(r.usageLimit != null && { usageLimit: r.usageLimit }),
  };
}

export class PromotionsService {
  constructor(
    private readonly repo: PromotionRepository,
    private readonly cache: ActivePromotionCache,
    private readonly pricing: PricingService,
    private readonly tx: TransactionRunner,
    private readonly outbox: OutboxStore,
  ) {}

  /** Every saved version is announced through the outbox, in the same transaction as the write. */
  private changed(record: PromotionRecord, change: DomainEventMap['PromotionChanged']['change'], session: Session) {
    const promotionId = String(record._id);
    return this.outbox.append(
      [
        domainEvent(
          'PromotionChanged',
          promotionId,
          { promotionId, version: record.version, change, status: record.status as PromotionStatus },
          `promotion-changed:${promotionId}:${record.version}`,
        ),
      ],
      session,
    );
  }

  async list(status?: PromotionStatus): Promise<Promotion[]> {
    return (await this.repo.list(status)).map(toPromotion);
  }

  async get(id: string): Promise<Promotion> {
    return toPromotion(await this.require(id));
  }

  async versions(id: string): Promise<PromotionVersionView[]> {
    await this.require(id);
    return (await this.repo.versions(id)).map(v => ({
      version: v.version,
      changedBy: v.changedBy,
      createdAt: v.createdAt.toISOString(),
      snapshot: v.snapshot as Record<string, unknown>,
    }));
  }

  async create(input: PromotionInput, adminId: string): Promise<Promotion> {
    if (input.code && (await this.repo.codeTaken(input.code))) throw new ConflictError(`Code ${input.code} is already in use`);
    const record = await this.tx.run(async session => {
      const created = await this.repo.create(input, `user:${adminId}`, session);
      await this.changed(created, 'created', session);
      return created;
    });
    this.cache.invalidate();
    logger.info({ adminId, promotionId: record._id, name: record.name }, 'Promotion created');
    return toPromotion(record);
  }

  async update(id: string, patch: PromotionUpdate, adminId: string, expectedVersion?: number): Promise<Promotion> {
    const existing = await this.require(id);
    const activation = patch.activation ?? existing.activation;
    const dropCode = activation === 'auto' && patch.code === undefined && Boolean(existing.code);
    const code = dropCode ? undefined : (patch.code ?? existing.code ?? undefined);
    if ((activation === 'code') !== Boolean(code))
      throw new BadRequestError('Code promotions need a code, and automatic promotions must not have one');
    const startsAt = patch.startsAt ? new Date(patch.startsAt) : existing.startsAt;
    const endsAt = patch.endsAt ? new Date(patch.endsAt) : existing.endsAt;
    if (startsAt && endsAt && startsAt >= endsAt) throw new BadRequestError('endsAt must be after startsAt');
    if (patch.code && (await this.repo.codeTaken(patch.code, id))) throw new ConflictError(`Code ${patch.code} is already in use`);
    // Switching between automatic and code resets visibility to the new activation's default unless
    // the admin chose one, so turning an advertised offer into a code never publishes the code.
    const visibility =
      patch.showOnStorefront === undefined && patch.activation !== undefined && patch.activation !== existing.activation
        ? { showOnStorefront: defaultShowOnStorefront(patch.activation) }
        : {};
    const onlyStatus = Object.keys(patch).every(k => k === 'status');

    const record = await this.tx.run(async session => {
      const updated = await this.repo.update(
        id,
        { ...patch, ...visibility },
        `user:${adminId}`,
        expectedVersion,
        dropCode ? ['code'] : [],
        session,
      );
      if (updated) await this.changed(updated, onlyStatus ? 'status' : 'updated', session);
      return updated;
    });
    if (!record) throw new ConflictError('This promotion was changed by someone else. Reload it and try again.');
    this.cache.invalidate();
    logger.info({ adminId, promotionId: id, version: record.version }, 'Promotion updated');
    return toPromotion(record);
  }

  archive(id: string, adminId: string): Promise<Promotion> {
    return this.update(id, { status: 'archived' }, adminId);
  }

  /** Prices an arbitrary cart as a given kind of customer at a given moment, optionally including drafts. */
  async simulate(input: PromotionSimulationInput): Promise<PriceBreakdown> {
    const promotions = input.includeDrafts
      ? (await this.repo.findByStatuses(['active', 'draft'])).map(r => new CompiledPromotion({ ...toDefinition(r), status: 'active' }))
      : undefined;
    return this.pricing.price(
      { items: input.items, codes: input.codes, paymentMethod: input.paymentMethod },
      {},
      { promotions, customer: SEGMENT_PROFILES[input.segment], now: input.at ? new Date(input.at) : undefined },
    );
  }

  private async require(id: string): Promise<PromotionRecord> {
    const record = await this.repo.findById(id);
    if (!record) throw new NotFoundError('Promotion not found');
    return record;
  }
}
