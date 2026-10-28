import { Skeleton } from '@/components/ui/skeleton';

/** The product page's own shape while it loads: the photograph on the left, the paper slip on the right. */
export default function ProductLoading() {
  return (
    <div className="mx-auto max-w-[1760px] px-4 pb-8 pt-6 sm:px-8" aria-busy="true" aria-label="Loading product">
      <Skeleton className="mb-6 h-6 w-56" />
      <div className="grid grid-cols-1 gap-10 lg:grid-cols-12 lg:gap-8">
        <Skeleton className="aspect-[4/5] w-full lg:col-span-7" />
        <div className="edge-perforated h-fit space-y-5 bg-card px-6 pb-10 pt-11 sm:px-10 lg:col-span-5">
          <Skeleton className="h-12 w-3/4" />
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-28 w-full" />
          <div className="flex gap-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-14" />
            ))}
          </div>
          <Skeleton className="h-14 w-full" />
        </div>
      </div>
    </div>
  );
}
