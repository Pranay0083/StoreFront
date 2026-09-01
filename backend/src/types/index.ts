export const ORDER_STATUSES = ['created', 'paid', 'packed', 'shipped', 'delivered', 'cancelled', 'refunded'] as const;
export type OrderStatus = typeof ORDER_STATUSES[number];

export interface CustomRequest extends Express.Request {
  user?: any;
}
