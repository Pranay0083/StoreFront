import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';
import { cn } from '@/lib/utils';

const badgeVariants = cva('inline-flex flex-none items-center gap-1 whitespace-nowrap px-2 py-0.5 text-xs font-medium', {
  variants: {
    variant: {
      default: 'bg-primary text-primary-foreground',
      secondary: 'bg-secondary text-secondary-foreground',
      outline: 'bg-card text-foreground',
      // Status pills: a pale tint with dark text of the same hue.
      destructive: 'bg-[#ffedea] text-[#831c1e]',
      success: 'bg-[#dcfae5] text-[#04250e]',
      warning: 'bg-[#fff4d6] text-[#7a3b06]',
    },
  },
  defaultVariants: { variant: 'default' },
});

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

export const Badge = ({ className, variant, ...props }: BadgeProps) => (
  <div className={cn(badgeVariants({ variant }), className)} {...props} />
);
