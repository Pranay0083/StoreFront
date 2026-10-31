import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { JsonLd } from '@/components/json-ld';
import { SITE_NAME, absoluteUrl } from '@/lib/site';
import { POLICIES, getPolicy, policyPath } from '@storefront/contracts';
import { PolicyArticle } from '../_components/policy-document';
import { PolicyNav } from '../_components/policy-nav';

export const dynamicParams = false;

export function generateStaticParams() {
  return POLICIES.map(doc => ({ slug: doc.slug }));
}

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const doc = getPolicy((await params).slug);
  if (!doc) return { title: `Not found — ${SITE_NAME}` };
  const url = absoluteUrl(policyPath(doc.slug));
  return {
    title: `${doc.title} — ${SITE_NAME}`,
    description: doc.summary,
    alternates: { canonical: url },
    openGraph: { type: 'article', url, siteName: SITE_NAME, title: doc.title, description: doc.summary },
  };
}

export default async function PolicyPage({ params }: Props) {
  const doc = getPolicy((await params).slug);
  if (!doc) notFound();

  return (
    <div className="mx-auto max-w-[1760px] px-4 pb-8 pt-6 sm:px-8 sm:pt-10" data-testid="policy-page">
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'BreadcrumbList',
          itemListElement: [
            { '@type': 'ListItem', position: 1, name: 'Home', item: absoluteUrl('/') },
            { '@type': 'ListItem', position: 2, name: 'Store policies', item: absoluteUrl('/policies') },
            { '@type': 'ListItem', position: 3, name: doc.title, item: absoluteUrl(policyPath(doc.slug)) },
          ],
        }}
      />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 lg:gap-8">
        <div className="lg:col-span-3 lg:pt-16">
          <PolicyNav current={doc.slug} />
        </div>
        <div className="min-w-0 lg:col-span-9">
          <PolicyArticle doc={doc} />
        </div>
      </div>
    </div>
  );
}
