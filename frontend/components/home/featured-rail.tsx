'use client';

import { ArrowLeft, ArrowRight } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { ProductCard, type CardProduct } from '@/components/product-card';
import type { OfferBadge } from '@storefront/contracts';

const arrow =
  'flex h-11 w-11 items-center justify-center bg-secondary transition-[background-color,transform,opacity] duration-150 ease-out hover:bg-accent active:scale-[0.97] disabled:opacity-40';

/**
 * A row of large photographs that runs off the right edge: dragged or swiped on touch,
 * stepped with the two buttons on a desktop, and every card is a link the keyboard reaches.
 */
export function FeaturedRail({
  products,
  heading,
  badges = {},
}: {
  products: CardProduct[];
  heading: React.ReactNode;
  /** Offer lines by product id, built once from the offers read model. */
  badges?: Record<string, OfferBadge>;
}) {
  const track = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: true, end: false });

  useEffect(() => {
    const el = track.current;
    if (!el) return;
    const measure = () => setEdges({ start: el.scrollLeft < 8, end: el.scrollLeft + el.clientWidth > el.scrollWidth - 8 });
    measure();
    el.addEventListener('scroll', measure, { passive: true });
    window.addEventListener('resize', measure);
    return () => {
      el.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
    };
  }, []);

  const step = (dir: 1 | -1) => {
    const el = track.current;
    if (!el) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollBy({ left: dir * el.clientWidth * 0.75, behavior: reduce ? 'auto' : 'smooth' });
  };

  return (
    <div>
      <div className="mx-auto flex max-w-[1760px] items-end justify-between gap-6 px-4 sm:px-8">
        <div>{heading}</div>
        <div className="hidden shrink-0 gap-2 sm:flex">
          <button type="button" className={arrow} onClick={() => step(-1)} disabled={edges.start} aria-label="Previous pieces">
            <ArrowLeft className="h-5 w-5" aria-hidden />
          </button>
          <button type="button" className={arrow} onClick={() => step(1)} disabled={edges.end} aria-label="Next pieces">
            <ArrowRight className="h-5 w-5" aria-hidden />
          </button>
        </div>
      </div>
      <div
        ref={track}
        data-testid="featured-grid"
        className="relative mt-6 flex snap-x snap-mandatory scroll-px-4 gap-4 overflow-x-auto px-4 pb-4 [scrollbar-width:none] sm:scroll-px-8 sm:px-8 [&::-webkit-scrollbar]:hidden"
      >
        {products.map(p => (
          <ProductCard
            key={p._id}
            product={p}
            badge={badges[p._id]}
            sizes="(max-width: 640px) 72vw, (max-width: 1024px) 40vw, 26vw"
            className="w-[72vw] shrink-0 snap-start sm:w-[40vw] lg:w-[26vw] 2xl:w-[22vw]"
          />
        ))}
      </div>
    </div>
  );
}
