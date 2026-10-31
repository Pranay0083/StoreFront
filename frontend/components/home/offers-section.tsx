import Link from 'next/link';
import { OfferTag } from '@/components/offers/offer-tag';
import { Reveal } from '@/components/reveal';
import { fmtINR } from '@/lib/api';
import type { Offer } from '@storefront/contracts';

/** The offer worth leading with: the set that saves the most, else any offer with a priced example. */
export function leadOffer(offers: readonly Offer[]): Offer | undefined {
  const bySaving = (a: Offer, b: Offer) => (b.example?.offerSaving ?? 0) - (a.example?.offerSaving ?? 0);
  const priced = offers.filter(o => o.example).sort(bySaving);
  return priced.find(o => o.kind === 'set') ?? priced[0];
}

/** The other offers as lines on one receipt, each linking to its place on /offers. */
function OfferLines({ offers, title }: { offers: Offer[]; title: string }) {
  return (
    <div className="edge-perforated bg-card px-6 pb-8 pt-9 sm:px-8">
      <h3 className="text-lg font-semibold">{title}</h3>
      <ul className="mt-5 space-y-4 text-base">
        {offers.slice(0, 6).map(o => (
          <li key={o.id}>
            <Link
              href={`/offers#offer-${o.id}`}
              data-testid={`home-offer-${o.id}`}
              className="group flex items-baseline justify-between gap-6"
            >
              <span className="min-w-0">
                <span className="font-semibold underline-offset-4 group-hover:underline">{o.name}</span>
                <span className="block text-sm text-muted-foreground">{o.code ? `With the code ${o.code}` : o.headline}</span>
              </span>
              {o.example ? (
                <span className="shrink-0">
                  save <span className="highlight px-1">{fmtINR(o.example.offerSaving)}</span>
                </span>
              ) : null}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * What is on offer right now, fed by the offers read model and refreshed by the `offers` tag, so a
 * combo the back office creates appears here on its own. The set that saves most leads as a receipt
 * with its photographs; the rest are lines on a second receipt that link to /offers.
 */
export function OffersSection({ offers }: { offers: Offer[] }) {
  if (!offers.length) return null;
  const lead = leadOffer(offers);
  const rest = offers.filter(o => o !== lead);

  return (
    <section aria-labelledby="offers-heading" data-testid="home-offers" className="mx-auto mt-24 max-w-[1760px] px-4 sm:mt-32 sm:px-8">
      <div className="grid gap-12 lg:grid-cols-12 lg:gap-8">
        <div className="min-w-0 lg:col-span-4">
          <Reveal>
            <h2 id="offers-heading" className="text-display-md font-extrabold">
              On offer now
            </h2>
          </Reveal>
          <Reveal delay={80}>
            <p className="mt-4 max-w-[44ch] text-lg">
              Put the pieces in your bag and each offer applies on its own. Every figure here was worked out by the optimizer that prices
              the bag.
            </p>
          </Reveal>
          {lead && rest.length > 0 && (
            <Reveal delay={160} className="mt-10">
              <OfferLines offers={rest} title="Also on offer" />
            </Reveal>
          )}
          <Reveal delay={240}>
            <p className="mt-8 text-base">
              <Link href="/offers" data-testid="home-offers-all" className="font-semibold underline underline-offset-4">
                See every offer
              </Link>
            </p>
          </Reveal>
        </div>
        <Reveal delay={160} className="min-w-0 lg:col-span-8">
          {lead ? <OfferTag offer={lead} variant="lead" /> : <OfferLines offers={rest} title="Offers running now" />}
        </Reveal>
      </div>
    </section>
  );
}
