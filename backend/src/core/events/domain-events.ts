import { randomUUID } from 'node:crypto';
import type { OrderStatus, Paise } from '@storefront/contracts';

export interface StockLine {
  productId: string;
  size: string;
  qty: number;
}

export interface DomainEventMap {
  OrderPlaced: { orderId: string; orderNumber: string; userId: string; total: Paise; items: StockLine[]; couponCode?: string };
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
  OrderCancelled: { orderId: string; orderNumber: string; userId: string; reason: string; by: string; couponCode?: string };
  RefundRequested: {
    orderId: string;
    orderNumber: string;
    userId: string;
    amount: Paise;
    reason: string;
    by: string;
    previousStatus: OrderStatus;
  };
  RefundCompleted: { orderId: string; orderNumber: string; userId: string; amount: Paise; gatewayRefundId?: string };
  RefundFailed: { orderId: string; orderNumber: string; userId: string; amount: Paise; reason: string; restoredStatus: OrderStatus };
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
