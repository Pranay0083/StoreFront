import type { Metadata } from 'next';
import Link from 'next/link';
import { SITE_NAME, absoluteUrl } from '@/lib/site';
import { POLICIES, policyPath } from '@storefront/contracts';
import { fmtPolicyDate } from './_components/policy-document';
import { PolicyHighlights } from './_components/policy-highlights';

const DESCRIPTION =
  'Delivery, returns, cancellations, payments, sizes, privacy and terms at STOREFRONT, each one exactly what the shop does.';

export const metadata: Metadata = {
  title: `Store policies — ${SITE_NAME}`,
  description: DESCRIPTION,
  alternates: { canonical: absoluteUrl('/policies') },
  openGraph: { type: 'website', url: absoluteUrl('/policies'), siteName: SITE_NAME, title: 'Store policies', description: DESCRIPTION },
};

const latest = POLICIES.map(d => d.lastUpdated)
  .sort()
  .at(-1)!;

export default function PoliciesIndexPage() {
  return (
    <div className="mx-auto max-w-[1760px] px-4 pb-8 pt-10 sm:px-8 sm:pt-16" data-testid="policies-page">
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-12 lg:items-end lg:gap-8">
        <h1 className="animate-rise text-balance text-display-lg font-extrabold lg:col-span-7">Store policies</h1>
        <div className="animate-rise [animation-delay:80ms] lg:col-span-5">
          <p className="max-w-[46ch] text-lg">
            The rules this shop runs on, written down. Each one describes what the store actually does, and checkout and Aria, the shopping
            assistant, quote the same words.
          </p>
          <p className="mt-3 text-base text-muted-foreground">
            Last updated <time dateTime={latest}>{fmtPolicyDate(latest)}</time>
          </p>
        </div>
      </div>

      <div className="mt-14 grid grid-cols-1 gap-8 sm:mt-20 lg:grid-cols-12">
        <section aria-labelledby="short-version" className="lg:col-span-4 lg:self-start lg:pt-12">
          <h2 id="short-version" className="text-xl font-bold tracking-[-0.02em]">
            The short version
          </h2>
          <PolicyHighlights keys={['delivery', 'cancelling', 'returns', 'hold']} className="mt-6" />
        </section>

        <nav aria-label="All store policies" className="edge-perforated bg-card px-2 py-8 sm:px-4 sm:py-10 lg:col-span-8">
          <ul>
            {POLICIES.map(doc => (
              <li key={doc.slug}>
                <Link
                  href={policyPath(doc.slug)}
                  data-testid={`policy-link-${doc.slug}`}
                  className="group grid grid-cols-1 gap-1 px-3 py-5 transition-[background-color,transform] duration-150 ease-out hover:bg-secondary active:scale-[0.99] sm:grid-cols-12 sm:gap-6 sm:px-6"
                >
                  <span className="text-2xl font-extrabold leading-tight tracking-[-0.03em] underline-offset-4 group-hover:underline sm:col-span-5">
                    {doc.title}
                  </span>
                  <span className="text-lg leading-snug sm:col-span-7">{doc.summary}</span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </div>
  );
}
