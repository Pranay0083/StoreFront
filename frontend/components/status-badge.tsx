import { Badge } from '@/components/ui/badge';
import type { OrderStatus } from '@storefront/contracts';

const VARIANTS: Record<OrderStatus, 'secondary' | 'default' | 'success' | 'warning' | 'destructive' | 'outline'> = {
  created: 'outline',
  paid: 'default',
  packed: 'warning',
  shipped: 'warning',
  delivered: 'success',
  cancelled: 'destructive',
  refund_requested: 'warning',
  refunded: 'destructive',
};

export function StatusBadge({ status, testId }: { status: OrderStatus; testId?: string }) {
  return (
    <Badge variant={VARIANTS[status] || 'secondary'} data-testid={testId || `status-badge-${status}`}>
      {status.replace('_', ' ')}
    </Badge>
  );
}
