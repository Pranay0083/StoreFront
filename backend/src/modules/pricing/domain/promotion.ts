import type { ActionSpec, ConditionSpec, PricingStageName, PromotionActivation, PromotionStatus } from '@storefront/contracts';
import { buildAction } from './action.factory';
import { CartDiscountAction, ConsumingAction, FreeShippingAction, MarkdownAction, type PromotionAction } from './actions';
import { buildCondition } from './condition.factory';
import type { Condition, ConditionResult } from './conditions';

/** Persistence-agnostic promotion definition (one immutable version of a promotion). */
export interface PromotionDefinition {
  id: string;
  version: number;
  name: string;
  description: string;
  status: PromotionStatus;
  activation: PromotionActivation;
  code?: string;
  priority: number;
  stackGroup?: string;
  exclusive: boolean;
  conditions?: ConditionSpec;
  action: ActionSpec;
  startsAt?: Date;
  endsAt?: Date;
  usageLimit?: number;
  usedCount: number;
}

/** A promotion whose JSON rules have been interpreted into condition and action objects. */
export class CompiledPromotion {
  readonly condition: Condition;
  readonly action: PromotionAction;

  constructor(readonly def: PromotionDefinition) {
    this.condition = buildCondition(def.conditions);
    this.action = buildAction(def.action);
  }

  get id(): string {
    return this.def.id;
  }

  get name(): string {
    return this.def.name;
  }

  get exclusive(): boolean {
    return this.def.exclusive;
  }

  get stackGroup(): string | undefined {
    return this.def.stackGroup;
  }

  get requiresCode(): boolean {
    return this.def.activation === 'code';
  }

  get stage(): PricingStageName {
    if (this.action instanceof MarkdownAction) return 'markdown';
    if (this.action instanceof ConsumingAction) return 'bundle';
    if (this.action instanceof FreeShippingAction) return 'shipping';
    return this.requiresCode ? 'code' : 'cart';
  }

  consumingAction(): ConsumingAction | undefined {
    return this.action instanceof ConsumingAction ? this.action : undefined;
  }

  cartAction(): CartDiscountAction | undefined {
    return this.action instanceof CartDiscountAction ? this.action : undefined;
  }

  markdownAction(): MarkdownAction | undefined {
    return this.action instanceof MarkdownAction ? this.action : undefined;
  }

  liveness(now: Date): ConditionResult {
    const { status, startsAt, endsAt, usageLimit, usedCount } = this.def;
    if (status !== 'active') return { ok: false, reason: 'This offer is not active' };
    if (startsAt && now < startsAt) return { ok: false, reason: 'This offer has not started yet' };
    if (endsAt && now >= endsAt) return { ok: false, reason: 'This offer has expired' };
    if (usageLimit !== undefined && usedCount >= usageLimit) return { ok: false, reason: 'This offer has been fully redeemed' };
    return { ok: true };
  }

  isLive(now: Date): boolean {
    return this.liveness(now).ok;
  }

  /** Deterministic ordering: higher priority first, then id. */
  static compare(a: CompiledPromotion, b: CompiledPromotion): number {
    return b.def.priority - a.def.priority || a.id.localeCompare(b.id);
  }
}
