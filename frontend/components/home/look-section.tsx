import Link from 'next/link';
import { connection } from 'next/server';
import { LookBuilder, type LookPiece } from '@/components/home/look-builder';
import { serverApi } from '@/lib/server-api';
import type { PriceQuote, Product } from '@storefront/contracts';

/**
 * Eight pieces that overlap on the running offers, so a few taps give the optimizer real choices:
 * the Oxford shirt and the selvedge jeans make the Weekend Uniform, three shirts make a mix-and-match,
 * and every third small accessory is free.
 */
const LOOK_SLUGS = [
  'oxford-cotton-shirt',
  'selvedge-denim-jeans',
  'suede-chelsea-boots',
  'full-grain-leather-belt',
  'breton-linen-shirt',
  'twill-overshirt',
  'ribbed-wool-beanie',
  'hand-rolled-silk-scarf',
];
/** The look the receipt opens on; the first two make a bundle. */
const PRESELECTED = ['oxford-cotton-shirt', 'selvedge-denim-jeans', 'suede-chelsea-boots', 'full-grain-leather-belt'];

const API = process.env.INTERNAL_API_URL || process.env.NEXT_PUBLIC_API_URL || '';

function toPiece(p: Product): LookPiece | null {
  const size = p.sizes.find(s => s.stock > 0);
  if (!size) return null;
  return { id: p._id, slug: p.slug, title: p.title, price: p.price, image: p.images[0], size: size.size, stock: size.stock };
}

/** The opening receipt is printed on the server, so the section is whole on the first paint and without JavaScript. */
async function quoteFor(pieces: LookPiece[]): Promise<PriceQuote | null> {
  if (!pieces.length) return null;
  try {
    const res = await fetch(`${API}/api/v1/pricing/quote`, {
      method: 'POST',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: pieces.map(p => ({ productId: p.id, size: p.size, qty: 1 })), codes: [] }),
    });
    return res.ok ? ((await res.json()) as PriceQuote) : null;
  } catch {
    return null;
  }
}

export async function LookSection() {
  await connection();
  const loaded = await Promise.all(LOOK_SLUGS.map(slug => serverApi.product(slug).catch(() => null)));
  const pieces = loaded.filter((p): p is Product => p !== null).flatMap(p => toPiece(p) ?? []);

  if (pieces.length < 2) {
    return (
      <p className="text-lg">
        The pieces are being restocked.{' '}
        <Link href="/products" className="underline underline-offset-4">
          Browse the catalogue
        </Link>
      </p>
    );
  }

  const opening = pieces.filter(p => PRESELECTED.includes(p.slug));
  const initialQuote = await quoteFor(opening);
  return <LookBuilder pieces={pieces} initialSelected={opening.map(p => p.id)} initialQuote={initialQuote} />;
}

/** The section's shape while the pieces load, so nothing below it moves when they arrive. */
export function LookSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-12 lg:grid-cols-12 lg:gap-8" aria-busy="true" aria-label="Loading the pieces">
      <div className="hidden grid-cols-4 gap-x-4 gap-y-8 sm:grid lg:col-span-7">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i}>
            <div className="aspect-[3/4] animate-pulse bg-primary-foreground/10" />
            <div className="mt-2.5 h-10" />
          </div>
        ))}
      </div>
      <div className="edge-perforated min-h-[560px] bg-card lg:col-span-5" />
    </div>
  );
}
