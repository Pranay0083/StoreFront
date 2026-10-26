import type { Metadata, Viewport } from 'next';
import { Schibsted_Grotesk } from 'next/font/google';
import { Toaster } from 'sonner';
import { Providers } from '@/components/providers';
import './globals.css';

// One face for everything: heavy and tight for display, regular for reading.
const sans = Schibsted_Grotesk({ subsets: ['latin'], weight: 'variable', variable: '--font-sans', display: 'swap' });

export const metadata: Metadata = {
  title: 'STOREFRONT — Considered Clothing',
  description: 'Twenty-four pieces, priced by an optimizer that always finds you the lowest total.',
};

export const viewport: Viewport = {
  themeColor: '#e8e8e3',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={sans.variable}>
      <body className="min-h-screen">
        <Providers>{children}</Providers>
        <Toaster
          position="bottom-right"
          toastOptions={{
            style: {
              borderRadius: 0,
              border: 'none',
              background: 'hsl(var(--primary))',
              color: 'hsl(var(--primary-foreground))',
              fontFamily: 'var(--font-sans)',
            },
          }}
        />
      </body>
    </html>
  );
}
