'use client';

import { Minus, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';

const PRESS =
  'flex touch-manipulation select-none items-center justify-center transition-[transform,background-color] duration-150 ease-out hover:bg-accent active:scale-[0.97] active:bg-accent disabled:pointer-events-none disabled:opacity-35';

/**
 * A quantity stepper on a tone step, not an outlined box. Each half is a 44px target on touch screens
 * and presses down on pointer-down, so a tap is answered before the finger lifts.
 */
export function QtyStepper({
  value,
  onDecrease,
  onIncrease,
  canDecrease = true,
  canIncrease = true,
  decreaseLabel,
  increaseLabel,
  dense = false,
  testIds,
}: {
  value: number;
  onDecrease: () => void;
  onIncrease: () => void;
  canDecrease?: boolean;
  canIncrease?: boolean;
  decreaseLabel: string;
  increaseLabel: string;
  dense?: boolean;
  testIds?: { decrease?: string; increase?: string; value?: string };
}) {
  const size = dense ? 'h-11 w-11 sm:h-9 sm:w-9' : 'h-11 w-11';
  return (
    <div className="inline-flex items-center bg-secondary">
      <button
        type="button"
        data-testid={testIds?.decrease}
        aria-label={decreaseLabel}
        onClick={onDecrease}
        disabled={!canDecrease}
        className={cn(PRESS, size)}
      >
        <Minus className="h-3.5 w-3.5" aria-hidden />
      </button>
      <span data-testid={testIds?.value} className="min-w-8 text-center text-[15px] font-medium" aria-live="polite">
        {value}
      </span>
      <button
        type="button"
        data-testid={testIds?.increase}
        aria-label={increaseLabel}
        onClick={onIncrease}
        disabled={!canIncrease}
        className={cn(PRESS, size)}
      >
        <Plus className="h-3.5 w-3.5" aria-hidden />
      </button>
    </div>
  );
}
