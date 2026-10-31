import { cn } from '@/lib/utils';

export const Skeleton = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('animate-pulse bg-foreground/[0.07]', className)} {...props} />
);
