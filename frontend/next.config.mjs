import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  experimental: {
    outputFileTracingRoot: repoRoot,
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'images.unsplash.com' },
      { protocol: 'https', hostname: 'images.pexels.com' },
    ],
  },
  async rewrites() {
    return [
      { source: '/mcp', destination: `${process.env.INTERNAL_API_URL || process.env.NEXT_PUBLIC_API_URL}/api/mcp` },
    ];
  },
};

export default nextConfig;
