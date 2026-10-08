'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useAuth } from '@/components/providers';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api, fmtDate } from '@/lib/api';
import { permissionsFor, ROLE_LABELS, ROLES, type AdminUser, type AdminUserPage, type Role } from '@storefront/contracts';

const ALL = 'all';

export default function AdminUsersPage() {
  const { user: me } = useAuth();
  const [data, setData] = useState<AdminUserPage | null>(null);
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [role, setRole] = useState<Role | typeof ALL>(ALL);
  const [page, setPage] = useState(1);
  const [saving, setSaving] = useState<string | null>(null);

  const load = useCallback(async () => {
    const params = new URLSearchParams({ page: String(page) });
    if (query) params.set('q', query);
    if (role !== ALL) params.set('role', role);
    try {
      setData(await api<AdminUserPage>(`/admin/users?${params}`));
    } catch (e: unknown) {
      toast.error((e as Error).message);
    }
  }, [page, query, role]);

  useEffect(() => {
    load();
  }, [load]);

  const changeRole = async (u: AdminUser, next: Role) => {
    if (next === u.role) return;
    setSaving(u.id);
    try {
      await api(`/admin/users/${u.id}/role`, { method: 'PATCH', body: JSON.stringify({ role: next }) });
      toast.success(`${u.email} is now ${ROLE_LABELS[next]}`);
      await load();
    } catch (e: unknown) {
      toast.error((e as Error).message);
    } finally {
      setSaving(null);
    }
  };

  return (
    <div data-testid="admin-users-page">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-serif text-3xl font-semibold tracking-tight sm:text-4xl">Team & roles</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Grant least-privilege back-office access. Changes apply immediately and are recorded in the audit log.
          </p>
        </div>
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
            placeholder="Search name or email"
            className="w-56"
          />
          <Select
            value={role}
            onValueChange={(v: Role | typeof ALL) => {
              setPage(1);
              setRole(v);
            }}
          >
            <SelectTrigger className="w-44" data-testid="users-role-filter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All roles</SelectItem>
              {ROLES.map(r => (
                <SelectItem key={r} value={r}>
                  {ROLE_LABELS[r]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button type="submit" variant="outline">
            Search
          </Button>
        </form>
      </div>

      <div className="mt-6 border border-black/10 bg-white">
        {data === null ? (
          <div className="space-y-3 p-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : data.users.length === 0 ? (
          <p className="p-10 text-center text-sm text-muted-foreground">No users match.</p>
        ) : (
          <Table data-testid="users-table">
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Joined</TableHead>
                <TableHead className="w-52">Role</TableHead>
                <TableHead>Permissions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.users.map(u => {
                const self = me && typeof me === 'object' && me.id === u.id;
                return (
                  <TableRow key={u.id} data-testid={`user-row-${u.email}`}>
                    <TableCell className="text-sm">
                      <p className="font-medium">{u.name}</p>
                      <p className="text-xs text-muted-foreground">{u.email}</p>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{fmtDate(u.createdAt)}</TableCell>
                    <TableCell>
                      <Select value={u.role} disabled={!!self || saving === u.id} onValueChange={(v: Role) => changeRole(u, v)}>
                        <SelectTrigger data-testid={`user-role-${u.email}`}>
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
                      {self && <p className="mt-1 text-[11px] text-muted-foreground">You cannot change your own role.</p>}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{permissionsFor(u.role).join(', ') || '—'}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>

      {data && data.pages > 1 && (
        <div className="mt-4 flex items-center justify-center gap-3 text-sm">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
            Previous
          </Button>
          <span className="text-muted-foreground">
            Page {data.page} of {data.pages}
          </span>
          <Button variant="outline" size="sm" disabled={page >= data.pages} onClick={() => setPage(p => p + 1)}>
            Next
          </Button>
        </div>
      )}
    </div>
  );
}
