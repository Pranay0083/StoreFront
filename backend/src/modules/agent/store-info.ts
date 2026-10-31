import { POLICIES, getPolicy, policyDigest, policyPath, type PolicySlug } from '@storefront/contracts';

/** The paragraphs of one policy section, as plain sentences. */
function sectionText(slug: PolicySlug, sectionId: string): string {
  const section = getPolicy(slug)?.sections.find(s => s.id === sectionId);
  if (!section) throw new Error(`Policy ${slug} has no section ${sectionId}`);
  return section.blocks.flatMap(b => (b.type === 'paragraph' ? [b.text] : b.type === 'list' ? b.items : [])).join(' ');
}

/**
 * What `get_store_info` tells the assistant. Every policy string is read from the store policies in
 * `@storefront/contracts`, the same text the website's policy pages, product page and checkout show,
 * so Aria can never quote a rule the site doesn't.
 */
export const STORE_INFO = {
  name: 'STOREFRONT',
  tagline: 'Considered clothing',
  currency: 'INR (₹)',
  shipping: policyDigest('shipping'),
  payments: policyDigest('payments'),
  returns: policyDigest('returns'),
  cancellations: policyDigest('cancellations'),
  offers: sectionText('help', 'offers'),
  sizes: policyDigest('size-guide'),
  privacy: policyDigest('privacy'),
  support: policyDigest('help'),
  /** Link these as [Title](path) when the customer wants the full policy. */
  policyPages: POLICIES.map(d => ({ title: d.title, path: policyPath(d.slug), summary: d.summary })),
} as const;
