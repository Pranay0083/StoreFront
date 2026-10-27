import { Star } from 'lucide-react';
import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { JsonLd } from '@/components/json-ld';
import { BundleOffers } from '@/components/product/bundle-offers';
import { ProductGallery } from '@/components/product/product-gallery';
import { PurchasePanel } from '@/components/product/purchase-panel';
import { ReviewsSection } from '@/components/product/reviews-section';
import { Reveal } from '@/components/reveal';
import { fmtINR } from '@/lib/api';
import { serverApi, type Recommendation } from '@/lib/server-api';
import { SITE_NAME, absoluteUrl } from '@/lib/site';
import { FREE_SHIPPING_THRESHOLD, type BundleOffer, type Product, type Review } from '@storefront/contracts';

export const revalidate = 300;
export const dynamicParams = true;

/** Pages are rendered on first request and then served from the ISR cache until revalidated. */
export function generateStaticParams() {
  return [];
}

type Props = { params: Promise<{ slug: string }> };

const paiseToDecimal = (paise: number) => (paise / 100).toFixed(2);

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const product = await serverApi.product(slug);
  if (!product) return { title: 'Not found — STOREFRONT' };
  const url = absoluteUrl(`/products/${product.slug}`);
  const description = product.description.slice(0, 160) || `${product.title} — ${product.category} at ${SITE_NAME}.`;
  return {
    title: `${product.title} — ${SITE_NAME}`,
    description,
    alternates: { canonical: url },
    openGraph: {
      type: 'website',
      url,
      siteName: SITE_NAME,
      title: product.title,
      description,
      images: product.images.slice(0, 4).map(src => ({ url: src, alt: product.title })),
    },
    twitter: { card: 'summary_large_image', title: product.title, description, images: product.images.slice(0, 1) },
  };
}

function productJsonLd(product: Product, reviews: Review[]) {
  const url = absoluteUrl(`/products/${product.slug}`);
  const inStock = product.sizes.some(s => s.stock > 0);
  return [
    {
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: product.title,
      description: product.description,
      image: product.images,
      sku: product.slug,
      category: product.category,
      brand: { '@type': 'Brand', name: SITE_NAME },
      offers: {
        '@type': 'Offer',
        url,
        priceCurrency: 'INR',
        price: paiseToDecimal(product.price),
        availability: inStock ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
        itemCondition: 'https://schema.org/NewCondition',
      },
      ...(product.numReviews > 0 && {
        aggregateRating: { '@type': 'AggregateRating', ratingValue: product.rating, reviewCount: product.numReviews, bestRating: 5 },
        review: reviews.slice(0, 5).map(r => ({
          '@type': 'Review',
          author: { '@type': 'Person', name: r.userName },
          datePublished: r.createdAt.slice(0, 10),
          reviewBody: r.comment,
          reviewRating: { '@type': 'Rating', ratingValue: r.rating, bestRating: 5 },
        })),
      }),
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: absoluteUrl('/') },
        {
          '@type': 'ListItem',
          position: 2,
          name: product.category,
          item: absoluteUrl(`/products?category=${encodeURIComponent(product.category)}`),
        },
        { '@type': 'ListItem', position: 3, name: product.title, item: url },
      ],
    },
  ];
}

async function bundleProducts(offers: BundleOffer[], current: Product): Promise<Record<string, Product>> {
  const slugs = [...new Set(offers.flatMap(o => o.components?.map(c => c.slug) ?? []))];
  const loaded = await Promise.all(slugs.map(s => (s === current.slug ? current : serverApi.product(s).catch(() => null))));
  return Object.fromEntries(loaded.filter((p): p is Product => p !== null).map(p => [p.slug, p]));
}

export default async function ProductDetailPage({ params }: Props) {
  const { slug } = await params;
  const product = await serverApi.product(slug);
  if (!product) notFound();

  const [reviews, bundles, recommendations] = await Promise.all([
    serverApi.reviews(product._id).catch(() => []),
    serverApi.bundles(product._id).catch(() => ({ offers: [] })),
    serverApi.recommendations(product._id).catch(() => ({ items: [], source: 'none' })),
  ]);
  const componentProducts = await bundleProducts(bundles.offers, product);
  const related = recommendations.items.filter(p => p.slug !== product.slug);

  const saving = product.compareAtPrice && product.compareAtPrice > product.price ? product.compareAtPrice - product.price : 0;
  const hasBundles = bundles.offers.length > 0;
  const recsHeading = recommendations.source === 'frequently-bought-together' ? 'Often bought with it' : `More in ${product.category}`;

  return (
    <div className="mx-auto max-w-[1760px] px-4 pb-8 pt-6 sm:px-8" data-testid="product-detail-page">
      <JsonLd data={productJsonLd(product, reviews)} />
      <nav aria-label="Breadcrumb" className="mb-6 text-base text-muted-foreground">
        <ol className="flex flex-wrap gap-x-2">
          <li>
            <Link href="/" className="underline-offset-4 hover:text-foreground hover:underline">
              Home
            </Link>
            <span aria-hidden> /</span>
          </li>
          <li>
            <Link
              href={`/products?category=${encodeURIComponent(product.category)}`}
              className="underline-offset-4 hover:text-foreground hover:underline"
            >
              {product.category}
            </Link>
            <span aria-hidden> /</span>
          </li>
          <li aria-current="page" className="text-foreground">
            {product.title}
          </li>
        </ol>
      </nav>

      <div className="grid grid-cols-1 gap-10 lg:grid-cols-12 lg:gap-8">
        <div className="min-w-0 lg:col-span-7">
          <ProductGallery images={product.images} title={product.title} />
        </div>

        <div className="min-w-0 lg:col-span-5">
          <div className="edge-perforated animate-rise bg-card px-6 pb-10 pt-11 sm:px-10 lg:sticky lg:top-20">
            <h1 data-testid="product-title" className="text-balance text-display-md font-extrabold">
              {product.title}
            </h1>
            <div className="mt-5 flex flex-wrap items-baseline gap-x-4 gap-y-2 tabular-nums">
              <p data-testid="product-price" className="text-3xl font-bold tracking-[-0.02em]">
                {fmtINR(product.price)}
              </p>
              {saving > 0 && (
                <>
                  <p className="text-lg text-muted-foreground line-through">
                    <span className="sr-only">Was </span>
                    {fmtINR(product.compareAtPrice!)}
                  </p>
                  <p className="text-lg font-semibold">
                    You save <span className="highlight px-1">{fmtINR(saving)}</span>
                  </p>
                </>
              )}
            </div>
            {product.numReviews > 0 && (
              <a href="#reviews" className="mt-3 flex w-fit items-center gap-2 text-base underline-offset-4 hover:underline">
                <Star className="h-4 w-4 fill-foreground text-foreground" aria-hidden />
                <span className="tabular-nums">{product.rating.toFixed(1)}</span>
                <span className="sr-only"> out of 5,</span>
                <span className="text-muted-foreground">
                  from {product.numReviews} review{product.numReviews === 1 ? '' : 's'}
                </span>
              </a>
            )}

            <p className="mt-6 max-w-[52ch] text-lg leading-relaxed">{product.description}</p>

            <PurchasePanel product={product} />

            <dl className="mt-9 space-y-3 text-base">
              {[
                ['Delivery', `Free over ${fmtINR(FREE_SHIPPING_THRESHOLD)}, tracked from packing to your door`],
                ['Cancelling', 'Any time before the order ships'],
                ['Returns', 'Within 7 days of delivery, refunded at the price you paid'],
              ].map(([term, detail]) => (
                <div key={term} className="grid grid-cols-[7rem_minmax(0,1fr)] gap-4">
                  <dt className="font-semibold">{term}</dt>
                  <dd>{detail}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </div>

      {(hasBundles || related.length > 0) && (
        <section aria-labelledby="wear-heading" className="mt-28 grid grid-cols-1 gap-12 sm:mt-40 lg:grid-cols-12 lg:gap-8">
          <div className="lg:col-span-4">
            <Reveal>
              <h2 id="wear-heading" className="text-display-md font-extrabold">
                Wear it with
              </h2>
            </Reveal>
            <Reveal delay={80}>
              <p className="mt-4 max-w-[40ch] text-lg">
                Offers apply on their own in your bag, and the optimizer always picks the cheapest combination of them.
              </p>
            </Reveal>
            {hasBundles && related.length > 0 && (
              <Reveal delay={160} className="mt-12">
                <Recommendations heading={recsHeading} items={related.slice(0, 4)} />
              </Reveal>
            )}
          </div>
          <Reveal delay={160} className="min-w-0 lg:col-span-8">
            {hasBundles ? (
              <BundleOffers offers={bundles.offers} products={componentProducts} />
            ) : (
              <Recommendations heading={recsHeading} items={related.slice(0, 4)} wide />
            )}
          </Reveal>
        </section>
      )}

      <div className="mt-28 sm:mt-40">
        <ReviewsSection productId={product._id} initialReviews={reviews} numReviews={product.numReviews} rating={product.rating} />
      </div>
    </div>
  );
}

/** Other pieces people bought with this one, as rows of a small photograph, the name and the price. */
function Recommendations({ heading, items, wide = false }: { heading: string; items: Recommendation[]; wide?: boolean }) {
  return (
    <div data-testid="recommendations">
      <h3 id="fbt-heading" className={wide ? 'sr-only' : 'text-xl font-bold'}>
        {heading}
      </h3>
      <ul className={wide ? 'grid gap-8 sm:grid-cols-2' : 'mt-5 space-y-4'}>
        {items.map(p => (
          <li key={p._id}>
            <Link
              href={`/products/${p.slug}`}
              data-testid={`product-card-${p.slug}`}
              className="group flex items-center gap-4 transition-transform duration-150 ease-out active:scale-[0.98]"
            >
              <span className={`relative shrink-0 overflow-hidden bg-secondary ${wide ? 'h-40 w-32' : 'h-24 w-[4.5rem]'}`}>
                <Image
                  src={p.images[0]}
                  alt=""
                  fill
                  sizes={wide ? '128px' : '72px'}
                  className="object-cover transition-transform duration-500 ease-out group-hover:scale-[1.04]"
                />
              </span>
              <span>
                <span className="block text-base font-semibold underline-offset-4 group-hover:underline">{p.title}</span>
                <span className="block text-base tabular-nums text-muted-foreground">{fmtINR(p.price)}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
