import { Types } from 'mongoose';
import type { Session } from '../../core/persistence/transaction';
import { InventoryMovementModel, type InventoryMovementRecord, type MovementType } from './inventory-movement.model';
import { StockReservationModel, type ReservationStatus, type StockReservationRecord } from './stock-reservation.model';

export interface NewMovement {
  productId: string;
  size: string;
  type: MovementType;
  qty: number;
  delta: number;
  orderId?: string;
  actor: string;
  note?: string;
}

export interface LedgerBalance {
  productId: string;
  size: string;
  balance: number;
}

/** Append-only access to the stock ledger: there is deliberately no update or delete. */
export class InventoryMovementRepository {
  async append(movements: NewMovement[], session?: Session): Promise<void> {
    if (!movements.length) return;
    await InventoryMovementModel.insertMany(movements, { session });
  }

  list(filter: { productId?: string; orderId?: string }, limit = 100): Promise<InventoryMovementRecord[]> {
    return InventoryMovementModel.find({
      ...(filter.productId && { productId: new Types.ObjectId(filter.productId) }),
      ...(filter.orderId && { orderId: new Types.ObjectId(filter.orderId) }),
    })
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit)
      .lean<InventoryMovementRecord[]>();
  }

  async balances(): Promise<LedgerBalance[]> {
    const rows = await InventoryMovementModel.aggregate<{ _id: { productId: Types.ObjectId; size: string }; balance: number }>([
      { $group: { _id: { productId: '$productId', size: '$size' }, balance: { $sum: '$delta' } } },
    ]);
    return rows.map(r => ({ productId: String(r._id.productId), size: r._id.size, balance: r.balance }));
  }
}

export class StockReservationRepository {
  async create(
    reservation: { orderId: string; items: Array<{ productId: string; size: string; qty: number }>; expiresAt: Date },
    session: Session,
  ): Promise<void> {
    await StockReservationModel.create([reservation], { session });
  }

  findByOrder(orderId: string, session?: Session): Promise<StockReservationRecord | null> {
    return StockReservationModel.findOne({ orderId })
      .session(session ?? null)
      .lean<StockReservationRecord>();
  }

  /** Compare-and-set on the reservation status; returns the reservation only if this caller won the transition. */
  transition(orderId: string, from: ReservationStatus, to: ReservationStatus, session: Session): Promise<StockReservationRecord | null> {
    return StockReservationModel.findOneAndUpdate(
      { orderId, status: from },
      { $set: { status: to } },
      { session, new: true },
    ).lean<StockReservationRecord>();
  }

  /** Records returned units on a sold reservation; compare-and-set on its status so concurrent returns cannot both apply. */
  async recordReturns(
    orderId: string,
    from: ReservationStatus,
    items: Array<{ productId: string; size: string; qty: number; returnedQty: number }>,
    to: ReservationStatus,
    session: Session,
  ): Promise<boolean> {
    const res = await StockReservationModel.updateOne(
      { orderId, status: from },
      { $set: { status: to, items: items.map(i => ({ ...i, productId: new Types.ObjectId(i.productId) })) } },
      { session },
    );
    return res.modifiedCount === 1;
  }

  async expiredOrderIds(now: Date, limit: number): Promise<string[]> {
    const rows = await StockReservationModel.find({ status: 'active', expiresAt: { $lte: now } }, { orderId: 1 })
      .sort({ expiresAt: 1 })
      .limit(limit)
      .lean<Array<{ orderId: Types.ObjectId }>>();
    return rows.map(r => String(r.orderId));
  }
}
