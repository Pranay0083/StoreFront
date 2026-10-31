'use client';

import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

type State = 'static' | 'waiting' | 'in';

/**
 * One entrance for a part of a section, once, as it scrolls into view: it rises 20px and fades in.
 * The server renders it visible, and only parts still below the fold are hidden after hydration,
 * so nothing stays hidden without JavaScript, and nothing already on screen blinks.
 * Stagger the parts of one section with `delay` (heading 0, text 80, picture 160).
 */
export function Reveal({ delay = 0, className, children }: { delay?: number; className?: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<State>('static');

  useEffect(() => {
    const el = ref.current;
    if (!el || !('IntersectionObserver' in window)) return;
    // Reduced motion gets the finished page: nothing waits to arrive.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (el.getBoundingClientRect().top < window.innerHeight * 0.92) return;
    setState('waiting');
    const io = new IntersectionObserver(
      entries => {
        if (entries.some(e => e.isIntersecting)) {
          setState('in');
          io.disconnect();
        }
      },
      { rootMargin: '0px 0px -8% 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      data-reveal={state}
      style={state === 'in' ? { transitionDelay: `${delay}ms` } : undefined}
      className={cn(
        'transition-[opacity,transform] duration-700 ease-out data-[reveal=waiting]:translate-y-5 data-[reveal=waiting]:opacity-0',
        className,
      )}
    >
      {children}
    </div>
  );
}
