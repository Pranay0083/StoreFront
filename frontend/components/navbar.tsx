'use client';

import { LayoutDashboard, LogOut, Package, ShoppingBag, User as UserIcon } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth, useCart } from '@/components/providers';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

const NAV = [
  { label: 'Shop All', href: '/products' },
  { label: 'Men', href: '/products?category=Men' },
  { label: 'Women', href: '/products?category=Women' },
  { label: 'Footwear', href: '/products?category=Footwear' },
  { label: 'Accessories', href: '/products?category=Accessories' },
];

export function Navbar() {
  const { user, logout } = useAuth();
  const { count, setOpen } = useCart();
  const router = useRouter();

  return (
    <header className="sticky top-0 z-40 border-b border-black/5 bg-white/70 backdrop-blur-xl backdrop-saturate-150">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-6 px-5 sm:px-8">
        <Link href="/" data-testid="nav-logo" className="font-serif text-2xl font-semibold tracking-tight">
          STOREFRONT<span className="text-muted-foreground">.</span>
        </Link>

        <nav className="hidden items-center gap-7 md:flex">
          {NAV.map(n => (
            <Link
              key={n.label}
              href={n.href}
              data-testid={`nav-link-${n.label.toLowerCase().replace(/\s/g, '-')}`}
              className="label-caps text-foreground/70 transition-colors hover:text-foreground"
            >
              {n.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                data-testid="nav-account-button"
                className="flex h-10 w-10 items-center justify-center transition-colors hover:bg-black/5"
                aria-label="Account"
              >
                <UserIcon className="h-5 w-5" strokeWidth={1.5} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {user && typeof user === 'object' ? (
                <>
                  <DropdownMenuLabel data-testid="nav-account-name">{user.name}</DropdownMenuLabel>
                  <DropdownMenuItem data-testid="nav-orders-link" onClick={() => router.push('/orders')}>
                    <Package className="h-4 w-4" /> My orders
                  </DropdownMenuItem>
                  {user.role === 'admin' && (
                    <DropdownMenuItem data-testid="nav-admin-link" onClick={() => router.push('/admin')}>
                      <LayoutDashboard className="h-4 w-4" /> Admin dashboard
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem data-testid="nav-logout-button" onClick={() => logout()}>
                    <LogOut className="h-4 w-4" /> Sign out
                  </DropdownMenuItem>
                </>
              ) : (
                <>
                  <DropdownMenuItem data-testid="nav-login-link" onClick={() => router.push('/login')}>
                    Sign in
                  </DropdownMenuItem>
                  <DropdownMenuItem data-testid="nav-register-link" onClick={() => router.push('/register')}>
                    Create account
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          <button
            data-testid="nav-cart-button"
            onClick={() => setOpen(true)}
            className="relative flex h-10 w-10 items-center justify-center transition-colors hover:bg-black/5"
            aria-label="Cart"
          >
            <ShoppingBag className="h-5 w-5" strokeWidth={1.5} />
            {count > 0 && (
              <span
                data-testid="nav-cart-count"
                className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center bg-black px-1 text-[10px] font-semibold text-white"
              >
                {count}
              </span>
            )}
          </button>
        </div>
      </div>

      <nav className="flex gap-5 overflow-x-auto border-t border-black/5 px-5 py-2.5 md:hidden">
        {NAV.map(n => (
          <Link key={n.label} href={n.href} className="label-caps whitespace-nowrap text-foreground/70">
            {n.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
