import { AgentWidget } from '@/components/agent-widget';
import { CartSheet } from '@/components/cart-sheet';
import { Footer } from '@/components/footer';
import { Navbar } from '@/components/navbar';

export default function StoreLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Navbar />
      <CartSheet />
      <main className="min-h-[70vh]">{children}</main>
      <Footer />
      <AgentWidget />
    </>
  );
}
