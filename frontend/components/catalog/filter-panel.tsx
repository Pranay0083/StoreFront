'use client';

import { useId, useState } from 'react';
import { cn } from '@/lib/utils';

/** Filters sit beside the grid on a desktop and fold behind one button on a phone, so the photographs come first. */
export function FilterPanel({ active, children }: { active: number; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(o => !o)}
        className="flex h-11 w-full items-center justify-between bg-secondary px-4 text-base font-semibold transition-transform duration-150 ease-out active:scale-[0.98] lg:hidden"
      >
        <span>Filters{active > 0 ? ` (${active})` : ''}</span>
        <span aria-hidden>{open ? 'Hide' : 'Show'}</span>
      </button>
      <aside id={id} aria-label="Filters" className={cn('space-y-10 pt-8 lg:block lg:pt-0', open ? 'block' : 'hidden')}>
        {children}
      </aside>
    </div>
  );
}
