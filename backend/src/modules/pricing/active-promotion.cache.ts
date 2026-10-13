import { CompiledPromotion } from './domain/promotion';
import type { SelectableProduct } from './domain/selector';
import type { PromotionRecord } from './promotion.model';
import { toDefinition } from './promotion.repository';

export interface ActivePromotionSource {
  findActive(): Promise<PromotionRecord[]>;
}

/** Lookup structure: which promotions could possibly touch a given product or code. */
export class PromotionIndex {
  private readonly global = new Set<CompiledPromotion>();
  private readonly byProductId = new Map<string, Set<CompiledPromotion>>();
  private readonly bySlug = new Map<string, Set<CompiledPromotion>>();
  private readonly byCategory = new Map<string, Set<CompiledPromotion>>();
  private readonly byCode = new Map<string, CompiledPromotion>();

  constructor(readonly promotions: readonly CompiledPromotion[]) {
    const add = (map: Map<string, Set<CompiledPromotion>>, key: string, p: CompiledPromotion) =>
      map.set(key, (map.get(key) ?? new Set()).add(p));
    for (const p of promotions) {
      if (p.def.code) this.byCode.set(p.def.code, p);
      const selectors = p.action.selectors();
      if (!selectors.length) this.global.add(p);
      for (const s of selectors) {
        s.productIds?.forEach(id => add(this.byProductId, id, p));
        s.slugs?.forEach(slug => add(this.bySlug, slug, p));
        s.categories?.forEach(c => add(this.byCategory, c, p));
      }
    }
  }

  /**
   * Cart-wide promotions, promotions whose selectors reference any of the products, and the
   * promotions behind any supplied codes; preserves priority order.
   */
  candidatesFor(products: readonly SelectableProduct[], codes: readonly string[] = []): CompiledPromotion[] {
    const hit = new Set(this.global);
    for (const code of codes) {
      const p = this.byCode.get(code.trim().toUpperCase());
      if (p) hit.add(p);
    }
    for (const product of products) {
      for (const p of this.byProductId.get(product.productId) ?? []) hit.add(p);
      for (const p of this.bySlug.get(product.slug) ?? []) hit.add(p);
      for (const p of this.byCategory.get(product.category) ?? []) hit.add(p);
    }
    return this.promotions.filter(p => hit.has(p));
  }

  touching(product: SelectableProduct): CompiledPromotion[] {
    return this.candidatesFor([product]).filter(p => !this.global.has(p));
  }
}

/**
 * Read-through cache of compiled active promotions with a short TTL. Writers call `invalidate()`;
 * a generation counter stops an in-flight load from resurrecting stale data after invalidation.
 */
export class ActivePromotionCache {
  private snapshot?: { loadedAt: number; index: PromotionIndex };
  private inflight?: Promise<PromotionIndex>;
  private generation = 0;

  constructor(
    private readonly source: ActivePromotionSource,
    private readonly ttlMs = 30_000,
    private readonly clock: () => number = Date.now,
  ) {}

  async index(): Promise<PromotionIndex> {
    if (this.snapshot && this.clock() - this.snapshot.loadedAt < this.ttlMs) return this.snapshot.index;
    this.inflight ??= this.load();
    return this.inflight;
  }

  invalidate(): void {
    this.generation += 1;
    this.snapshot = undefined;
    this.inflight = undefined;
  }

  private async load(): Promise<PromotionIndex> {
    const generation = this.generation;
    try {
      const records = await this.source.findActive();
      const index = new PromotionIndex(records.map(r => new CompiledPromotion(toDefinition(r))).sort(CompiledPromotion.compare));
      if (generation === this.generation) this.snapshot = { loadedAt: this.clock(), index };
      return index;
    } finally {
      if (generation === this.generation) this.inflight = undefined;
    }
  }
}
