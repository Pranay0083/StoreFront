'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { AdminShell, linkFor, Mark } from '@/components/admin/shell';
import { LoadingBar } from '@/components/admin/ledger';
import { useAuth } from '@/components/providers';
import { isStaff, ROLE_LABELS, type User } from '@storefront/contracts';

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
    // The shell's frame while the session loads: the mark, the sidebar's place and a title bar.
    return (
      <div data-surface="ledger" className="min-h-screen bg-background">
        <div className="flex items-center gap-2.5 px-5 py-5">
          <Mark />
          <LoadingBar className="h-4 w-36" />
        </div>
        <div className="px-4 sm:px-6 min-[1100px]:ml-[232px] min-[1100px]:px-8">
          <LoadingBar className="h-7 w-48" />
          <LoadingBar className="mt-6 h-64 w-full" />
        </div>
      </div>
    );
  }

  const current = linkFor(pathname);
  const forbidden = current && !user.permissions.includes(current.permission);

  return (
    <AdminShell
      user={user}
      pathname={pathname}
      onSignOut={async () => {
        await logout();
        router.replace('/');
      }}
    >
      {forbidden ? (
        <div className="max-w-xl">
          <h1 className="text-2xl font-semibold tracking-[-0.02em]">{current.label}</h1>
          <p className="mt-2 text-[15px] text-muted-foreground" data-testid="admin-forbidden">
            Your role ({ROLE_LABELS[user.role]}) does not include access to {current.label.toLowerCase()}. An admin can change your role
            under Team.
          </p>
        </div>
      ) : (
        children
      )}
    </AdminShell>
  );
}
