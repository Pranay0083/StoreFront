'use client';

import { Archive, History, Pause, Play } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api, fmtDate, fmtDateTime, fmtINR } from '@/lib/api';
import { PROMOTION_STATUSES, type ActionSpec, type Promotion, type PromotionStatus } from '@storefront/contracts';

interface PromotionVersion {
  version: number;
  changedBy?: string | null;
  createdAt: string;
  snapshot: Record<string, unknown>;
}

const STATUS_VARIANT: Record<PromotionStatus, 'success' | 'secondary' | 'warning' | 'outline'> = {
  active: 'success',
  draft: 'outline',
  paused: 'warning',
  archived: 'secondary',
};

function describeAction(a: ActionSpec): string {
  switch (a.type) {
    case 'fixedBundle':
      return `Bundle of ${a.components.reduce((s, c) => s + c.qty, 0)} for ${fmtINR(a.price)}`;
    case 'mixAndMatch':
      return `Any ${a.quantity} for ${fmtINR(a.price)}`;
    case 'buyXGetY':
      return `Buy ${a.buyQty}, get ${a.getQty} ${a.percentOff === 100 ? 'free' : `${a.percentOff}% off`}`;
    case 'tiered':
      return `Tiered: ${a.tiers.map(t => `${t.percentOff ? `${t.percentOff}%` : fmtINR(t.amountOff ?? 0)} over ${fmtINR(t.minSubtotal)}`).join(', ')}`;
    case 'percentOff':
      return `${a.percent}% off${a.maxDiscount ? ` (max ${fmtINR(a.maxDiscount)})` : ''}`;
    case 'flatOff':
      return `${fmtINR(a.amount)} off`;
    case 'freeShipping':
      return 'Free shipping';
    case 'markdown':
      return `${a.percentOff}% markdown`;
    case 'clearance':
      return `${a.percentOff}% clearance (stock ≥ ${a.minStock}, ${a.minAgeDays}+ days old)`;
  }
}

function windowOf(p: Promotion): string {
  if (!p.startsAt && !p.endsAt) return 'Always';
  return `${p.startsAt ? fmtDate(p.startsAt) : '…'} – ${p.endsAt ? fmtDate(p.endsAt) : '…'}`;
}

export default function AdminPromotionsPage() {
  const [promotions, setPromotions] = useState<Promotion[] | null>(null);
  const [status, setStatus] = useState<PromotionStatus | 'all'>('all');
  const [history, setHistory] = useState<{ promotion: Promotion; versions: PromotionVersion[] } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    api<Promotion[]>(`/admin/promotions${status === 'all' ? '' : `?status=${status}`}`)
      .then(setPromotions)
      .catch(() => setPromotions([]));
  }, [status]);

  useEffect(() => {
    load();
  }, [load]);

  const setPromotionStatus = async (p: Promotion, next: PromotionStatus) => {
    setBusy(p._id);
    try {
      if (next === 'archived') await api(`/admin/promotions/${p._id}`, { method: 'DELETE' });
      else
        await api(`/admin/promotions/${p._id}`, {
          method: 'PUT',
          headers: { 'If-Match': `"${p.version}"` },
          body: JSON.stringify({ status: next }),
        });
      toast.success(`${p.name} is now ${next}`);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not update the promotion');
      load();
    } finally {
      setBusy(null);
    }
  };

  const showHistory = async (p: Promotion) => {
    try {
      setHistory({ promotion: p, versions: await api<PromotionVersion[]>(`/admin/promotions/${p._id}/versions`) });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not load versions');
    }
  };

  return (
    <div data-testid="admin-promotions-page">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-serif text-3xl font-semibold tracking-tight sm:text-4xl">Promotions</h1>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">
            Automatic offers and promo codes. The pricing engine picks the cheapest valid combination for every bag; usage is counted when
            an order is placed and given back if it is cancelled or fully refunded.
          </p>
        </div>
        <Select value={status} onValueChange={v => setStatus(v as PromotionStatus | 'all')}>
          <SelectTrigger className="w-40" data-testid="promotions-status-filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {PROMOTION_STATUSES.map(s => (
              <SelectItem key={s} value={s} className="capitalize">
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="mt-6 border border-black/10 bg-white">
        {promotions === null ? (
          <div className="space-y-3 p-6">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : promotions.length === 0 ? (
          <p className="p-10 text-center text-sm text-muted-foreground">No promotions match this filter.</p>
        ) : (
          <Table data-testid="promotions-table">
            <TableHeader>
              <TableRow>
                <TableHead>Promotion</TableHead>
                <TableHead>Offer</TableHead>
                <TableHead>Stacking</TableHead>
                <TableHead>Used</TableHead>
                <TableHead>Window</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-32">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {promotions.map(p => (
                <TableRow key={p._id} data-testid={`promotion-row-${p._id}`}>
                  <TableCell>
                    <p className="text-sm font-medium">{p.name}</p>
                    {p.code && <p className="font-mono text-xs text-muted-foreground">{p.code}</p>}
                  </TableCell>
                  <TableCell className="text-sm">{describeAction(p.action)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {p.exclusive ? 'Exclusive' : (p.stackGroup ?? 'Stacks')} · priority {p.priority}
                  </TableCell>
                  <TableCell className="text-sm">
                    {p.usedCount}
                    {p.usageLimit ? ` / ${p.usageLimit}` : ''}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{windowOf(p)}</TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[p.status]}>{p.status}</Badge>
                    <span className="ml-1 text-[11px] text-muted-foreground">v{p.version}</span>
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      {p.status !== 'active' && p.status !== 'archived' && (
                        <IconButton label="Activate" disabled={busy === p._id} onClick={() => setPromotionStatus(p, 'active')}>
                          <Play className="h-3.5 w-3.5" strokeWidth={1.5} />
                        </IconButton>
                      )}
                      {p.status === 'active' && (
                        <IconButton label="Pause" disabled={busy === p._id} onClick={() => setPromotionStatus(p, 'paused')}>
                          <Pause className="h-3.5 w-3.5" strokeWidth={1.5} />
                        </IconButton>
                      )}
                      <IconButton label="Version history" onClick={() => showHistory(p)}>
                        <History className="h-3.5 w-3.5" strokeWidth={1.5} />
                      </IconButton>
                      {p.status !== 'archived' && (
                        <IconButton label="Archive" disabled={busy === p._id} onClick={() => setPromotionStatus(p, 'archived')} danger>
                          <Archive className="h-3.5 w-3.5" strokeWidth={1.5} />
                        </IconButton>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      <Dialog open={history !== null} onOpenChange={o => !o && setHistory(null)}>
        <DialogContent className="max-h-[80vh] overflow-y-auto">
          <DialogTitle className="font-serif text-2xl">{history?.promotion.name} — versions</DialogTitle>
          <ol className="mt-4 space-y-4">
            {history?.versions.map(v => (
              <li key={v.version} className="border border-black/10 p-3">
                <p className="text-sm font-medium">
                  Version {v.version}
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    {fmtDateTime(v.createdAt)}
                    {v.changedBy ? ` · ${v.changedBy}` : ''}
                  </span>
                </p>
                <pre className="mt-2 overflow-x-auto bg-muted p-2 text-[11px] leading-relaxed">{JSON.stringify(v.snapshot, null, 2)}</pre>
              </li>
            ))}
          </ol>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function IconButton({
  label,
  onClick,
  disabled,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={`flex h-8 w-8 items-center justify-center disabled:opacity-40 ${
        danger ? 'text-muted-foreground hover:bg-destructive/10 hover:text-destructive' : 'hover:bg-black/5'
      }`}
    >
      {children}
    </button>
  );
}
