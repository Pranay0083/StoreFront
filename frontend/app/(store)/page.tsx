'use client';

import { ArrowRight, RefreshCcw, ShieldCheck, Truck } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ProductCard } from '@/components/product-card';
import { ProductGridSkeleton } from '@/components/skeletons';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import type { Product } from '@/lib/types';

const HERO = 'https://images.unsplash.com/photo-1603189343302-e603f7add05a?w=1400&q=85&auto=format&fit=crop';
const EDITORIAL = 'https://images.unsplash.com/photo-1664076458686-3449062080ac?w=1200&q=85&auto=format&fit=crop';
const FLAT = 'https://images.unsplash.com/photo-1632469188022-b5db09a70fbc?w=800&q=80&auto=format&fit=crop';

const CATEGORIES = [
  { name: 'Men', image: 'https://images.unsplash.com/photo-1611312449408-fcece27cdbb7?w=700&q=80&auto=format&fit=crop' },
  { name: 'Women', image: 'https://images.unsplash.com/photo-1515372039744-b8f02a3ae446?w=700&q=80&auto=format&fit=crop' },
  { name: 'Footwear', image: 'https://images.unsplash.com/photo-1595950653106-6c9ebd614d3a?w=700&q=80&auto=format&fit=crop' },
  { name: 'Accessories', image: 'https://images.unsplash.com/photo-1591561954557-26941169b49e?w=700&q=80&auto=format&fit=crop' },
];

const MARQUEE = 'FREE SHIPPING OVER ₹2,999 — 30-DAY EASY RETURNS — NEW SEASON DROP — SECURE CHECKOUT — ';

export default function HomePage() {
  const [featured, setFeatured] = useState<Product[] | null>(null);

  useEffect(() => {
    api<{ items: Product[] }>('/products?featured=true&limit=8')
      .then(d => setFeatured(d.items))
      .catch(() => setFeatured([]));
  }, []);

  return (
    <div data-testid="home-page">
      <section className="mx-auto max-w-7xl px-5 pt-8 sm:px-8 sm:pt-12">
        <div className="grid gap-6 lg:grid-cols-12">
          <div className="relative order-2 aspect-[4/5] max-h-[80vh] w-full overflow-hidden lg:order-1 lg:col-span-7 lg:aspect-auto lg:min-h-[620px]">
            <Image src={HERO} alt="AW/26 editorial" fill priority sizes="(max-width:1024px) 100vw, 58vw" className="object-cover object-top" />
            <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent" />
            <p className="absolute bottom-6 left-6 label-caps text-white">AW / 26 — The Considered Wardrobe</p>
          </div>

          <div className="order-1 flex flex-col justify-between gap-10 lg:order-2 lg:col-span-5 lg:pl-6">
            <div className="animate-fade-up">
              <p className="label-caps text-muted-foreground">New season, no noise</p>
              <h1 className="mt-5 font-serif text-5xl font-semibold leading-none tracking-tighter sm:text-6xl">
                Dress like
                <br />
                it matters.
              </h1>
              <p className="mt-6 max-w-md text-base leading-relaxed text-muted-foreground">
                Twenty-four pieces. Four categories. Zero filler. Cut from cloth that earns its
                keep and shipped through a state machine that never loses an order.
              </p>
              <div className="mt-9 flex flex-wrap gap-4">
                <Button asChild size="lg" data-testid="hero-shop-button">
                  <Link href="/products">
                    Shop the collection <ArrowRight className="h-4 w-4" />
                  </Link>
                </Button>
                <Button asChild variant="outline" size="lg" data-testid="hero-accessories-button">
                  <Link href="/products?category=Accessories">Accessories</Link>
                </Button>
              </div>
            </div>

            <div className="relative hidden aspect-[16/9] overflow-hidden lg:block animate-fade-up" style={{ animationDelay: '150ms' }}>
              <Image src={FLAT} alt="Flat lay" fill sizes="40vw" className="object-cover" />
            </div>
          </div>
        </div>
      </section>

      <div className="mt-16 overflow-hidden border-y border-black/10 bg-black py-3 text-white">
        <div className="flex w-max animate-marquee whitespace-nowrap">
          <span className="label-caps">{MARQUEE.repeat(3)}</span>
          <span className="label-caps">{MARQUEE.repeat(3)}</span>
        </div>
      </div>

      <section className="mx-auto max-w-7xl px-5 py-20 sm:px-8">
        <div className="mb-10 flex items-end justify-between">
          <div>
            <p className="label-caps text-muted-foreground">Curated</p>
            <h2 className="mt-2 font-serif text-3xl font-semibold tracking-tight sm:text-4xl">Featured pieces</h2>
          </div>
          <Link href="/products" data-testid="featured-view-all" className="label-caps hidden items-center gap-2 hover:underline sm:flex">
            View all <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
        {featured === null ? (
          <ProductGridSkeleton count={8} />
        ) : (
          <div data-testid="featured-grid" className="grid grid-cols-2 gap-8 lg:grid-cols-4">
            {featured.map((p, i) => (
              <ProductCard key={p._id} product={p} index={i} />
            ))}
          </div>
        )}
      </section>

      <section className="mx-auto max-w-7xl px-5 pb-20 sm:px-8">
        <div className="grid items-center gap-10 bg-white p-8 sm:p-14 lg:grid-cols-2 border border-black/5">
          <div>
            <p className="label-caps text-muted-foreground">The Women&apos;s edit</p>
            <h2 className="mt-4 font-serif text-3xl font-semibold tracking-tight sm:text-4xl">
              Silk, wool, and<br />nothing you&apos;ll regret.
            </h2>
            <p className="mt-5 max-w-md text-base leading-relaxed text-muted-foreground">
              Bias-cut slips, double-faced coats and knitwear graded by hand. Every piece is
              stocked shallow on purpose — when it&apos;s gone, it&apos;s gone.
            </p>
            <Button asChild className="mt-8" data-testid="editorial-shop-women">
              <Link href="/products?category=Women">Shop Women</Link>
            </Button>
          </div>
          <div className="relative aspect-[4/5] max-h-[80vh] overflow-hidden">
            <Image src={EDITORIAL} alt="Women's edit" fill sizes="(max-width:1024px) 100vw, 50vw" className="object-cover" />
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-5 pb-20 sm:px-8">
        <h2 className="mb-8 font-serif text-3xl font-semibold tracking-tight sm:text-4xl">Shop by category</h2>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {CATEGORIES.map((c, i) => (
            <Link
              key={c.name}
              href={`/products?category=${c.name}`}
              data-testid={`category-tile-${c.name.toLowerCase()}`}
              className="group relative aspect-[3/4] overflow-hidden animate-fade-up"
              style={{ animationDelay: `${i * 80}ms` }}
            >
              <Image src={c.image} alt={c.name} fill sizes="(max-width:1024px) 50vw, 25vw" className="object-cover transition-transform duration-500 group-hover:scale-[1.05]" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
              <p className="absolute bottom-5 left-5 font-serif text-2xl font-semibold text-white">{c.name}</p>
            </Link>
          ))}
        </div>
      </section>

      <section className="border-t border-black/10 bg-white">
        <div className="mx-auto grid max-w-7xl gap-10 px-5 py-16 sm:grid-cols-3 sm:px-8">
          {[
            { icon: Truck, title: 'Tracked fulfilment', text: 'Every order moves through an audited state machine — created to delivered.' },
            { icon: ShieldCheck, title: 'Secure payments', text: 'Razorpay checkout with idempotent, signature-verified confirmation.' },
            { icon: RefreshCcw, title: '30-day returns', text: 'Cancel before shipping in one click. Refunds tracked in your order audit trail.' },
          ].map(f => (
            <div key={f.title} className="flex gap-4">
              <f.icon className="h-6 w-6 shrink-0" strokeWidth={1.25} />
              <div>
                <p className="font-medium">{f.title}</p>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{f.text}</p>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
