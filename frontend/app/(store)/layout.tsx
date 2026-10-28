import { AgentWidget } from '@/components/agent-widget';
import { CartSheet } from '@/components/cart-sheet';
import { Footer } from '@/components/footer';
import { Navbar } from '@/components/navbar';

export default function StoreLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <a
        href="#main"
        className="sr-only z-50 bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
      >
        Skip to content
      </a>
      <Navbar />
      <CartSheet />
      <main id="main" tabIndex={-1} className="min-h-[70svh] outline-none">
        {children}
      </main>
      <Footer />
      <AgentWidget />
    </>
  );
}
