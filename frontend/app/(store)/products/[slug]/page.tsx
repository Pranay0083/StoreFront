import { Star } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { JsonLd } from '@/components/json-ld';
import { BundleOffers } from '@/components/product/bundle-offers';
import { ProductGallery } from '@/components/product/product-gallery';
import { PurchasePanel } from '@/components/product/purchase-panel';
import { ReviewsSection } from '@/components/product/reviews-section';
import { ProductCard } from '@/components/product-card';
import { Separator } from '@/components/ui/separator';
import { fmtINR } from '@/lib/api';
import { serverApi } from '@/lib/server-api';
import { SITE_NAME, absoluteUrl } from '@/lib/site';
import type { BundleOffer, Product, Review } from '@storefront/contracts';

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

  return (
    <div className="mx-auto max-w-7xl px-5 py-12 sm:px-8" data-testid="product-detail-page">
      <JsonLd data={productJsonLd(product, reviews)} />
      <nav aria-label="Breadcrumb" className="mb-8 text-xs text-muted-foreground">
        <ol className="flex flex-wrap gap-2">
          <li>
            <Link href="/" className="hover:underline">
              Home
            </Link>{' '}
            /
          </li>
          <li>
            <Link href={`/products?category=${encodeURIComponent(product.category)}`} className="hover:underline">
              {product.category}
            </Link>{' '}
            /
          </li>
          <li aria-current="page" className="text-foreground">
            {product.title}
          </li>
        </ol>
      </nav>

      <div className="grid gap-12 lg:grid-cols-2">
        <ProductGallery images={product.images} title={product.title} />

        <div className="lg:pt-6">
          <p className="label-caps text-muted-foreground">{product.category}</p>
          <h1 data-testid="product-title" className="mt-3 font-serif text-4xl font-semibold leading-none tracking-tighter sm:text-5xl">
            {product.title}
          </h1>
          <div className="mt-4 flex items-center gap-4">
            <p data-testid="product-price" className="text-xl font-semibold">
              {fmtINR(product.price)}
            </p>
            {product.compareAtPrice ? (
              <p className="text-muted-foreground line-through">
                <span className="sr-only">Was </span>
                {fmtINR(product.compareAtPrice)}
              </p>
            ) : null}
            {product.numReviews > 0 && (
              <span className="flex items-center gap-1 text-sm text-muted-foreground">
                <Star className="h-4 w-4 fill-black text-black" aria-hidden /> {product.rating}
                <span className="sr-only"> out of 5 from</span> ({product.numReviews}
                <span className="sr-only"> reviews</span>)
              </span>
            )}
          </div>

          <p className="mt-6 max-w-lg text-base leading-relaxed text-muted-foreground">{product.description}</p>

          <PurchasePanel product={product} />
        </div>
      </div>

      <BundleOffers offers={bundles.offers} products={componentProducts} />

      {related.length > 0 && (
        <section aria-labelledby="fbt-heading" data-testid="recommendations" className="mt-20">
          <h2 id="fbt-heading" className="font-serif text-3xl font-semibold tracking-tight">
            {recommendations.source === 'frequently-bought-together' ? 'Frequently bought together' : `More in ${product.category}`}
          </h2>
          <div className="mt-8 grid grid-cols-2 gap-8 lg:grid-cols-4">
            {related.slice(0, 4).map((p, i) => (
              <ProductCard key={p._id} product={p} index={i} />
            ))}
          </div>
        </section>
      )}

      <Separator className="my-20" />

      <ReviewsSection productId={product._id} initialReviews={reviews} numReviews={product.numReviews} />
    </div>
  );
}
