'use client';

import { User as UserIcon } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useAuth, useCart } from '@/components/providers';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { isStaff } from '@storefront/contracts';

/** The bar keeps to five links: the four departments (which together are the whole catalogue) and the offers. */
const NAV = [
  { label: 'Men', href: '/products?category=Men', testId: 'nav-link-men' },
  { label: 'Women', href: '/products?category=Women', testId: 'nav-link-women' },
  { label: 'Footwear', href: '/products?category=Footwear', testId: 'nav-link-footwear' },
  { label: 'Accessories', href: '/products?category=Accessories', testId: 'nav-link-accessories' },
  { label: 'Offers', href: '/offers', testId: 'nav-link-offers' },
];
/** The phone menu has room for the whole catalogue as its first line. */
const PHONE_NAV = [{ label: 'Shop all', href: '/products', testId: 'nav-link-shop-all' }, ...NAV.map(n => ({ ...n, testId: undefined }))];

const barButton =
  'flex h-10 items-center gap-2 px-2 text-[15px] font-medium transition-[background-color,transform] duration-150 ease-out hover:bg-foreground/[0.06] active:scale-[0.97]';

/** A plain bar on the page ground: the wordmark, five links, the account and the bag. */
export function Navbar() {
  const { user, logout } = useAuth();
  const { count, setOpen } = useCart();
  const router = useRouter();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  // A navigation always closes the phone menu.
  useEffect(() => setMenuOpen(false), [pathname]);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenuOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  return (
    <header className="sticky top-0 z-40 bg-background">
      <div className="mx-auto flex h-16 max-w-[1760px] items-center justify-between gap-6 px-4 sm:px-8">
        <Link href="/" data-testid="nav-logo" className="-ml-0.5 text-2xl font-extrabold tracking-[-0.05em]">
          STOREFRONT
        </Link>

        <nav aria-label="Main" className="hidden items-center gap-1 lg:flex">
          {NAV.map(n => (
            <Link
              key={n.href}
              href={n.href}
              data-testid={n.testId}
              className="whitespace-nowrap px-2.5 py-2 text-[15px] font-medium underline-offset-[6px] decoration-[1.5px] hover:underline"
            >
              {n.label}
            </Link>
          ))}
        </nav>

        <div className="-mr-2 flex items-center gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button data-testid="nav-account-button" className={barButton} aria-label="Account">
                <UserIcon className="h-5 w-5 sm:hidden" strokeWidth={1.75} aria-hidden />
                <span className="hidden sm:inline">Account</span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {user && typeof user === 'object' ? (
                <>
                  <DropdownMenuLabel data-testid="nav-account-name">{user.name}</DropdownMenuLabel>
                  <DropdownMenuItem data-testid="nav-orders-link" onClick={() => router.push('/orders')}>
                    My orders
                  </DropdownMenuItem>
                  {isStaff(user.role) && (
                    <DropdownMenuItem data-testid="nav-admin-link" onClick={() => router.push('/admin')}>
                      Back office
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem data-testid="nav-logout-button" onClick={() => logout()}>
                    Sign out
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
            className={barButton}
            aria-label={count > 0 ? `Open bag, ${count} item${count === 1 ? '' : 's'}` : 'Open bag'}
          >
            Bag
            {count > 0 && (
              <span
                data-testid="nav-cart-count"
                className="flex h-6 min-w-6 items-center justify-center bg-primary px-1.5 text-[13px] font-semibold text-primary-foreground"
              >
                {count}
              </span>
            )}
          </button>

          <button
            type="button"
            className={cn(barButton, 'lg:hidden')}
            aria-expanded={menuOpen}
            aria-controls="phone-menu"
            onClick={() => setMenuOpen(o => !o)}
          >
            {menuOpen ? 'Close' : 'Menu'}
          </button>
        </div>
      </div>

      {/* Always mounted (hidden while closed) so every link and test hook exists; showing it replays the entrance. */}
      <nav
        id="phone-menu"
        aria-label="Main"
        hidden={!menuOpen}
        className="absolute inset-x-0 top-16 h-[calc(100svh-4rem)] overflow-y-auto bg-background px-4 pb-10 pt-4 ease-out animate-in fade-in-0 slide-in-from-top-2 duration-200 lg:hidden"
      >
        <ul className="space-y-1">
          {PHONE_NAV.map(n => (
            <li key={n.href}>
              <Link
                href={n.href}
                data-testid={n.testId}
                onClick={() => setMenuOpen(false)}
                className="block py-2 text-display-md font-extrabold transition-transform duration-150 ease-out active:scale-[0.98]"
              >
                {n.label}
              </Link>
            </li>
          ))}
        </ul>
        <p className="mt-10 text-base">
          <Link href="/orders" onClick={() => setMenuOpen(false)} className="underline underline-offset-4">
            Track an order
          </Link>
        </p>
      </nav>
    </header>
  );
}
