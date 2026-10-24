import { QueryClient } from '@tanstack/react-query';
import { ApiError } from '@/lib/api';

export const queryKeys = {
  cart: ['cart'] as const,
  orders: ['orders'] as const,
  order: (id: string) => ['orders', id] as const,
  reviews: (productId: string) => ['reviews', productId] as const,
  adminOrders: (params: Record<string, string>) => ['admin', 'orders', params] as const,
  adminOrdersAll: ['admin', 'orders'] as const,
  adminProducts: ['admin', 'products'] as const,
  adminStats: ['admin', 'stats'] as const,
  suggest: (q: string) => ['suggest', q] as const,
  products: (params: string) => ['products', params] as const,
};

/** Client errors (4xx) are final; network failures and 5xx get two more tries with backoff. */
export const shouldRetry = (failureCount: number, error: unknown) =>
  failureCount < 2 && !(error instanceof ApiError && error.status >= 400 && error.status < 500);

export function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { staleTime: 30_000, retry: shouldRetry, refetchOnWindowFocus: false },
      mutations: { retry: shouldRetry },
    },
  });
}
