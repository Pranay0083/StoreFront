'use client';

import { ArrowLeft, LayoutDashboard, LogOut, Package, ShoppingBag, TicketPercent } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useAuth } from '@/components/providers';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

const LINKS = [
  { href: '/admin', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/admin/orders', label: 'Order queue', icon: Package },
  { href: '/admin/products', label: 'Products', icon: ShoppingBag },
  { href: '/admin/coupons', label: 'Coupons', icon: TicketPercent },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (user === false) router.replace('/login?next=/admin');
    else if (user && typeof user === 'object' && user.role !== 'admin') router.replace('/');
  }, [user, router]);

  if (!user || typeof user !== 'object' || user.role !== 'admin') {
    return (
      <div className="p-10">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="mt-6 h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen" data-testid="admin-layout">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-black/10 bg-white md:flex">
        <div className="border-b border-black/10 px-6 py-5">
          <Link href="/" className="font-serif text-xl font-semibold">STOREFRONT<span className="text-muted-foreground">.</span></Link>
          <p className="label-caps mt-1 text-muted-foreground">Back office</p>
        </div>
        <nav className="flex-1 space-y-1 p-3">
          {LINKS.map(l => (
            <Link
              key={l.href}
              href={l.href}
              data-testid={`admin-nav-${l.label.toLowerCase().replace(/\s/g, '-')}`}
              className={cn(
                'flex items-center gap-3 px-3 py-2.5 text-sm transition-colors',
                pathname === l.href ? 'bg-black text-white' : 'text-foreground/70 hover:bg-black/5'
              )}
            >
              <l.icon className="h-4 w-4" strokeWidth={1.5} /> {l.label}
            </Link>
          ))}
        </nav>
        <div className="border-t border-black/10 p-3">
          <Link href="/" className="flex items-center gap-3 px-3 py-2.5 text-sm text-foreground/70 hover:bg-black/5">
            <ArrowLeft className="h-4 w-4" strokeWidth={1.5} /> View storefront
          </Link>
          <button
            data-testid="admin-logout-button"
            onClick={async () => { await logout(); router.replace('/'); }}
            className="flex w-full items-center gap-3 px-3 py-2.5 text-sm text-foreground/70 hover:bg-black/5"
          >
            <LogOut className="h-4 w-4" strokeWidth={1.5} /> Sign out
          </button>
        </div>
      </aside>

      <div className="flex-1 overflow-x-hidden">
        <header className="flex h-16 items-center justify-between border-b border-black/10 bg-white/70 px-6 backdrop-blur-xl">
          <div className="flex gap-4 md:hidden">
            {LINKS.map(l => (
              <Link key={l.href} href={l.href} className={cn('label-caps', pathname === l.href ? 'text-foreground' : 'text-muted-foreground')}>
                {l.label}
              </Link>
            ))}
          </div>
          <p className="hidden text-sm text-muted-foreground md:block">Role-gated · admin</p>
          <p data-testid="admin-user-email" className="text-sm font-medium">{user.email}</p>
        </header>
        <main className="p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
