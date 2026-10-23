import { AgentWidget } from '@/components/agent-widget';
import { CartSheet } from '@/components/cart-sheet';
import { Footer } from '@/components/footer';
import { Navbar } from '@/components/navbar';

export default function StoreLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <a href="#main" className="sr-only z-50 bg-black px-4 py-2 text-sm text-white focus:not-sr-only focus:fixed focus:left-4 focus:top-4">
        Skip to content
      </a>
      <Navbar />
      <CartSheet />
      <main id="main" tabIndex={-1} className="min-h-[70vh] outline-none">
        {children}
      </main>
      <Footer />
      <AgentWidget />
    </>
  );
}
