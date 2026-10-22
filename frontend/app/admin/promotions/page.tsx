'use client';

import { Archive, FlaskConical, History, Pause, Pencil, Play, Plus } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ActionEditor, ACTION_LABELS, ConditionEditor, defaultAction, defaultCondition, Field } from '@/components/promotion-rule-builder';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { api, ApiError, fmtDateTime } from '@/lib/api';
import {
  PROMOTION_STATUSES,
  PromotionInputSchema,
  type ConditionSpec,
  type Promotion,
  type PromotionInput,
  type PromotionStatus,
} from '@storefront/contracts';

interface PromotionVersion {
  version: number;
  changedBy?: string | null;
  createdAt: string;
  snapshot: Record<string, unknown>;
}

type Draft = Omit<PromotionInput, 'conditions'> & { conditions?: ConditionSpec };

const EMPTY: Draft = {
  name: '',
  description: '',
  status: 'draft',
  activation: 'auto',
  priority: 100,
  exclusive: false,
  action: defaultAction('mixAndMatch'),
};

const statusVariant = (s: PromotionStatus) =>
  s === 'active'
    ? ('success' as const)
    : s === 'paused'
      ? ('warning' as const)
      : s === 'archived'
        ? ('secondary' as const)
        : ('outline' as const);

const toLocalInput = (iso?: string) => (iso ? new Date(iso).toISOString().slice(0, 16) : '');
const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : undefined);

function toDraft(p: Promotion): Draft {
  return {
    name: p.name,
    description: p.description,
    status: p.status,
    activation: p.activation,
    code: p.code,
    priority: p.priority,
    stackGroup: p.stackGroup,
    exclusive: p.exclusive,
    conditions: p.conditions,
    action: p.action,
    startsAt: p.startsAt,
    endsAt: p.endsAt,
    usageLimit: p.usageLimit,
  };
}

/** Flattens a snapshot to `path → JSON` so two versions can be compared field by field. */
function flatten(value: unknown, prefix = '', out: Record<string, string> = {}): Record<string, string> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [k, v] of Object.entries(value)) flatten(v, prefix ? `${prefix}.${k}` : k, out);
  } else if (Array.isArray(value) && value.some(v => v && typeof v === 'object')) {
    value.forEach((v, i) => flatten(v, `${prefix}[${i}]`, out));
  } else if (value !== undefined) {
    out[prefix] = JSON.stringify(value);
  }
  return out;
}

const IGNORED = new Set(['_id', 'promotionId', 'createdBy', 'updatedBy', 'version', 'createdAt', 'updatedAt', 'usedCount']);

function diff(before: Record<string, unknown> | undefined, after: Record<string, unknown>) {
  const a = flatten(before ?? {});
  const b = flatten(after);
  return [...new Set([...Object.keys(a), ...Object.keys(b)])]
    .filter(k => !IGNORED.has(k.split(/[.[]/)[0]) && a[k] !== b[k])
    .sort()
    .map(path => ({ path, before: a[path], after: b[path] }));
}

function VersionsDialog({ promotion, onClose }: { promotion: Promotion; onClose: () => void }) {
  const [versions, setVersions] = useState<PromotionVersion[] | null>(null);
  useEffect(() => {
    api<PromotionVersion[]>(`/admin/promotions/${promotion._id}/versions`)
      .then(v => setVersions([...v].sort((x, y) => y.version - x.version)))
      .catch(e => toast.error((e as Error).message));
  }, [promotion._id]);

  return (
    <Dialog open onOpenChange={open => !open && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
        <DialogTitle className="font-serif text-xl">{promotion.name}: version history</DialogTitle>
        {!versions ? (
          <Skeleton className="h-32" />
        ) : (
          <ol className="mt-4 space-y-4" data-testid="promotion-versions">
            {versions.map((v, i) => {
              const changes = diff(versions[i + 1]?.snapshot, v.snapshot);
              return (
                <li key={v.version} className="border border-black/10 p-3">
                  <p className="text-sm font-medium">
                    v{v.version}{' '}
                    <span className="text-xs font-normal text-muted-foreground">
                      · {fmtDateTime(v.createdAt)} · {v.changedBy ?? 'system'}
                    </span>
                  </p>
                  {i === versions.length - 1 ? (
                    <p className="mt-1 text-xs text-muted-foreground">Created.</p>
                  ) : changes.length === 0 ? (
                    <p className="mt-1 text-xs text-muted-foreground">No field changes.</p>
                  ) : (
                    <table className="mt-2 w-full text-xs">
                      <tbody>
                        {changes.map(c => (
                          <tr key={c.path} className="align-top">
                            <td className="py-0.5 pr-3 font-mono">{c.path}</td>
                            <td className="py-0.5 pr-3 text-red-800 line-through">{c.before ?? '—'}</td>
                            <td className="py-0.5 text-emerald-800">{c.after ?? '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </DialogContent>
    </Dialog>
  );
}

function PromotionEditor({ initial, onDone }: { initial: Promotion | null; onDone: () => void }) {
  const [draft, setDraft] = useState<Draft>(initial ? toDraft(initial) : EMPTY);
  const [problems, setProblems] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft(d => ({ ...d, [key]: value }));

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const candidate = { ...draft, code: draft.activation === 'code' ? draft.code : undefined, stackGroup: draft.stackGroup || undefined };
    const parsed = PromotionInputSchema.safeParse(candidate);
    if (!parsed.success) {
      setProblems(parsed.error.issues.map(i => `${i.path.join('.') || 'promotion'}: ${i.message}`));
      return;
    }
    setProblems([]);
    setSaving(true);
    try {
      if (initial) {
        await api(`/admin/promotions/${initial._id}`, {
          method: 'PUT',
          headers: { 'If-Match': `"${initial.version}"` },
          body: JSON.stringify(parsed.data),
        });
        toast.success(`Saved ${parsed.data.name} as v${initial.version + 1}`);
      } else {
        await api('/admin/promotions', { method: 'POST', body: JSON.stringify(parsed.data) });
        toast.success(`Created ${parsed.data.name}`);
      }
      onDone();
    } catch (err) {
      const message =
        err instanceof ApiError && err.status === 409
          ? 'Someone else changed this promotion; reload and try again.'
          : (err as Error).message;
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={save} className="mt-6 space-y-6 border border-black/10 bg-white p-5" data-testid="promotion-editor">
      <div className="flex items-center justify-between">
        <h2 className="font-serif text-xl font-semibold">{initial ? `Edit ${initial.name} (v${initial.version})` : 'New promotion'}</h2>
        <Button type="button" variant="ghost" size="sm" onClick={onDone}>
          Cancel
        </Button>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <Field label="Name" className="md:col-span-2">
          <Input value={draft.name} onChange={e => set('name', e.target.value)} className="mt-1 h-9" data-testid="promotion-name" />
        </Field>
        <Field label="Status">
          <select
            value={draft.status}
            onChange={e => set('status', e.target.value as PromotionStatus)}
            className="mt-1 h-9 w-full border border-black/15 bg-white px-2 text-sm"
          >
            {PROMOTION_STATUSES.map(s => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </Field>
        <Field label="Description (shown to customers)" className="md:col-span-3">
          <Textarea value={draft.description} onChange={e => set('description', e.target.value)} rows={2} className="mt-1" />
        </Field>
        <Field label="Applies">
          <select
            value={draft.activation}
            onChange={e => set('activation', e.target.value as Draft['activation'])}
            className="mt-1 h-9 w-full border border-black/15 bg-white px-2 text-sm"
          >
            <option value="auto">Automatically</option>
            <option value="code">With a promo code</option>
          </select>
        </Field>
        {draft.activation === 'code' && (
          <Field label="Code">
            <Input value={draft.code ?? ''} onChange={e => set('code', e.target.value.toUpperCase())} className="mt-1 h-9 font-mono" />
          </Field>
        )}
        <Field label="Priority (higher wins ties)">
          <Input type="number" value={draft.priority} onChange={e => set('priority', Number(e.target.value))} className="mt-1 h-9" />
        </Field>
        <Field label="Stack group (one winner per group)">
          <Input
            value={draft.stackGroup ?? ''}
            onChange={e => set('stackGroup', e.target.value)}
            placeholder="order-discount"
            className="mt-1 h-9"
          />
        </Field>
        <Field label="Usage limit (optional)">
          <Input
            type="number"
            min={1}
            value={draft.usageLimit ?? ''}
            onChange={e => set('usageLimit', e.target.value ? Number(e.target.value) : undefined)}
            className="mt-1 h-9"
          />
        </Field>
        <label className="flex items-center gap-2 self-end pb-2 text-sm">
          <input type="checkbox" checked={draft.exclusive} onChange={e => set('exclusive', e.target.checked)} />
          Exclusive (never combines with other promotions)
        </label>
        <Field label="Starts">
          <Input
            type="datetime-local"
            value={toLocalInput(draft.startsAt)}
            onChange={e => set('startsAt', fromLocalInput(e.target.value))}
            className="mt-1 h-9"
          />
        </Field>
        <Field label="Ends">
          <Input
            type="datetime-local"
            value={toLocalInput(draft.endsAt)}
            onChange={e => set('endsAt', fromLocalInput(e.target.value))}
            className="mt-1 h-9"
          />
        </Field>
      </div>

      <div>
        <h3 className="label-caps text-muted-foreground">Discount</h3>
        <div className="mt-2">
          <ActionEditor value={draft.action} onChange={action => set('action', action)} />
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between">
          <h3 className="label-caps text-muted-foreground">Conditions</h3>
          {draft.conditions ? (
            <Button type="button" size="sm" variant="ghost" onClick={() => set('conditions', undefined)}>
              Remove all conditions
            </Button>
          ) : (
            <Button type="button" size="sm" variant="outline" onClick={() => set('conditions', defaultCondition('all'))}>
              <Plus className="mr-1 h-4 w-4" /> Add conditions
            </Button>
          )}
        </div>
        <div className="mt-2">
          {draft.conditions ? (
            <ConditionEditor value={draft.conditions} onChange={c => set('conditions', c)} />
          ) : (
            <p className="text-sm text-muted-foreground">Applies to every cart that the discount itself can apply to.</p>
          )}
        </div>
      </div>

      {problems.length > 0 && (
        <ul className="space-y-1 bg-red-50 p-3 text-xs text-red-900" data-testid="promotion-problems">
          {problems.map(p => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}

      <div className="flex gap-3">
        <Button type="submit" disabled={saving} data-testid="promotion-save">
          {saving ? 'Saving…' : initial ? 'Save new version' : 'Create promotion'}
        </Button>
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer select-none py-3">Rule JSON</summary>
          <pre className="mt-2 max-h-64 overflow-auto bg-black/5 p-3">{JSON.stringify(draft, null, 2)}</pre>
        </details>
      </div>
    </form>
  );
}

export default function AdminPromotionsPage() {
  const [promotions, setPromotions] = useState<Promotion[] | null>(null);
  const [filter, setFilter] = useState<PromotionStatus | 'all'>('all');
  const [editing, setEditing] = useState<Promotion | null | 'new'>(null);
  const [history, setHistory] = useState<Promotion | null>(null);

  const load = useCallback(() => {
    api<Promotion[]>(`/admin/promotions${filter === 'all' ? '' : `?status=${filter}`}`)
      .then(setPromotions)
      .catch(e => toast.error((e as Error).message));
  }, [filter]);
  useEffect(load, [load]);

  const setStatus = async (p: Promotion, status: PromotionStatus) => {
    try {
      if (status === 'archived') await api(`/admin/promotions/${p._id}`, { method: 'DELETE' });
      else
        await api(`/admin/promotions/${p._id}`, {
          method: 'PUT',
          headers: { 'If-Match': `"${p.version}"` },
          body: JSON.stringify({ status }),
        });
      load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const sorted = useMemo(
    () => [...(promotions ?? [])].sort((a, b) => b.priority - a.priority || a.name.localeCompare(b.name)),
    [promotions],
  );

  return (
    <div data-testid="admin-promotions-page">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-serif text-3xl font-semibold tracking-tight sm:text-4xl">Promotions</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Rules are data: conditions combine with AND/OR/NOT, each discount is a strategy, and the optimizer picks the cheapest valid
            combination for every cart. Every save is a new immutable version.
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/admin/promotions/simulator">
            <Button variant="outline" size="sm">
              <FlaskConical className="mr-2 h-4 w-4" /> Simulator
            </Button>
          </Link>
          <Button size="sm" onClick={() => setEditing('new')} data-testid="promotion-new">
            <Plus className="mr-2 h-4 w-4" /> New promotion
          </Button>
        </div>
      </div>

      {editing && (
        <PromotionEditor
          key={editing === 'new' ? 'new' : `${editing._id}:${editing.version}`}
          initial={editing === 'new' ? null : editing}
          onDone={() => {
            setEditing(null);
            load();
          }}
        />
      )}

      <div className="mt-6 flex gap-1">
        {(['all', ...PROMOTION_STATUSES] as const).map(s => (
          <Button key={s} size="sm" variant={filter === s ? 'default' : 'ghost'} onClick={() => setFilter(s)}>
            {s}
          </Button>
        ))}
      </div>

      <div className="mt-3 border border-black/10 bg-white">
        {promotions === null ? (
          <Skeleton className="m-4 h-32" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Promotion</TableHead>
                <TableHead>Discount</TableHead>
                <TableHead>Applies</TableHead>
                <TableHead className="text-right">Used</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-sm text-muted-foreground">
                    No promotions match.
                  </TableCell>
                </TableRow>
              )}
              {sorted.map(p => (
                <TableRow key={p._id} data-testid={`promotion-${p._id}`}>
                  <TableCell>
                    <p className="font-medium">{p.name}</p>
                    <p className="text-xs text-muted-foreground">
                      v{p.version} · priority {p.priority}
                      {p.stackGroup && ` · group ${p.stackGroup}`}
                      {p.exclusive && ' · exclusive'}
                    </p>
                  </TableCell>
                  <TableCell className="text-sm">{ACTION_LABELS[p.action.type]}</TableCell>
                  <TableCell className="text-sm">
                    {p.activation === 'code' ? <span className="font-mono">{p.code}</span> : 'Automatic'}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {p.usedCount}
                    {p.usageLimit ? ` / ${p.usageLimit}` : ''}
                  </TableCell>
                  <TableCell>
                    <Badge variant={statusVariant(p.status)}>{p.status}</Badge>
                  </TableCell>
                  <TableCell className="space-x-1 whitespace-nowrap text-right">
                    <Button size="sm" variant="ghost" onClick={() => setEditing(p)} aria-label={`Edit ${p.name}`}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setHistory(p)} aria-label={`History of ${p.name}`}>
                      <History className="h-4 w-4" />
                    </Button>
                    {p.status !== 'active' && p.status !== 'archived' && (
                      <Button size="sm" variant="ghost" onClick={() => setStatus(p, 'active')} aria-label={`Activate ${p.name}`}>
                        <Play className="h-4 w-4" />
                      </Button>
                    )}
                    {p.status === 'active' && (
                      <Button size="sm" variant="ghost" onClick={() => setStatus(p, 'paused')} aria-label={`Pause ${p.name}`}>
                        <Pause className="h-4 w-4" />
                      </Button>
                    )}
                    {p.status !== 'archived' && (
                      <Button size="sm" variant="ghost" onClick={() => setStatus(p, 'archived')} aria-label={`Archive ${p.name}`}>
                        <Archive className="h-4 w-4" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
      {history && <VersionsDialog promotion={history} onClose={() => setHistory(null)} />}
    </div>
  );
}
