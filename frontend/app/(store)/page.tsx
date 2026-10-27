import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { connection } from 'next/server';
import { Suspense } from 'react';
import { FeaturedRail } from '@/components/home/featured-rail';
import { LookSection, LookSkeleton } from '@/components/home/look-section';
import { JsonLd } from '@/components/json-ld';
import { Reveal } from '@/components/reveal';
import { ProductRowSkeleton } from '@/components/skeletons';
import { Button } from '@/components/ui/button';
import { fmtINR } from '@/lib/api';
import { serverApi } from '@/lib/server-api';
import { SITE_NAME, SITE_URL, absoluteUrl } from '@/lib/site';
import { FREE_SHIPPING_THRESHOLD } from '@storefront/contracts';

/** Editorial photographs (Unsplash), never a product's own photograph, so no picture stands for two things. */
const HERO = 'https://images.unsplash.com/photo-1525507119028-ed4c629a60a3?w=1600&q=80&auto=format&fit=crop';
const RAIL = 'https://images.unsplash.com/photo-1490481651871-ab68de25d43d?w=1200&q=80&auto=format&fit=crop';

const DEPARTMENTS = [
  { name: 'Men', note: 'Oxford and linen shirts, selvedge denim, merino and an unstructured blazer.' },
  { name: 'Women', note: 'A silk slip, wide-leg trousers, cashmere and a double-faced wool coat.' },
  { name: 'Footwear', note: 'Court sneakers, Chelsea boots, canvas high-tops and suede loafers.' },
  { name: 'Accessories', note: 'A leather tote, a silk scarf, belts, a beanie, a watch and a backpack.' },
];

/** Hooks kept from the earlier home page, now on the department rows that do the same job. */
const ROW_TEST_IDS: Record<string, string> = { Women: 'editorial-shop-women', Accessories: 'hero-accessories-button' };

export const metadata: Metadata = {
  title: 'STOREFRONT — Clothes at the lowest total',
  description:
    'Twenty-four pieces of menswear, womenswear, footwear and accessories. Whatever you put in your bag, a pricing optimizer finds the cheapest mix of offers.',
  alternates: { canonical: absoluteUrl('/') },
  openGraph: {
    type: 'website',
    url: absoluteUrl('/'),
    siteName: SITE_NAME,
    images: [{ url: HERO, width: 1600, alt: 'A summer outfit laid out flat: a white shirt, rolled jeans, a striped top and red sandals' }],
  },
};

function FeaturedHeading() {
  return (
    <>
      <h2 id="featured-heading" className="text-display-md font-extrabold">
        Where to start
      </h2>
      <p className="mt-4 max-w-[60ch] text-lg">
        Eight pieces the rest of the wardrobe is built around.{' '}
        <Link href="/products" data-testid="featured-view-all" className="font-semibold underline underline-offset-4">
          See every piece
        </Link>
      </p>
    </>
  );
}

async function Featured() {
  await connection();
  const featured = await serverApi
    .featured()
    .then(d => d.items)
    .catch(() => []);
  if (!featured.length) {
    return (
      <div className="mx-auto max-w-[1760px] px-4 sm:px-8">
        <FeaturedHeading />
        <p className="mt-6 text-lg">The featured pieces are being restocked; the full collection is one click away.</p>
      </div>
    );
  }
  return <FeaturedRail products={featured} heading={<FeaturedHeading />} />;
}

function DepartmentRows({ counts }: { counts?: Map<string, number> }) {
  return (
    <ul className="mt-8">
      {DEPARTMENTS.map(d => (
        <li key={d.name} data-testid={ROW_TEST_IDS[d.name]}>
          <Link
            href={`/products?category=${d.name}`}
            data-testid={`category-tile-${d.name.toLowerCase()}`}
            className="group -mx-4 grid gap-x-8 gap-y-2 px-4 py-5 transition-[background-color] duration-150 hover:bg-secondary sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] sm:items-baseline sm:py-6"
          >
            <span className="text-display-md font-extrabold">{d.name}</span>
            <span className="text-lg">
              {d.note}
              {counts?.has(d.name) && (
                <span className="block text-base text-muted-foreground">
                  {counts.get(d.name)} piece{counts.get(d.name) === 1 ? '' : 's'}
                </span>
              )}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

async function Departments() {
  const categories = await serverApi.categories().catch(() => []);
  return <DepartmentRows counts={new Map(categories.map(c => [c.name, c.count]))} />;
}

export default function HomePage() {
  return (
    <div data-testid="home-page">
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'WebSite',
          name: SITE_NAME,
          url: SITE_URL,
          potentialAction: {
            '@type': 'SearchAction',
            target: `${SITE_URL}/products?q={search_term_string}`,
            'query-input': 'required name=search_term_string',
          },
        }}
      />

      <section className="mx-auto max-w-[1760px] px-4 sm:px-8">
        <div className="grid gap-10 pt-8 lg:min-h-[calc(100svh-4rem)] lg:grid-cols-12 lg:gap-8 lg:pb-8 lg:pt-6">
          <div className="flex min-w-0 flex-col justify-between gap-8 lg:col-span-6 lg:pb-2 lg:pt-4">
            <p className="hidden max-w-[36ch] animate-rise text-base lg:block">
              Free delivery on orders over {fmtINR(FREE_SHIPPING_THRESHOLD)}, and you can cancel any order until the moment it ships.
            </p>
            <div>
              <h1 className="max-w-[12ch] animate-rise text-balance text-[clamp(2.75rem,7vw,8.5rem)] font-extrabold leading-[0.88] tracking-[-0.055em]">
                Clothes at the lowest total
              </h1>
              <p className="mt-8 max-w-[42ch] animate-rise text-lg [animation-delay:80ms] sm:mt-10 sm:text-xl">
                Twenty-four pieces across four departments. Whatever you put in your bag, our optimizer finds the cheapest mix of offers.
              </p>
              <div className="mt-8 flex animate-rise flex-wrap items-center gap-x-8 gap-y-4 [animation-delay:160ms]">
                <Button asChild size="lg" data-testid="hero-shop-button">
                  <Link href="/products">Shop the collection</Link>
                </Button>
                <Link href="#build-a-look" className="text-base font-semibold underline underline-offset-4">
                  Build a look
                </Link>
              </div>
            </div>
          </div>
          <div className="relative aspect-[4/5] overflow-hidden bg-secondary sm:aspect-[4/3] lg:col-span-6 lg:aspect-auto">
            <Image
              src={HERO}
              alt="A summer outfit laid out flat: a white shirt, rolled jeans, a striped top and red sandals"
              fill
              priority
              sizes="(max-width: 1024px) 100vw, 50vw"
              className="object-cover duration-1000 ease-out animate-in zoom-in-[1.04]"
            />
          </div>
        </div>
      </section>

      <section
        id="build-a-look"
        aria-labelledby="look-heading"
        className="mt-24 scroll-mt-16 bg-primary text-primary-foreground sm:mt-32 [&_:focus-visible]:outline-card"
      >
        <div className="mx-auto max-w-[1760px] px-4 py-20 sm:px-8 sm:py-28">
          <div className="mb-12 grid gap-6 lg:mb-16 lg:grid-cols-12 lg:items-end lg:gap-8">
            <Reveal className="lg:col-span-7">
              <h2 id="look-heading" className="text-display-lg font-extrabold">
                Build a look
              </h2>
            </Reveal>
            <Reveal delay={80} className="lg:col-span-5">
              <p className="max-w-[44ch] text-lg">
                Tap the pieces you would wear together. The receipt is priced live by the optimizer that prices every bag, so the bundles it
                finds are the ones you get.
              </p>
            </Reveal>
          </div>
          <Reveal delay={160}>
            <Suspense fallback={<LookSkeleton />}>
              <LookSection />
            </Suspense>
          </Reveal>
        </div>
      </section>

      <section aria-labelledby="featured-heading" className="mt-28 sm:mt-40">
        <Reveal>
          <Suspense
            fallback={
              <>
                <div className="mx-auto max-w-[1760px] px-4 sm:px-8">
                  <FeaturedHeading />
                </div>
                <div className="mt-[68px]">
                  <ProductRowSkeleton />
                </div>
              </>
            }
          >
            <Featured />
          </Suspense>
        </Reveal>
      </section>

      <section aria-labelledby="departments-heading" className="mx-auto mt-28 max-w-[1760px] px-4 sm:mt-40 sm:px-8">
        <div className="grid gap-12 lg:grid-cols-12 lg:gap-8">
          <div className="lg:col-span-7">
            <Reveal>
              <h2 id="departments-heading" className="text-display-md font-extrabold">
                Shop by department
              </h2>
            </Reveal>
            <Reveal delay={80}>
              <Suspense fallback={<DepartmentRows />}>
                <Departments />
              </Suspense>
            </Reveal>
          </div>
          <Reveal delay={160} className="lg:col-span-5">
            <div className="relative aspect-[4/5] overflow-hidden bg-secondary sm:aspect-[3/2] lg:aspect-[4/5]">
              <Image
                src={RAIL}
                alt="A rail of shirts and blouses in white, cream and brown on wooden hangers"
                fill
                sizes="(max-width: 1024px) 100vw, 40vw"
                className="object-cover"
              />
            </div>
          </Reveal>
        </div>
      </section>
    </div>
  );
}
