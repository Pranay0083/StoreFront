import type { MetadataRoute } from 'next';
import { serverApi } from '@/lib/server-api';
import { absoluteUrl } from '@/lib/site';
import { POLICIES, policyPath } from '@storefront/contracts';

// Rendered on request (product fetches are still served from the tagged data cache).
export const dynamic = 'force-dynamic';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const pages: MetadataRoute.Sitemap = [
    { url: absoluteUrl('/'), changeFrequency: 'daily', priority: 1 },
    { url: absoluteUrl('/products'), changeFrequency: 'daily', priority: 0.9 },
    { url: absoluteUrl('/offers'), changeFrequency: 'daily', priority: 0.8 },
    { url: absoluteUrl('/policies'), changeFrequency: 'monthly', priority: 0.4 },
    ...POLICIES.map(doc => ({
      url: absoluteUrl(policyPath(doc.slug)),
      lastModified: doc.lastUpdated,
      changeFrequency: 'monthly' as const,
      priority: 0.4,
    })),
  ];
  try {
    const [categories, products] = await Promise.all([serverApi.categories(), serverApi.allProducts()]);
    for (const c of categories) {
      pages.push({ url: absoluteUrl(`/products?category=${encodeURIComponent(c.name)}`), changeFrequency: 'weekly', priority: 0.7 });
    }
    for (const p of products) {
      pages.push({ url: absoluteUrl(`/products/${p.slug}`), changeFrequency: 'weekly', priority: 0.8, images: p.images.slice(0, 1) });
    }
  } catch {
    // The API may be unreachable while the image is built; static entries still make a valid sitemap.
  }
  return pages;
}
