import { Skeleton } from '@/components/ui/skeleton';

function CardSkeleton({ className }: { className?: string }) {
  return (
    <div className={className}>
      <Skeleton className="aspect-[3/4] w-full" />
      <Skeleton className="mt-1 h-[5.75rem] w-full" />
    </div>
  );
}

/** The catalogue grid while it loads: the same photograph and tag shapes, so nothing moves when it arrives. */
export function ProductGridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div data-testid="product-grid-skeleton" className="grid grid-cols-2 gap-x-4 gap-y-10 lg:grid-cols-3">
      {Array.from({ length: count }).map((_, i) => (
        <CardSkeleton key={i} />
      ))}
    </div>
  );
}

/** The featured row while it loads. */
export function ProductRowSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div data-testid="product-grid-skeleton" className="flex gap-4 overflow-hidden px-4 sm:px-8">
      {Array.from({ length: count }).map((_, i) => (
        <CardSkeleton key={i} className="w-[72vw] shrink-0 sm:w-[40vw] lg:w-[26vw]" />
      ))}
    </div>
  );
}
