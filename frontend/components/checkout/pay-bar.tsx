'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * The pay action, pinned to the bottom of a phone screen until its place under the receipt scrolls
 * into view, where it docks. The slot keeps the bar's height, so docking never moves the page.
 * From the `lg` breakpoint it is always in place under the receipt.
 */
export function PayBar({ children, className }: { children: ReactNode; className?: string }) {
  const slot = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const dockedRef = useRef(true);
  const [docked, setDocked] = useState(true);
  const [height, setHeight] = useState<number>();

  useEffect(() => {
    const slotEl = slot.current;
    const barEl = bar.current;
    if (!slotEl || !barEl) return;
    const resize = new ResizeObserver(() => {
      if (dockedRef.current) setHeight(barEl.offsetHeight);
    });
    resize.observe(barEl);
    const intersect = new IntersectionObserver(
      ([entry]) => {
        // Docked once its place is fully on screen, and still docked after scrolling past it.
        const next = entry.intersectionRatio > 0.98 || entry.boundingClientRect.top < 0;
        dockedRef.current = next;
        setDocked(next);
      },
      { threshold: [0, 0.98, 1] },
    );
    intersect.observe(slotEl);
    return () => {
      resize.disconnect();
      intersect.disconnect();
    };
  }, []);

  return (
    <div ref={slot} style={{ height }} className="lg:!h-auto">
      <div
        ref={bar}
        className={cn(
          docked
            ? 'relative'
            : 'fixed inset-x-0 bottom-0 z-30 bg-card px-5 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] pt-3 shadow-[0_-12px_32px_-16px_rgba(24,23,21,0.35)]',
          'lg:static lg:bg-transparent lg:p-0 lg:shadow-none',
          className,
        )}
      >
        {children}
      </div>
    </div>
  );
}
