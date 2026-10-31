import type { Metadata } from 'next';
import Link from 'next/link';
import { JsonLd } from '@/components/json-ld';
import { OfferTag } from '@/components/offers/offer-tag';
import { Reveal } from '@/components/reveal';
import { Button } from '@/components/ui/button';
import { serverApi } from '@/lib/server-api';
import { SITE_NAME, absoluteUrl } from '@/lib/site';
import { OFFER_KINDS, type Offer, type OfferKind } from '@storefront/contracts';

/** Matches OFFERS_REVALIDATE_SECONDS (route config must be a literal); the `offers` tag refreshes it sooner. */
export const revalidate = 120;

const GROUPS: Record<OfferKind, { heading: string; note: string }> = {
  set: { heading: 'Sets', note: 'Named pieces for one price. Put every piece in your bag and the set price applies.' },
  multiBuy: { heading: 'Multi-buys', note: 'Mix pieces from a range; the cheapest qualifying ones get the discount.' },
  spendMore: { heading: 'Spend more', note: 'Taken off the whole order once the bag reaches the amount.' },
  sale: { heading: 'Sale', note: 'Lower prices on these pieces, already shown in the bag.' },
  delivery: { heading: 'Delivery', note: 'Applies at checkout on its own.' },
  code: { heading: 'Codes', note: 'Type the code at checkout. The optimizer keeps it only when it lowers your total.' },
};

export const metadata: Metadata = {
  title: `Offers — ${SITE_NAME}`,
  description:
    'Every offer running now at STOREFRONT: sets, multi-buys, spend-more discounts and codes, each with a worked example priced by the optimizer that prices your bag.',
  alternates: { canonical: absoluteUrl('/offers') },
  openGraph: { url: absoluteUrl('/offers'), title: `Offers — ${SITE_NAME}`, siteName: SITE_NAME, type: 'website' },
};

function Group({ kind, offers }: { kind: OfferKind; offers: Offer[] }) {
  const { heading, note } = GROUPS[kind];
  return (
    <section aria-labelledby={`offers-${kind}`} data-testid={`offers-group-${kind}`} className="mt-24 sm:mt-32">
      <div className="grid gap-6 lg:grid-cols-12 lg:gap-8">
        <div className="lg:col-span-4">
          <Reveal>
            <h2 id={`offers-${kind}`} className="text-display-md font-extrabold">
              {heading}
            </h2>
          </Reveal>
          <Reveal delay={80}>
            <p className="mt-4 max-w-[40ch] text-lg">{note}</p>
          </Reveal>
        </div>
        <div className="min-w-0 space-y-10 lg:col-span-8">
          {offers.map((offer, i) => (
            <Reveal key={offer.id} delay={160}>
              <OfferTag offer={offer} flip={i % 2 === 1} />
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

export default async function OffersPage() {
  const { offers } = await serverApi.offersOrNone();
  const groups = OFFER_KINDS.map(kind => ({ kind, offers: offers.filter(o => o.kind === kind) })).filter(g => g.offers.length);

  return (
    <div className="mx-auto max-w-[1760px] px-4 pb-8 pt-8 sm:px-8 sm:pt-12" data-testid="offers-page">
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'ItemList',
          name: 'Offers',
          itemListElement: offers.map((o, i) => ({
            '@type': 'ListItem',
            position: i + 1,
            name: o.name,
            url: absoluteUrl(`/offers#offer-${o.id}`),
          })),
        }}
      />
      <div className="grid gap-8 lg:grid-cols-12 lg:items-end lg:gap-8">
        <h1 className="animate-rise text-display-lg font-extrabold lg:col-span-7">Offers running now</h1>
        <p className="max-w-[48ch] animate-rise text-lg [animation-delay:80ms] lg:col-span-5">
          {offers.length
            ? 'Each one applies in your bag on its own, and the optimizer picks the cheapest combination. The examples are priced by it, so the bag charges what they say.'
            : 'There are no offers running at the moment. Prices in the catalogue are the prices you pay, and the optimizer still checks every bag.'}
        </p>
      </div>

      {groups.map(g => (
        <Group key={g.kind} kind={g.kind} offers={g.offers} />
      ))}

      {!offers.length && (
        <div className="mt-16">
          <Button asChild size="lg">
            <Link href="/products">Shop the collection</Link>
          </Button>
        </div>
      )}
    </div>
  );
}
