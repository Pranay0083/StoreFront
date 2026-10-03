import { ConflictError, NotFoundError } from '../../core/errors';
import type { Session } from '../../core/persistence/transaction';
import type { ProductRepository } from '../catalog/product.repository';
import type { InventoryMovementRecord } from './inventory-movement.model';
import type { InventoryMovementRepository, NewMovement, StockReservationRepository } from './inventory.repository';

export interface StockItem {
  productId: string;
  size: string;
  qty: number;
}

export interface ReservableItem extends StockItem {
  title: string;
}

export class InsufficientStockError extends ConflictError {
  constructor(
    readonly productId: string,
    readonly size: string,
    readonly available: number,
    title: string,
  ) {
    super(`Only ${available} left of ${title} (${size})`);
  }
}

export interface ReconciliationMismatch {
  productId: string;
  title: string;
  size: string;
  stock: number;
  ledger: number;
}

export interface ReconciliationReport {
  ok: boolean;
  variantsChecked: number;
  mismatches: ReconciliationMismatch[];
}

/** Owns every change to sellable stock and records each one in the append-only ledger. */
export class InventoryService {
  constructor(
    private readonly products: ProductRepository,
    private readonly movements: InventoryMovementRepository,
    private readonly reservations: StockReservationRepository,
  ) {}

  /** Takes stock for an order (all-or-nothing within the caller's transaction) and holds it until `expiresAt`. */
  async reserve(orderId: string, items: ReservableItem[], expiresAt: Date, actor: string, session: Session): Promise<void> {
    for (const item of items) {
      if (!(await this.products.tryDecrementStock(item.productId, item.size, item.qty, session))) {
        const current = await this.products.findStockLevels(item.productId, session);
        const available = current?.sizes.find(s => s.size === item.size)?.stock ?? 0;
        throw new InsufficientStockError(item.productId, item.size, available, item.title);
      }
    }
    await this.reservations.create(
      { orderId, items: items.map(({ productId, size, qty }) => ({ productId, size, qty })), expiresAt },
      session,
    );
    await this.movements.append(
      items.map(i => this.movement(i, 'RESERVE', -i.qty, orderId, actor)),
      session,
    );
  }

  /** Converts an active reservation into a sale. Returns false if there was no active reservation to commit. */
  async commit(orderId: string, actor: string, session: Session): Promise<boolean> {
    const reservation = await this.reservations.transition(orderId, 'active', 'committed', session);
    if (!reservation) return false;
    await this.movements.append(
      reservation.items.map(i => this.movement(this.line(i), 'SALE', 0, orderId, actor)),
      session,
    );
    return true;
  }

  /** Returns reserved-but-unpaid units to stock. Idempotent: only an active reservation is released. */
  async release(orderId: string, actor: string, note: string, session: Session): Promise<boolean> {
    const reservation = await this.reservations.transition(orderId, 'active', 'released', session);
    if (!reservation) return false;
    await this.restock(
      reservation.items.map(i => this.line(i)),
      'RELEASE',
      orderId,
      actor,
      note,
      session,
    );
    return true;
  }

  /**
   * Puts sold units back into stock after a refund: RELEASE for orders that never shipped,
   * RETURN for goods coming back from the customer. Idempotent: only a committed reservation is restocked.
   */
  async restockSale(orderId: string, kind: 'RELEASE' | 'RETURN', actor: string, note: string, session: Session): Promise<boolean> {
    const reservation = await this.reservations.transition(orderId, 'committed', 'returned', session);
    if (!reservation) return false;
    await this.restock(
      reservation.items.map(i => this.line(i)),
      kind,
      orderId,
      actor,
      note,
      session,
    );
    return true;
  }

  async hasReservation(orderId: string, session?: Session): Promise<boolean> {
    return (await this.reservations.findByOrder(orderId, session)) !== null;
  }

  expiredReservations(now: Date, limit = 100): Promise<string[]> {
    return this.reservations.expiredOrderIds(now, limit);
  }

  /** Records the initial stock of a newly created product. */
  async recordOpeningStock(
    productId: string,
    sizes: Array<{ size: string; stock: number }>,
    actor: string,
    session: Session,
  ): Promise<void> {
    await this.movements.append(
      sizes
        .filter(s => s.stock > 0)
        .map(s => this.movement({ productId, size: s.size, qty: s.stock }, 'RESTOCK', s.stock, undefined, actor, 'Opening stock')),
      session,
    );
  }

  /**
   * Applies absolute stock levels from an admin edit as ADJUST movements against the current levels.
   * Must run in a transaction so a concurrent checkout either commits first or retries after this one.
   */
  async setStockLevels(productId: string, sizes: Array<{ size: string; stock: number }>, actor: string, session: Session): Promise<void> {
    const current = await this.products.findStockLevels(productId, session);
    if (!current) throw new NotFoundError('Product not found');
    const before = new Map(current.sizes.map(s => [s.size, s.stock]));
    const after = new Map(sizes.map(s => [s.size, s.stock]));
    const movements: NewMovement[] = [];
    for (const size of new Set([...before.keys(), ...after.keys()])) {
      const delta = (after.get(size) ?? 0) - (before.get(size) ?? 0);
      if (delta === 0) continue;
      const note = !after.has(size) ? 'Size removed' : !before.has(size) ? 'Size added' : 'Manual stock edit';
      movements.push(this.movement({ productId, size, qty: Math.abs(delta) }, 'ADJUST', delta, undefined, actor, note));
    }
    await this.movements.append(movements, session);
  }

  movementsFor(filter: { productId?: string; orderId?: string }, limit?: number): Promise<InventoryMovementRecord[]> {
    return this.movements.list(filter, limit);
  }

  /** Proves the ledger and the stock counters agree: for every variant, sum(delta) must equal stock. */
  async reconcile(): Promise<ReconciliationReport> {
    const [balances, products] = await Promise.all([this.movements.balances(), this.products.allStockLevels()]);
    const ledger = new Map(balances.map(b => [`${b.productId}:${b.size}`, b.balance]));
    const mismatches: ReconciliationMismatch[] = [];
    let variantsChecked = 0;
    for (const p of products) {
      for (const s of p.sizes) {
        variantsChecked++;
        const balance = ledger.get(`${p._id}:${s.size}`) ?? 0;
        if (balance !== s.stock)
          mismatches.push({ productId: String(p._id), title: p.title, size: s.size, stock: s.stock, ledger: balance });
      }
    }
    return { ok: mismatches.length === 0, variantsChecked, mismatches };
  }

  private async restock(items: StockItem[], type: 'RELEASE' | 'RETURN', orderId: string, actor: string, note: string, session: Session) {
    const movements: NewMovement[] = [];
    for (const item of items) {
      // A variant deleted since the sale cannot take stock back; nothing is recorded for it.
      if (await this.products.incrementStock(item.productId, item.size, item.qty, session)) {
        movements.push(this.movement(item, type, item.qty, orderId, actor, note));
      }
    }
    await this.movements.append(movements, session);
  }

  private line(i: { productId: unknown; size: string; qty: number }): StockItem {
    return { productId: String(i.productId), size: i.size, qty: i.qty };
  }

  private movement(
    item: StockItem,
    type: NewMovement['type'],
    delta: number,
    orderId: string | undefined,
    actor: string,
    note?: string,
  ): NewMovement {
    return {
      productId: item.productId,
      size: item.size,
      type,
      qty: item.qty,
      delta,
      actor,
      ...(orderId && { orderId }),
      ...(note && { note }),
    };
  }
}
