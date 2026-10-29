'use client';

/*
 * Team.
 * Data: every account (name, email, role, joined date), 20 to a page, searchable by name or email and
 * filterable by role; what each role may do. Opened by the admin when someone joins or leaves, a few
 * times a month. Jobs: change a person's role (most frequent), find a person.
 *
 * Question: who can get into the back office, and with which role?
 * Finding: how many staff hold each role.
 * Face: people as themselves, an initial on a pale tint of their own hue beside the name, and each
 * role's permissions written as what they let a person do.
 */

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { BlockError, Empty, fmtCount, Initial, LoadingRows, PageHeader, plural } from '@/components/admin/ledger';
import { useAuth } from '@/components/providers';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api, fmtDate } from '@/lib/api';
import {
  permissionsFor,
  ROLE_LABELS,
  ROLES,
  STAFF_ROLES,
  type AdminUser,
  type AdminUserPage,
  type Permission,
  type Role,
  type StaffRole,
} from '@storefront/contracts';

const ALL = 'all';

/** Permissions as the things they let a person do. */
const CAN: Record<Permission, string> = {
  'dashboard:read': 'see the overview',
  'catalog:write': 'edit products',
  'orders:read': 'see orders',
  'orders:manage': 'pack, ship and refund',
  'promotions:write': 'edit promotions',
  'chats:read': 'read agent chats',
  'audit:read': 'read the audit log',
  'users:manage': 'change roles',
  'jobs:manage': 'run operations',
  'experiments:manage': 'run experiments',
};

const canSentence = (role: Role) => {
  const perms = permissionsFor(role);
  if (!perms.length) return null;
  if (perms.length === Object.keys(CAN).length) return 'Everything';
  const words = perms.map(p => CAN[p]);
  return `${words[0].charAt(0).toUpperCase()}${words[0].slice(1)}${words.length > 1 ? `, ${words.slice(1).join(', ')}` : ''}`;
};

export default function AdminUsersPage() {
  const { user: me } = useAuth();
  const [data, setData] = useState<AdminUserPage | null>(null);
  const [failed, setFailed] = useState(false);
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [role, setRole] = useState<Role | typeof ALL>(ALL);
  const [page, setPage] = useState(1);
  const [saving, setSaving] = useState<string | null>(null);
  const [staff, setStaff] = useState<Record<StaffRole, number> | null>(null);

  const load = useCallback(async () => {
    const params = new URLSearchParams({ page: String(page) });
    if (query) params.set('q', query);
    if (role !== ALL) params.set('role', role);
    try {
      setData(await api<AdminUserPage>(`/admin/users?${params}`));
      setFailed(false);
    } catch (e: unknown) {
      setFailed(true);
      toast.error((e as Error).message);
    }
  }, [page, query, role]);

  const loadStaff = useCallback(() => {
    Promise.all(STAFF_ROLES.map(r => api<AdminUserPage>(`/admin/users?role=${r}`).then(p => [r, p.total] as const)))
      .then(rows => setStaff(Object.fromEntries(rows) as Record<StaffRole, number>))
      .catch(() => setStaff(null));
  }, []);

  useEffect(() => {
    load();
  }, [load]);
  useEffect(loadStaff, [loadStaff]);

  const changeRole = async (u: AdminUser, next: Role) => {
    if (next === u.role) return;
    setSaving(u.id);
    try {
      await api(`/admin/users/${u.id}/role`, { method: 'PATCH', body: JSON.stringify({ role: next }) });
      toast.success(`${u.email} is now ${ROLE_LABELS[next]}`);
      await load();
      loadStaff();
    } catch (e: unknown) {
      toast.error((e as Error).message);
    } finally {
      setSaving(null);
    }
  };

  const staffTotal = staff ? STAFF_ROLES.reduce((s, r) => s + staff[r], 0) : 0;
  const finding = staff
    ? `${plural(staffTotal, 'person', 'people')} can sign in to the back office: ${STAFF_ROLES.filter(r => staff[r] > 0)
        .map(r => `${fmtCount(staff[r])} ${ROLE_LABELS[r].toLowerCase()}`)
        .join(', ')}.`
    : null;

  return (
    <div data-testid="admin-users-page">
      <PageHeader
        title="Team"
        finding={finding}
        actions={
          <form
            className="flex flex-wrap gap-2"
            onSubmit={e => {
              e.preventDefault();
              setPage(1);
              setQuery(q.trim());
            }}
          >
            <Input
              data-testid="users-search"
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder="Name or email"
              aria-label="Search by name or email"
              className="h-9 w-56"
            />
            <Select
              value={role}
              onValueChange={(v: Role | typeof ALL) => {
                setPage(1);
                setRole(v);
              }}
            >
              <SelectTrigger className="h-9 w-44" data-testid="users-role-filter" aria-label="Role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Every role</SelectItem>
                {ROLES.map(r => (
                  <SelectItem key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button type="submit" variant="outline" size="sm" className="h-9">
              Search
            </Button>
          </form>
        }
      />

      <section className="mt-6 border border-border bg-card">
        <div className="flex min-h-[44px] items-center justify-between px-5 pt-1 text-[13px] text-muted-foreground">
          <span className="tabular-nums">{data ? plural(data.total, 'account') : 'Loading accounts…'}</span>
          <span className="hidden sm:inline">Role changes apply at once and are written to the audit log.</span>
        </div>
        {failed && !data ? (
          <div className="px-5 pb-4">
            <BlockError what="the team" onRetry={load} />
          </div>
        ) : data === null ? (
          <LoadingRows rows={6} className="px-5" />
        ) : data.users.length === 0 ? (
          <div className="px-5 pb-5">
            <Empty>
              No account matches{query ? ` “${query}”` : ''}
              {role !== ALL ? ` with the role ${ROLE_LABELS[role]}` : ''}.
            </Empty>
          </div>
        ) : (
          <Table data-testid="users-table">
            <TableHeader>
              <TableRow>
                <TableHead className="pl-5">Person</TableHead>
                <TableHead className="hidden text-right md:table-cell">Joined</TableHead>
                <TableHead className="w-52">Role</TableHead>
                <TableHead className="hidden pr-5 lg:table-cell">Can</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.users.map(u => {
                const self = me && typeof me === 'object' && me.id === u.id;
                return (
                  <TableRow key={u.id} data-testid={`user-row-${u.email}`}>
                    <TableCell className="max-w-0 pl-5 sm:max-w-none">
                      <span className="flex items-center gap-3">
                        <Initial name={u.name || u.email} />
                        <span className="min-w-0 leading-tight">
                          <span className="block truncate font-medium">
                            {u.name || u.email}
                            {self && <span className="font-normal text-muted-foreground"> (you)</span>}
                          </span>
                          <span className="mt-0.5 block truncate text-xs text-muted-foreground">{u.email}</span>
                        </span>
                      </span>
                    </TableCell>
                    <TableCell className="hidden whitespace-nowrap text-right tabular-nums text-muted-foreground md:table-cell">
                      {fmtDate(u.createdAt)}
                    </TableCell>
                    <TableCell>
                      <Select value={u.role} disabled={!!self || saving === u.id} onValueChange={(v: Role) => changeRole(u, v)}>
                        <SelectTrigger data-testid={`user-role-${u.email}`} className="h-9" aria-label={`Role of ${u.email}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {ROLES.map(r => (
                            <SelectItem key={r} value={r}>
                              {ROLE_LABELS[r]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {self && <p className="mt-1 text-xs text-muted-foreground">You can’t change your own role.</p>}
                    </TableCell>
                    <TableCell className="hidden pr-5 text-[13px] text-muted-foreground lg:table-cell">
                      {canSentence(u.role) ?? 'Shop only, no back office'}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}

        {data && data.pages > 1 && (
          <div className="flex items-center justify-between gap-3 border-t border-border px-5 py-3 text-[13px]">
            <span className="tabular-nums text-muted-foreground">
              Page {data.page} of {data.pages}
            </span>
            <span className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
                Previous
              </Button>
              <Button variant="outline" size="sm" disabled={page >= data.pages} onClick={() => setPage(p => p + 1)}>
                Next
              </Button>
            </span>
          </div>
        )}
      </section>
    </div>
  );
}
