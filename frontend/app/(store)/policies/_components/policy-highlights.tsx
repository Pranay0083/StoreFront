import Link from 'next/link';
import { POLICY_HIGHLIGHTS, policyPath } from '@storefront/contracts';
import { cn } from '@/lib/utils';

export type HighlightKey = keyof typeof POLICY_HIGHLIGHTS;

/**
 * Policy one-liners as a definition list: the term links to the full policy, the text is the same
 * sentence the policy page, checkout and the assistant use.
 */
export function PolicyHighlights({ keys, className }: { keys: readonly HighlightKey[]; className?: string }) {
  return (
    <dl className={cn('space-y-3 text-base', className)}>
      {keys.map(key => {
        const h: { label: string; text: string; slug: Parameters<typeof policyPath>[0]; section?: string } = POLICY_HIGHLIGHTS[key];
        return (
          <div key={key} className="grid grid-cols-[7rem_minmax(0,1fr)] gap-4">
            <dt className="font-semibold">
              <Link
                href={policyPath(h.slug, h.section)}
                data-testid={`policy-highlight-${key}`}
                className="underline decoration-1 underline-offset-4 transition-colors duration-150 hover:decoration-2"
              >
                {h.label}
              </Link>
            </dt>
            <dd>{h.text}</dd>
          </div>
        );
      })}
    </dl>
  );
}
