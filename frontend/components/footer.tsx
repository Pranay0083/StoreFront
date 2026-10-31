import Link from 'next/link';
import { getPolicy, policyPath, type PolicySlug } from '@storefront/contracts';

/** Help links take their names from the policies themselves; privacy and terms sit by the copyright line. */
const policyLink = (slug: PolicySlug) => ({ label: getPolicy(slug)!.title, href: policyPath(slug), testId: `footer-policy-${slug}` });
const LEGAL: PolicySlug[] = ['privacy', 'terms'];

const COLUMNS = [
  {
    title: 'Shop',
    links: [
      { label: 'Men', href: '/products?category=Men' },
      { label: 'Women', href: '/products?category=Women' },
      { label: 'Footwear', href: '/products?category=Footwear' },
      { label: 'Accessories', href: '/products?category=Accessories' },
    ],
  },
  {
    title: 'Account',
    links: [
      { label: 'Order tracking', href: '/orders' },
      { label: 'Sign in', href: '/login' },
      { label: 'Create account', href: '/register' },
    ],
  },
  {
    title: 'Help',
    links: [
      ...(['shipping', 'returns', 'cancellations', 'payments', 'size-guide', 'help'] as const).map(policyLink),
      { label: 'All policies', href: '/policies', testId: 'footer-policies-link' },
    ],
  },
  {
    title: 'Platform',
    links: [
      { label: 'Documentation', href: '/docs', testId: 'footer-docs-link' },
      { label: 'REST API', href: '/docs#api' },
      { label: 'MCP server', href: '/docs#mcp' },
      { label: 'AI agent', href: '/docs#agent' },
    ],
  },
];

/** The close: the promise in one sentence, the links, and the name across the full width. */
export function Footer() {
  return (
    <footer className="mt-32 bg-primary text-primary-foreground sm:mt-40 [&_:focus-visible]:outline-card">
      <div className="mx-auto max-w-[1760px] px-4 pt-16 sm:px-8 sm:pt-24">
        <div className="grid gap-12 lg:grid-cols-12 lg:gap-8">
          <p className="max-w-[34ch] text-xl leading-snug lg:col-span-4">
            Every order is tracked from the moment it is placed to the day it arrives, and you can cancel any time before it ships.
          </p>
          <nav aria-label="Footer" className="grid grid-cols-2 gap-x-8 gap-y-10 sm:grid-cols-4 lg:col-span-8">
            {COLUMNS.map(col => (
              <div key={col.title}>
                <h2 className="text-base font-semibold">{col.title}</h2>
                <ul className="mt-4 space-y-2.5 text-base text-primary-foreground/75">
                  {col.links.map(l => (
                    <li key={l.href}>
                      <Link
                        href={l.href}
                        data-testid={'testId' in l ? l.testId : undefined}
                        className="transition-colors duration-150 hover:text-primary-foreground hover:underline hover:underline-offset-4"
                      >
                        {l.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>

        <svg viewBox="0 0 1000 124" className="mt-20 block w-full fill-current sm:mt-28" role="img" aria-label="STOREFRONT">
          <text
            x="0"
            y="120"
            textLength="1000"
            lengthAdjust="spacingAndGlyphs"
            fontSize="166"
            fontWeight="800"
            letterSpacing="-6"
            style={{ fontFamily: 'var(--font-sans)' }}
          >
            STOREFRONT
          </text>
        </svg>
        <div className="flex flex-wrap gap-x-6 gap-y-2 py-6 text-sm text-primary-foreground/70">
          <p>© {new Date().getFullYear()} Storefront</p>
          {LEGAL.map(slug => {
            const l = policyLink(slug);
            return (
              <Link
                key={slug}
                href={l.href}
                data-testid={l.testId}
                className="transition-colors duration-150 hover:text-primary-foreground hover:underline hover:underline-offset-4"
              >
                {l.label}
              </Link>
            );
          })}
        </div>
      </div>
    </footer>
  );
}
