import { OrderModel } from '../orders/order.model';

/** Port: decides whether a user may review a product. */
export interface PurchaseVerifier {
  hasReceived(userId: string, productId: string): Promise<boolean>;
}

/** Read-only adapter over the orders collection: a delivered order that contains the product. */
export class DeliveredOrderPurchaseVerifier implements PurchaseVerifier {
  async hasReceived(userId: string, productId: string): Promise<boolean> {
    return (await OrderModel.exists({ userId, status: 'delivered', 'items.productId': productId })) !== null;
  }
}
