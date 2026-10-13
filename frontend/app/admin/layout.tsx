'use client';

import { ArrowLeft, LayoutDashboard, LogOut, MessageSquare, Package, ScrollText, ShoppingBag, TicketPercent, Users } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useAuth } from '@/components/providers';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { isStaff, ROLE_LABELS, type Permission, type User } from '@storefront/contracts';

const LINKS: Array<{ href: string; label: string; icon: typeof LayoutDashboard; permission: Permission }> = [
  { href: '/admin', label: 'Dashboard', icon: LayoutDashboard, permission: 'dashboard:read' },
  { href: '/admin/orders', label: 'Order queue', icon: Package, permission: 'orders:read' },
  { href: '/admin/products', label: 'Products', icon: ShoppingBag, permission: 'catalog:write' },
  { href: '/admin/promotions', label: 'Promotions', icon: TicketPercent, permission: 'promotions:write' },
  { href: '/admin/chats', label: 'Agent chats', icon: MessageSquare, permission: 'chats:read' },
  { href: '/admin/users', label: 'Team', icon: Users, permission: 'users:manage' },
  { href: '/admin/audit', label: 'Audit log', icon: ScrollText, permission: 'audit:read' },
];

const isStaffUser = (user: User | null | false): user is User => !!user && typeof user === 'object' && isStaff(user.role);

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (user === false) router.replace('/login?next=/admin');
    else if (user && typeof user === 'object' && !isStaff(user.role)) router.replace('/');
  }, [user, router]);

  if (!isStaffUser(user)) {
    return (
      <div className="p-10">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="mt-6 h-64 w-full" />
      </div>
    );
  }

  const links = LINKS.filter(l => user.permissions.includes(l.permission));
  const current = LINKS.find(l => l.href === pathname);
  const forbidden = current && !user.permissions.includes(current.permission);

  return (
    <div className="flex min-h-screen" data-testid="admin-layout">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-black/10 bg-white md:flex">
        <div className="border-b border-black/10 px-6 py-5">
          <Link href="/" className="font-serif text-xl font-semibold">
            STOREFRONT<span className="text-muted-foreground">.</span>
          </Link>
          <p className="label-caps mt-1 text-muted-foreground">Back office</p>
        </div>
        <nav className="flex-1 space-y-1 p-3">
          {links.map(l => (
            <Link
              key={l.href}
              href={l.href}
              data-testid={`admin-nav-${l.label.toLowerCase().replace(/\s/g, '-')}`}
              className={cn(
                'flex items-center gap-3 px-3 py-2.5 text-sm transition-colors',
                pathname === l.href ? 'bg-black text-white' : 'text-foreground/70 hover:bg-black/5',
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
            onClick={async () => {
              await logout();
              router.replace('/');
            }}
            className="flex w-full items-center gap-3 px-3 py-2.5 text-sm text-foreground/70 hover:bg-black/5"
          >
            <LogOut className="h-4 w-4" strokeWidth={1.5} /> Sign out
          </button>
        </div>
      </aside>

      <div className="flex-1 overflow-x-hidden">
        <header className="flex h-16 items-center justify-between border-b border-black/10 bg-white/70 px-6 backdrop-blur-xl">
          <div className="flex gap-4 md:hidden">
            {links.map(l => (
              <Link
                key={l.href}
                href={l.href}
                className={cn('label-caps', pathname === l.href ? 'text-foreground' : 'text-muted-foreground')}
              >
                {l.label}
              </Link>
            ))}
          </div>
          <p className="hidden text-sm text-muted-foreground md:block" data-testid="admin-user-role">
            Role-gated · {ROLE_LABELS[user.role]}
          </p>
          <p data-testid="admin-user-email" className="text-sm font-medium">
            {user.email}
          </p>
        </header>
        <main className="p-6 lg:p-8">
          {forbidden ? (
            <p className="text-sm text-muted-foreground" data-testid="admin-forbidden">
              Your role ({ROLE_LABELS[user.role]}) does not include access to {current.label.toLowerCase()}.
            </p>
          ) : (
            children
          )}
        </main>
      </div>
    </div>
  );
}
