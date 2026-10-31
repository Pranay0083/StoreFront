import * as React from 'react';
import { cn } from '@/lib/utils';

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      className={cn(
        'flex min-h-[90px] w-full border border-input bg-card px-3.5 py-3 text-base transition-[border-color] duration-150 placeholder:text-muted-foreground focus-visible:border-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-foreground disabled:opacity-50 sm:text-sm',
        className,
      )}
      ref={ref}
      {...props}
    />
  ),
);
Textarea.displayName = 'Textarea';
