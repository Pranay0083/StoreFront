'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  ArrowUpRight,
  FileUp,
  FlaskConical,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageSquare,
  Package,
  ScrollText,
  ShoppingBag,
  TicketPercent,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query';
import { cn } from '@/lib/utils';
import { ROLE_LABELS, type Order, type Permission, type User } from '@storefront/contracts';
import { fmtCount, Initial } from './ledger';

export interface AdminLink {
  href: string;
  label: string;
  icon: LucideIcon;
  permission: Permission;
  /** Kept from the first back office so existing selectors still find each item. */
  testId: string;
}

/** Nav items are routes, grouped by the work they belong to, and shown only to roles that may use them. */
export const ADMIN_GROUPS: Array<{ label: string | null; links: AdminLink[] }> = [
  {
    label: null,
    links: [
      { href: '/admin', label: 'Overview', icon: LayoutDashboard, permission: 'dashboard:read', testId: 'admin-nav-dashboard' },
      { href: '/admin/orders', label: 'Orders', icon: Package, permission: 'orders:read', testId: 'admin-nav-order-queue' },
    ],
  },
  {
    label: 'Catalogue',
    links: [
      { href: '/admin/products', label: 'Products', icon: ShoppingBag, permission: 'catalog:write', testId: 'admin-nav-products' },
      { href: '/admin/imports', label: 'Imports', icon: FileUp, permission: 'catalog:write', testId: 'admin-nav-imports' },
    ],
  },
  {
    label: 'Pricing',
    links: [
      {
        href: '/admin/promotions',
        label: 'Promotions',
        icon: TicketPercent,
        permission: 'promotions:write',
        testId: 'admin-nav-promotions',
      },
      {
        href: '/admin/experiments',
        label: 'Experiments',
        icon: FlaskConical,
        permission: 'experiments:manage',
        testId: 'admin-nav-experiments',
      },
    ],
  },
  {
    label: 'Customers',
    links: [{ href: '/admin/chats', label: 'Agent chats', icon: MessageSquare, permission: 'chats:read', testId: 'admin-nav-agent-chats' }],
  },
  {
    label: 'Store',
    links: [
      { href: '/admin/users', label: 'Team', icon: Users, permission: 'users:manage', testId: 'admin-nav-team' },
      { href: '/admin/audit', label: 'Audit log', icon: ScrollText, permission: 'audit:read', testId: 'admin-nav-audit-log' },
      { href: '/admin/operations', label: 'Operations', icon: Activity, permission: 'jobs:manage', testId: 'admin-nav-operations' },
    ],
  },
];

export const ADMIN_LINKS = ADMIN_GROUPS.flatMap(g => g.links);

/** The screen a path belongs to: the longest matching route, so /admin/promotions/simulator is Promotions. */
export const linkFor = (pathname: string) =>
  ADMIN_LINKS.filter(l => pathname === l.href || (l.href !== '/admin' && pathname.startsWith(`${l.href}/`))).sort(
    (a, b) => b.href.length - a.href.length,
  )[0];

/** The product's mark: a receipt with one brass line, the money the optimizer saved. */
export function Mark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 24" aria-hidden className={cn('h-6 w-5 flex-none', className)}>
      <path d="M2 1h16v20.5l-2-1.5-2 1.5-2-1.5-2 1.5-2-1.5-2 1.5-2-1.5-2 1.5z" fill="hsl(var(--foreground))" />
      <rect x="5" y="5.5" width="10" height="1.4" fill="hsl(var(--card))" />
      <rect x="5" y="9" width="7" height="1.4" fill="hsl(var(--card))" />
      <rect x="4.5" y="13" width="11" height="3" fill="hsl(var(--brass))" />
    </svg>
  );
}

function Wordmark() {
  return (
    <Link href="/admin" className="flex items-center gap-2.5 px-2">
      <Mark />
      <span className="leading-tight">
        <span className="block text-[15px] font-extrabold tracking-[-0.04em]">STOREFRONT</span>
        <span className="block text-[13px] text-muted-foreground">back office</span>
      </span>
    </Link>
  );
}

/** Paid orders waiting to be packed: the one queue whose count earns a place in the nav. */
function usePackQueue(enabled: boolean) {
  const params = { page: '1', status: 'paid' };
  const q = useQuery({
    queryKey: queryKeys.adminOrders(params),
    queryFn: () => api<{ orders: Order[]; total: number }>(`/admin/orders?${new URLSearchParams(params)}`),
    enabled,
  });
  return q.data?.total ?? null;
}

function NavList({ user, pathname, onNavigate }: { user: User; pathname: string; onNavigate?: () => void }) {
  const active = linkFor(pathname);
  const toPack = usePackQueue(user.permissions.includes('orders:read'));
  return (
    <nav aria-label="Back office" className="space-y-5">
      {ADMIN_GROUPS.map(group => {
        const links = group.links.filter(l => user.permissions.includes(l.permission));
        if (!links.length) return null;
        return (
          <div key={group.label ?? 'main'}>
            {group.label && <p className="mb-1 px-3 text-xs text-muted-foreground">{group.label}</p>}
            <ul className="space-y-0.5">
              {links.map(l => {
                const current = active?.href === l.href;
                return (
                  <li key={l.href}>
                    <Link
                      href={l.href}
                      onClick={onNavigate}
                      aria-current={current ? 'page' : undefined}
                      data-testid={l.testId}
                      className={cn(
                        'flex items-center gap-2.5 px-3 text-sm',
                        // Touch targets of 44px in the phone menu; a 32px row on a 34px pitch at a desk.
                        onNavigate ? 'h-11' : 'h-8',
                        current ? 'bg-secondary text-foreground' : 'text-foreground/75 hover:bg-foreground/[0.04] hover:text-foreground',
                      )}
                    >
                      <l.icon className="h-4 w-4 flex-none text-foreground/60" strokeWidth={1.5} />
                      <span className="truncate">{l.label}</span>
                      {l.href === '/admin/orders' && !!toPack && (
                        <span
                          className="ml-auto text-xs tabular-nums text-muted-foreground"
                          title={`${toPack} paid orders waiting to be packed`}
                        >
                          {fmtCount(toPack)} to pack
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}

function Account({ user, onSignOut }: { user: User; onSignOut: () => void }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2.5 px-3 py-2">
        <Initial name={user.name || user.email} />
        <div className="min-w-0 leading-tight">
          <p className="truncate text-sm font-medium">{user.name || user.email}</p>
          <p className="truncate text-xs text-muted-foreground">
            <span data-testid="admin-user-role">{ROLE_LABELS[user.role]}</span> · <span data-testid="admin-user-email">{user.email}</span>
          </p>
        </div>
      </div>
      <Link
        href="/"
        className="flex h-8 items-center gap-2.5 px-3 text-sm text-foreground/75 hover:bg-foreground/[0.04] hover:text-foreground"
      >
        <ArrowUpRight className="h-4 w-4 text-foreground/60" strokeWidth={1.5} /> View the shop
      </Link>
      <button
        type="button"
        data-testid="admin-logout-button"
        onClick={onSignOut}
        className="flex h-8 w-full items-center gap-2.5 px-3 text-sm text-foreground/75 hover:bg-foreground/[0.04] hover:text-foreground"
      >
        <LogOut className="h-4 w-4 text-foreground/60" strokeWidth={1.5} /> Sign out
      </button>
    </div>
  );
}

/**
 * The open-plane shell: a labelled 232px sidebar on the ledger ground (no fill, no rule), the mark and
 * name at the top, the signed-in staff member at the bottom. Below 1100px it folds into a 52px top bar
 * whose menu opens the same nav as a full-screen sheet.
 */
export function AdminShell({
  user,
  pathname,
  onSignOut,
  children,
}: {
  user: User;
  pathname: string;
  onSignOut: () => void;
  children: React.ReactNode;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const current = linkFor(pathname);

  return (
    <div data-surface="ledger" data-testid="admin-layout" className="min-h-screen bg-background text-foreground">
      <aside className="fixed inset-y-0 left-0 hidden w-[232px] flex-col px-3 py-5 min-[1100px]:flex">
        <Wordmark />
        <div className="mt-7 flex-1 overflow-y-auto">
          <NavList user={user} pathname={pathname} />
        </div>
        <Account user={user} onSignOut={onSignOut} />
      </aside>

      {/* Tablet and phone: the sidebar folds into a top bar and a full-screen menu. */}
      <DialogPrimitive.Root open={menuOpen} onOpenChange={setMenuOpen}>
        <div className="sticky top-0 z-30 flex h-[52px] items-center gap-3 border-b border-border bg-background px-4 min-[1100px]:hidden">
          <Link href="/admin" aria-label="STOREFRONT back office">
            <Mark />
          </Link>
          <p className="min-w-0 flex-1 truncate text-sm font-medium">{current?.label ?? 'Back office'}</p>
          <DialogPrimitive.Trigger
            data-testid="admin-menu-button"
            className="-mr-2 flex h-11 w-11 items-center justify-center transition-transform duration-150 ease-out active:scale-[0.97]"
            aria-label="Open the back office menu"
          >
            <Menu className="h-5 w-5" strokeWidth={1.5} />
          </DialogPrimitive.Trigger>
        </div>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Content
            data-surface="ledger"
            aria-describedby={undefined}
            className="fixed inset-0 z-50 flex flex-col overflow-y-auto bg-background px-4 pb-6 text-foreground ease-out data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-top-2 data-[state=closed]:duration-150 data-[state=open]:duration-200 min-[1100px]:hidden"
          >
            <div className="flex h-[52px] flex-none items-center justify-between">
              <DialogPrimitive.Title asChild>
                <div>
                  <Wordmark />
                </div>
              </DialogPrimitive.Title>
              <DialogPrimitive.Close
                className="-mr-2 flex h-11 w-11 items-center justify-center transition-transform duration-150 ease-out active:scale-[0.97]"
                aria-label="Close the menu"
              >
                <X className="h-5 w-5" strokeWidth={1.5} />
              </DialogPrimitive.Close>
            </div>
            <div className="mt-4 flex-1">
              <NavList user={user} pathname={pathname} onNavigate={() => setMenuOpen(false)} />
            </div>
            <div className="mt-6">
              <Account user={user} onSignOut={onSignOut} />
            </div>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>

      <main className="min-w-0 px-4 pb-16 pt-6 sm:px-6 min-[1100px]:ml-[232px] min-[1100px]:px-8 min-[1100px]:pt-8">
        <div className="mx-auto max-w-[1400px]">{children}</div>
      </main>
    </div>
  );
}
