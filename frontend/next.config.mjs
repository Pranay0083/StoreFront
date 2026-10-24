import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  transpilePackages: ['@storefront/contracts'],
  outputFileTracingRoot: repoRoot,
  eslint: { ignoreDuringBuilds: true },
  // Render metadata in <head> for every client (not only known bots) so crawlers and audits see it.
  htmlLimitedBots: /.*/,
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'images.unsplash.com' },
      { protocol: 'https', hostname: 'images.pexels.com' },
    ],
  },
  async rewrites() {
    return [{ source: '/mcp', destination: `${process.env.INTERNAL_API_URL || process.env.NEXT_PUBLIC_API_URL}/api/v1/mcp` }];
  },
};

export default nextConfig;
