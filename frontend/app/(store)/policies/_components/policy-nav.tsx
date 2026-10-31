import Link from 'next/link';
import { POLICIES, policyPath, type PolicySlug } from '@storefront/contracts';
import { cn } from '@/lib/utils';

function PolicyLinks({ current }: { current?: PolicySlug }) {
  return (
    <ul className="space-y-1">
      <li>
        <Link
          href="/policies"
          aria-current={current ? undefined : 'page'}
          className={cn(
            'block py-1.5 text-base underline-offset-4 hover:underline',
            current ? 'text-muted-foreground hover:text-foreground' : 'font-semibold',
          )}
        >
          All policies
        </Link>
      </li>
      {POLICIES.map(doc => (
        <li key={doc.slug}>
          <Link
            href={policyPath(doc.slug)}
            aria-current={doc.slug === current ? 'page' : undefined}
            data-testid={`policy-nav-${doc.slug}`}
            className={cn(
              'block py-1.5 text-base underline-offset-4 hover:underline',
              doc.slug === current ? 'font-semibold' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {doc.title}
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** The list of policies: a sticky column on desktop, folded into one tap-to-open row on phones. */
export function PolicyNav({ current }: { current?: PolicySlug }) {
  const currentTitle = POLICIES.find(d => d.slug === current)?.title;
  return (
    <>
      <details className="group bg-secondary lg:hidden" data-testid="policy-nav-mobile">
        <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-4 text-base font-semibold [&::-webkit-details-marker]:hidden">
          <span>{currentTitle ? `Policies: ${currentTitle}` : 'All policies'}</span>
          <span aria-hidden className="text-xl leading-none transition-transform duration-200 ease-out group-open:rotate-45">
            +
          </span>
        </summary>
        <nav aria-label="Store policies" className="px-5 pb-4">
          <PolicyLinks current={current} />
        </nav>
      </details>
      <nav aria-label="Store policies" className="hidden lg:sticky lg:top-24 lg:block" data-testid="policy-nav">
        <h2 className="mb-3 text-base font-semibold">Store policies</h2>
        <PolicyLinks current={current} />
      </nav>
    </>
  );
}
