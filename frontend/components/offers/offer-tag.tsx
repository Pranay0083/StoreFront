import Image from 'next/image';
import Link from 'next/link';
import { AddSetButton } from '@/components/offers/add-set-button';
import { fmtINR } from '@/lib/api';
import { cn } from '@/lib/utils';
import { fmtDay } from '@/lib/words';
import { FREE_SHIPPING_THRESHOLD, type CustomerSegment, type Offer, type OfferExample } from '@storefront/contracts';

/*
 * An advertised offer as the shop's paper: the pieces' photographs pinned to a receipt whose every
 * figure comes from the offers read model, which priced the example with the same engine as the bag.
 * Nothing here adds or subtracts money; the brass only ever marks the saving the engine returned.
 */

const PRICED_FOR: Record<CustomerSegment, string> = {
  guest: 'Priced for guest checkout.',
  signedIn: 'Priced for a signed-in customer.',
  returning: 'Priced for a returning customer.',
  firstOrder: 'Priced for a first order.',
};

function Line({ label, note, value, className }: { label: React.ReactNode; note?: string; value: string; className?: string }) {
  return (
    <div className={cn('flex items-baseline justify-between gap-6', className)}>
      <span className="min-w-0">
        {label}
        {note && <span className="block text-sm text-muted-foreground">{note}</span>}
      </span>
      <span className="shrink-0">{value}</span>
    </div>
  );
}

/** The worked example as till lines: each piece at list price, the offer's line, the total and the saving. */
export function ExampleReceipt({ offer, example, compact = false }: { offer: Offer; example: OfferExample; compact?: boolean }) {
  return (
    <div className="text-base">
      <ul className="space-y-2.5">
        {example.lines.map(l => (
          <li key={`${l.productId}:${l.size}`}>
            <Line
              label={
                <Link href={`/products/${l.slug}`} className="underline-offset-4 hover:underline">
                  {l.title}
                </Link>
              }
              note={`Size ${l.size}${l.qty > 1 ? `, ${l.qty} × ${fmtINR(l.price)}` : ''}`}
              value={fmtINR(l.price * l.qty)}
            />
          </li>
        ))}
      </ul>
      <div className="mt-6 space-y-1.5">
        <Line label={<span className="font-semibold">{offer.name}</span>} value={`−${fmtINR(example.offerSaving)}`} />
        {example.alsoApplied.length > 0 && (
          <p className="text-sm text-muted-foreground">The bag also applies {example.alsoApplied.join(' and ')} to these pieces.</p>
        )}
      </div>
      <div className={cn('flex items-end justify-between gap-6', compact ? 'mt-5' : 'mt-6')}>
        <span className="text-lg font-semibold">Total</span>
        <span className="text-right">
          <span className="block text-base text-muted-foreground line-through">
            <span className="sr-only">Usually </span>
            {fmtINR(example.listTotal)}
          </span>
          <span
            data-testid={`offer-total-${offer.id}`}
            className={cn('font-extrabold', compact ? 'text-3xl tracking-[-0.03em]' : 'text-display-md')}
          >
            {fmtINR(example.total)}
          </span>
        </span>
      </div>
      <p className="mt-3 text-right text-xl font-bold">
        You save{' '}
        <span data-testid={`offer-saving-${offer.id}`} className="highlight px-1">
          {fmtINR(example.saving)}
        </span>
      </p>
      <p className="mt-4 text-sm text-muted-foreground">
        {example.shipping === 0
          ? 'Delivery is free.'
          : `Plus ${fmtINR(example.shipping)} delivery; free over ${fmtINR(FREE_SHIPPING_THRESHOLD)}.`}
        {example.pricedFor ? ` ${PRICED_FOR[example.pricedFor]}` : ''}
      </p>
    </div>
  );
}

type Photo = { key: string; slug: string; title: string; image?: string };

/** The pieces' photographs; each one opens its product page. */
export function OfferPhotos({ photos, sizes, className }: { photos: Photo[]; sizes: string; className?: string }) {
  const shown = photos.filter(p => p.image).slice(0, 4);
  if (!shown.length) return null;
  // One photograph fills the column; two stand side by side; a third leads across the top; four make a square.
  const wide = (i: number) => shown.length === 3 && i === 0;
  return (
    <ul
      className={cn(
        'grid gap-2 md:h-full md:auto-rows-fr',
        shown.length === 1 ? 'grid-cols-1' : 'grid-cols-2',
        shown.length > 2 && 'md:grid-rows-2',
        className,
      )}
    >
      {shown.map((p, i) => (
        <li key={p.key} className={cn('md:min-h-0', wide(i) && 'col-span-2')}>
          <Link
            href={`/products/${p.slug}`}
            className={cn(
              'group relative block overflow-hidden bg-secondary transition-transform duration-150 ease-out active:scale-[0.98] md:aspect-auto md:h-full md:min-h-56',
              wide(i) ? 'aspect-[3/2]' : 'aspect-[3/4]',
            )}
          >
            <Image
              src={p.image!}
              alt={p.title}
              fill
              sizes={sizes}
              className="object-cover transition-transform duration-500 ease-out group-hover:scale-[1.03]"
            />
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function offerPhotos(offer: Offer): Photo[] {
  const source = offer.example ? offer.example.lines : offer.pieces;
  const seen = new Set<string>();
  return source
    .filter(p => !seen.has(p.productId) && seen.add(p.productId))
    .map(p => ({ key: p.productId, slug: p.slug, title: p.title, image: p.image }));
}

/** When it stops, the code to type, and the conditions, in that order. */
export function OfferFacts({ offer }: { offer: Offer }) {
  const facts = [...offer.terms, ...(offer.endsAt ? [`Ends ${fmtDay(offer.endsAt)}`] : [])];
  return (
    <>
      {offer.code && (
        <p className="mt-5 text-base">
          Use code <span className="text-2xl font-extrabold tracking-[-0.03em]">{offer.code}</span> at checkout
        </p>
      )}
      {facts.length > 0 && <p className="mt-4 text-base">{facts.join('. ')}.</p>}
    </>
  );
}

/**
 * One offer as a receipt with its photographs. `lead` is the home page's large set; `row` is a line
 * of the /offers page, which alternates the photographs left and right.
 */
export function OfferTag({
  offer,
  variant = 'row',
  flip = false,
  heading: Heading = 'h3',
}: {
  offer: Offer;
  variant?: 'lead' | 'row';
  flip?: boolean;
  heading?: 'h2' | 'h3';
}) {
  const photos = offerPhotos(offer);
  const buyable = offer.example && (offer.kind === 'set' || offer.kind === 'multiBuy');
  return (
    <article
      id={`offer-${offer.id}`}
      data-testid={`offer-${offer.id}`}
      className={cn('edge-perforated grid scroll-mt-24 bg-card', photos.length > 0 && 'md:grid-cols-2')}
    >
      {photos.length > 0 && (
        <div className={cn('px-4 pt-8 md:pb-8', flip && 'md:order-2')}>
          <OfferPhotos photos={photos} sizes={variant === 'lead' ? '(max-width: 768px) 50vw, 22vw' : '(max-width: 768px) 50vw, 25vw'} />
        </div>
      )}
      <div className="px-6 pb-10 pt-8 sm:px-8 md:pt-10">
        <Heading className="text-2xl font-bold tracking-[-0.03em]">{offer.name}</Heading>
        <p className="mt-2 max-w-[52ch] text-base">{offer.description || offer.summary}</p>
        <OfferFacts offer={offer} />
        {offer.tiers && (
          <ul className="mt-6 space-y-2.5 text-base" aria-label="Spend thresholds">
            {offer.tiers.map(t => (
              <li key={t.minSubtotal}>
                <Line label={`Spend ${fmtINR(t.minSubtotal)} or more`} value={t.reward} />
              </li>
            ))}
          </ul>
        )}
        {offer.example && (
          <div className="mt-8">
            <ExampleReceipt offer={offer} example={offer.example} compact={variant === 'row'} />
          </div>
        )}
        {buyable && (
          <AddSetButton
            offerId={offer.id}
            name={offer.name}
            lines={offer.example!.lines}
            label={offer.kind === 'set' ? 'Add the set to bag' : 'Add these to bag'}
            className="mt-7"
          />
        )}
      </div>
    </article>
  );
}
