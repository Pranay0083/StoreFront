import type { UserRepository } from '../../auth/user.repository';
import type { CatalogService } from '../../catalog/catalog.service';
import type { OrderRepository } from '../../orders/order.repository';
import type { PricingService } from '../../pricing/pricing.service';
import type { ReviewRepository } from '../../reviews/review.repository';
import type { PendingActionService } from '../actions/pending-action.service';
import { AddToCartTool, CancelOrderTool, RequestRefundTool } from './action.tools';
import { GetProductDetailsTool, ListCategoriesTool, SearchProductsTool } from './catalog.tools';
import { GetMyOrdersTool, GetOrderStatusTool } from './order.tools';
import { GetBestPriceTool, SuggestBundlesTool } from './pricing.tools';
import { GetStoreInfoTool } from './store.tools';
import { ToolRegistry } from './tool-registry';

export interface ToolDependencies {
  catalog: CatalogService;
  reviews: ReviewRepository;
  orders: OrderRepository;
  users: UserRepository;
  pricing: PricingService;
  actions: PendingActionService;
}

export function buildToolRegistry(d: ToolDependencies): ToolRegistry {
  return new ToolRegistry().register(
    new SearchProductsTool(d.catalog),
    new GetProductDetailsTool(d.catalog, d.reviews),
    new ListCategoriesTool(d.catalog),
    new GetOrderStatusTool(d.orders, d.users),
    new GetMyOrdersTool(d.orders),
    new GetStoreInfoTool(),
    new GetBestPriceTool(d.pricing, d.catalog),
    new SuggestBundlesTool(d.pricing, d.catalog),
    new AddToCartTool(d.catalog, d.actions),
    new CancelOrderTool(d.orders, d.actions),
    new RequestRefundTool(d.orders, d.actions),
  );
}

export { ToolRegistry } from './tool-registry';
export type { AgentTool, ToolContext } from './agent-tool';
