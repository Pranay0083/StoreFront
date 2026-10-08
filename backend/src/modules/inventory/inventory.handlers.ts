import type { Logger } from 'pino';
import { domainEvent } from '../../core/events/domain-events';
import type { EventBus } from '../../core/events/event-bus';
import type { OutboxStore } from '../../core/events/outbox.store';
import type { ProductRepository } from '../catalog/product.repository';

export interface InventoryHandlerDeps {
  products: ProductRepository;
  outbox: OutboxStore;
  logger: Logger;
  lowStockThreshold: number;
}

export function registerInventoryHandlers(bus: EventBus, deps: InventoryHandlerDeps): void {
  bus.subscribe('OrderPaid', 'inventory.detect-low-stock', async event => {
    const low = [];
    for (const line of event.payload.items) {
      const product = await deps.products.findStockLevels(line.productId);
      const stock = product?.sizes.find(s => s.size === line.size)?.stock;
      if (stock !== undefined && stock < deps.lowStockThreshold) {
        // Deterministic id: a retried delivery re-publishes the same fact instead of a duplicate alert.
        low.push(
          domainEvent(
            'StockLow',
            line.productId,
            { productId: line.productId, size: line.size, stock, threshold: deps.lowStockThreshold },
            `stock-low:${event.id}:${line.productId}:${line.size}`,
          ),
        );
      }
    }
    await deps.outbox.append(low);
  });

  bus.subscribe('StockLow', 'inventory.alert-low-stock', async event => {
    deps.logger.warn(event.payload, 'Stock below threshold');
  });
}
