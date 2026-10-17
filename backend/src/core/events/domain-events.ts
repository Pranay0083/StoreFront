import { randomUUID } from 'node:crypto';
import type { OrderRefundLine, OrderStatus, Paise, RefundKind } from '@storefront/contracts';

export interface StockLine {
  productId: string;
  size: string;
  qty: number;
}

export interface DomainEventMap {
  OrderPlaced: { orderId: string; orderNumber: string; userId: string; total: Paise; items: StockLine[]; promotionIds?: string[] };
  OrderPaid: {
    orderId: string;
    orderNumber: string;
    userId: string;
    total: Paise;
    provider: string;
    paymentId?: string;
    items: StockLine[];
  };
  OrderShipped: { orderId: string; orderNumber: string; userId: string; by: string; note?: string };
  OrderDelivered: { orderId: string; orderNumber: string; userId: string; by: string };
  OrderCancelled: { orderId: string; orderNumber: string; userId: string; reason: string; by: string };
  RefundRequested: {
    orderId: string;
    orderNumber: string;
    userId: string;
    refundId: string;
    kind: RefundKind;
    amount: Paise;
    lines: OrderRefundLine[];
    reason: string;
    by: string;
    previousStatus: OrderStatus;
  };
  RefundCompleted: {
    orderId: string;
    orderNumber: string;
    userId: string;
    refundId: string;
    amount: Paise;
    lines: OrderRefundLine[];
    /** True once every unit of the order has been refunded. */
    fullyRefunded: boolean;
    gatewayRefundId?: string;
  };
  RefundFailed: {
    orderId: string;
    orderNumber: string;
    userId: string;
    refundId: string;
    amount: Paise;
    reason: string;
    restoredStatus: OrderStatus;
  };
  ProductChanged: { productId: string; change: 'created' | 'updated' | 'deleted' };
  StockLow: { productId: string; size: string; stock: number; threshold: number };
}

export type DomainEventName = keyof DomainEventMap;

export interface DomainEvent<N extends DomainEventName = DomainEventName> {
  id: string;
  name: N;
  aggregateId: string;
  occurredAt: Date;
  payload: DomainEventMap[N];
}

export type AnyDomainEvent = { [N in DomainEventName]: DomainEvent<N> }[DomainEventName];

export function domainEvent<N extends DomainEventName>(
  name: N,
  aggregateId: string,
  payload: DomainEventMap[N],
  id: string = randomUUID(),
): DomainEvent<N> {
  return { id, name, aggregateId, occurredAt: new Date(), payload };
}
