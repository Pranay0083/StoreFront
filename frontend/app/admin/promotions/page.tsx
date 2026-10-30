'use client';

/*
 * Promotions.
 * Data: every promotion (name, status, how it applies, priority, stack group, exclusivity, the
 * condition tree, the discount strategy, its window, times used against its limit) and each one's
 * immutable version history. Opened by the catalogue manager a few times a week. Jobs: create or edit
 * an offer (most frequent), check it in the simulator, pause or archive it.
 *
 * Question: which offers are live, and are they being used?
 * Finding: how many offers are live and which has been used most.
 * Face: uses against the limit as a short track in the data hue, the one figure that says an offer works.
 */

import { Archive, FlaskConical, History, Pause, Pencil, Play, Plus } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  BlockError,
  Dash,
  Empty,
  FieldLabel,
  fmtCount,
  fmtWhen,
  LoadingRows,
  PageHeader,
  Pill,
  plural,
  selectClass,
  Tabs,
  type PillTone,
} from '@/components/admin/ledger';
import { ActionEditor, ACTION_LABELS, ConditionEditor, defaultAction, defaultCondition } from '@/components/promotion-rule-builder';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { api, ApiError } from '@/lib/api';
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

const STATUS_LABEL: Record<PromotionStatus, string> = { draft: 'Draft', active: 'Live', paused: 'Paused', archived: 'Archived' };
const STATUS_TONE: Record<PromotionStatus, PillTone> = { draft: 'neutral', active: 'positive', paused: 'warning', archived: 'neutral' };

const toLocalInput = (iso?: string) => (iso ? new Date(iso).toISOString().slice(0, 16) : '');
const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : undefined);
const day = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

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
  const [failed, setFailed] = useState(false);
  const fetchVersions = useCallback(() => {
    setFailed(false);
    api<PromotionVersion[]>(`/admin/promotions/${promotion._id}/versions`)
      .then(v => setVersions([...v].sort((x, y) => y.version - x.version)))
      .catch(() => setFailed(true));
  }, [promotion._id]);
  useEffect(fetchVersions, [fetchVersions]);

  return (
    <Dialog open onOpenChange={open => !open && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto" data-surface="ledger">
        <DialogTitle className="text-xl font-semibold tracking-[-0.02em]">{promotion.name}</DialogTitle>
        <DialogDescription className="-mt-2 text-sm text-muted-foreground">
          Every save is a new version; orders keep the version they were priced with.
        </DialogDescription>
        {failed ? (
          <BlockError what="the version history" onRetry={fetchVersions} />
        ) : !versions ? (
          <LoadingRows rows={3} />
        ) : (
          <ol className="divide-y divide-border" data-testid="promotion-versions">
            {versions.map((v, i) => {
              const changes = diff(versions[i + 1]?.snapshot, v.snapshot);
              return (
                <li key={v.version} className="py-3">
                  <p className="text-sm">
                    <span className="font-semibold">Version {v.version}</span>{' '}
                    <span className="text-muted-foreground">
                      · {fmtWhen(v.createdAt)} · {v.changedBy ?? 'system'}
                    </span>
                  </p>
                  {i === versions.length - 1 ? (
                    <p className="mt-1 text-[13px] text-muted-foreground">Created.</p>
                  ) : changes.length === 0 ? (
                    <p className="mt-1 text-[13px] text-muted-foreground">Saved with no field changes.</p>
                  ) : (
                    <table className="mt-2 w-full text-[13px]">
                      <thead>
                        <tr className="text-left text-xs text-muted-foreground">
                          <th className="w-1/3 pb-1 font-normal">Field</th>
                          <th className="pb-1 font-normal">Before</th>
                          <th className="pb-1 font-normal">After</th>
                        </tr>
                      </thead>
                      <tbody>
                        {changes.map(c => (
                          <tr key={c.path} className="align-top">
                            <td className="break-all py-0.5 pr-3">{c.path}</td>
                            <td className="break-all py-0.5 pr-3 text-muted-foreground line-through">{c.before ?? '—'}</td>
                            <td className="break-all py-0.5 font-medium">{c.after ?? '—'}</td>
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
        toast.success(`Saved ${parsed.data.name} as version ${initial.version + 1}`);
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
    <form onSubmit={save} className="mt-6 border border-border bg-card" data-testid="promotion-editor">
      <header className="flex items-center justify-between gap-4 border-b border-border px-5 py-4">
        <h2 className="text-base font-semibold">{initial ? `Edit ${initial.name}, version ${initial.version}` : 'New promotion'}</h2>
        <Button type="button" variant="ghost" size="sm" onClick={onDone}>
          Cancel
        </Button>
      </header>

      <div className="grid gap-8 px-5 py-5 lg:grid-cols-[240px_minmax(0,1fr)]">
        <div>
          <h3 className="text-sm font-semibold">The offer</h3>
          <p className="mt-1 text-[13px] text-muted-foreground">Its name, what customers read at checkout, and when it runs.</p>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          <FieldLabel label="Name" className="md:col-span-2">
            <Input value={draft.name} onChange={e => set('name', e.target.value)} className="h-9" data-testid="promotion-name" />
          </FieldLabel>
          <FieldLabel label="Status">
            <select value={draft.status} onChange={e => set('status', e.target.value as PromotionStatus)} className={selectClass}>
              {PROMOTION_STATUSES.map(s => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </FieldLabel>
          <FieldLabel label="Description" hint="Shown to customers" className="md:col-span-3">
            <Textarea value={draft.description} onChange={e => set('description', e.target.value)} rows={2} />
          </FieldLabel>
          <FieldLabel label="Starts">
            <Input
              type="datetime-local"
              value={toLocalInput(draft.startsAt)}
              onChange={e => set('startsAt', fromLocalInput(e.target.value))}
              className="h-9"
            />
          </FieldLabel>
          <FieldLabel label="Ends">
            <Input
              type="datetime-local"
              value={toLocalInput(draft.endsAt)}
              onChange={e => set('endsAt', fromLocalInput(e.target.value))}
              className="h-9"
            />
          </FieldLabel>
          <FieldLabel label="Usage limit" hint="Optional">
            <Input
              type="number"
              min={1}
              value={draft.usageLimit ?? ''}
              onChange={e => set('usageLimit', e.target.value ? Number(e.target.value) : undefined)}
              className="h-9"
            />
          </FieldLabel>
        </div>

        <div className="border-t border-border pt-6 lg:col-span-2 lg:grid lg:grid-cols-[240px_minmax(0,1fr)] lg:gap-8">
          <div>
            <h3 className="text-sm font-semibold">How it combines</h3>
            <p className="mt-1 text-[13px] text-muted-foreground">
              The optimizer picks the cheapest valid combination; one winner per stack group, higher priority wins ties.
            </p>
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-3 lg:mt-0">
            <FieldLabel label="Applies">
              <select
                value={draft.activation}
                onChange={e => set('activation', e.target.value as Draft['activation'])}
                className={selectClass}
              >
                <option value="auto">Automatically</option>
                <option value="code">With a promo code</option>
              </select>
            </FieldLabel>
            {draft.activation === 'code' ? (
              <FieldLabel label="Code">
                <Input value={draft.code ?? ''} onChange={e => set('code', e.target.value.toUpperCase())} className="h-9 uppercase" />
              </FieldLabel>
            ) : (
              <div className="hidden md:block" />
            )}
            <FieldLabel label="Priority">
              <Input type="number" value={draft.priority} onChange={e => set('priority', Number(e.target.value))} className="h-9" />
            </FieldLabel>
            <FieldLabel label="Stack group" hint="Optional">
              <Input
                value={draft.stackGroup ?? ''}
                onChange={e => set('stackGroup', e.target.value)}
                placeholder="order-discount"
                className="h-9"
              />
            </FieldLabel>
            <label className="flex items-center gap-2.5 self-end pb-2 text-sm md:col-span-2">
              <input
                type="checkbox"
                className="h-4 w-4 accent-foreground"
                checked={draft.exclusive}
                onChange={e => set('exclusive', e.target.checked)}
              />
              Exclusive: never combines with other promotions
            </label>
          </div>
        </div>

        <div className="border-t border-border pt-6 lg:col-span-2 lg:grid lg:grid-cols-[240px_minmax(0,1fr)] lg:gap-8">
          <div>
            <h3 className="text-sm font-semibold">Discount</h3>
            <p className="mt-1 text-[13px] text-muted-foreground">What the customer gets.</p>
          </div>
          <div className="mt-4 lg:mt-0">
            <ActionEditor value={draft.action} onChange={action => set('action', action)} />
          </div>
        </div>

        <div className="border-t border-border pt-6 lg:col-span-2 lg:grid lg:grid-cols-[240px_minmax(0,1fr)] lg:gap-8">
          <div>
            <h3 className="text-sm font-semibold">Conditions</h3>
            <p className="mt-1 text-[13px] text-muted-foreground">Which carts qualify. Combine with all of, any of and not.</p>
          </div>
          <div className="mt-4 space-y-3 lg:mt-0">
            {draft.conditions ? (
              <>
                <ConditionEditor value={draft.conditions} onChange={c => set('conditions', c)} />
                <Button type="button" size="sm" variant="ghost" onClick={() => set('conditions', undefined)}>
                  Remove all conditions
                </Button>
              </>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-3 border border-dashed border-input px-4 py-3">
                <p className="text-sm text-muted-foreground">Every cart the discount can apply to qualifies.</p>
                <Button type="button" size="sm" variant="outline" onClick={() => set('conditions', defaultCondition('all'))}>
                  <Plus /> Add conditions
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>

      {problems.length > 0 && (
        <ul className="mx-5 mb-4 space-y-1 bg-[#fbe7e3] px-4 py-3 text-[13px] text-[#7d1d1a]" data-testid="promotion-problems">
          {problems.map(p => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}

      <footer className="flex flex-wrap items-start justify-between gap-3 border-t border-border px-5 py-4">
        <details className="text-[13px] text-muted-foreground">
          <summary className="cursor-pointer select-none py-2">The rule as JSON</summary>
          <pre className="mt-2 max-h-64 max-w-[min(640px,80vw)] overflow-auto bg-secondary p-3 font-mono text-xs text-foreground">
            {JSON.stringify(draft, null, 2)}
          </pre>
        </details>
        <Button type="submit" size="sm" disabled={saving} data-testid="promotion-save">
          {saving ? 'Saving…' : initial ? 'Save as a new version' : 'Create promotion'}
        </Button>
      </footer>
    </form>
  );
}

function Usage({ used, limit }: { used: number; limit?: number }) {
  if (!limit) return <span className="tabular-nums">{fmtCount(used)}</span>;
  const ratio = Math.min(1, used / limit);
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <span className="tabular-nums">
        {fmtCount(used)} <span className="text-muted-foreground">/ {fmtCount(limit)}</span>
      </span>
      <span className="block h-1 w-20 bg-secondary" aria-hidden>
        {used > 0 && <span className="block h-full bg-chart" style={{ width: `${ratio * 100}%` }} />}
      </span>
    </span>
  );
}

export default function AdminPromotionsPage() {
  const [promotions, setPromotions] = useState<Promotion[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [filter, setFilter] = useState<PromotionStatus | 'all'>('all');
  const [editing, setEditing] = useState<Promotion | null | 'new'>(null);
  const [history, setHistory] = useState<Promotion | null>(null);
  const [all, setAll] = useState<Promotion[] | null>(null);

  const load = useCallback(() => {
    setFailed(false);
    api<Promotion[]>(`/admin/promotions${filter === 'all' ? '' : `?status=${filter}`}`)
      .then(list => {
        setPromotions(list);
        if (filter === 'all') setAll(list);
      })
      .catch(e => {
        setFailed(true);
        toast.error((e as Error).message);
      });
  }, [filter]);
  useEffect(load, [load]);
  // The finding and the tab counts read every promotion, whatever the filter shows.
  useEffect(() => {
    if (filter !== 'all' && all === null) api<Promotion[]>('/admin/promotions').then(setAll, () => {});
  }, [filter, all]);

  const setStatus = async (p: Promotion, status: PromotionStatus) => {
    try {
      if (status === 'archived') await api(`/admin/promotions/${p._id}`, { method: 'DELETE' });
      else
        await api(`/admin/promotions/${p._id}`, {
          method: 'PUT',
          headers: { 'If-Match': `"${p.version}"` },
          body: JSON.stringify({ status }),
        });
      setAll(null);
      load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const sorted = useMemo(
    () => [...(promotions ?? [])].sort((a, b) => b.priority - a.priority || a.name.localeCompare(b.name)),
    [promotions],
  );

  const live = all?.filter(p => p.status === 'active') ?? [];
  // A column empty in every row is dropped rather than drawn as a band of dashes.
  const windowed = sorted.some(p => p.startsAt || p.endsAt);
  const mostUsed = [...live].sort((a, b) => b.usedCount - a.usedCount)[0];
  const finding = all
    ? live.length === 0
      ? 'No offer is live; customers pay list prices.'
      : `${plural(live.length, 'offer')} live${mostUsed && mostUsed.usedCount > 0 ? `; ${mostUsed.name} has been used most, ${plural(mostUsed.usedCount, 'time')}` : ', none used yet'}.`
    : null;

  return (
    <div data-testid="admin-promotions-page">
      <PageHeader
        title="Promotions"
        finding={finding}
        actions={
          <>
            <Button asChild variant="outline" size="sm">
              <Link href="/admin/promotions/simulator">
                <FlaskConical /> Simulator
              </Link>
            </Button>
            <Button size="sm" onClick={() => setEditing('new')} data-testid="promotion-new">
              <Plus /> New promotion
            </Button>
          </>
        }
      />

      {editing && (
        <PromotionEditor
          key={editing === 'new' ? 'new' : `${editing._id}:${editing.version}`}
          initial={editing === 'new' ? null : editing}
          onDone={() => {
            setEditing(null);
            setAll(null);
            load();
          }}
        />
      )}

      <Tabs
        className="mt-6"
        ariaLabel="Status"
        value={filter}
        onChange={setFilter}
        options={[
          { value: 'all' as const, label: 'All', count: all?.length ?? null },
          ...PROMOTION_STATUSES.map(s => ({
            value: s,
            label: STATUS_LABEL[s],
            count: all ? all.filter(p => p.status === s).length : null,
          })),
        ]}
      />

      <section className="mt-4 border border-border bg-card">
        {failed && promotions === null ? (
          <div className="p-4">
            <BlockError what="promotions" onRetry={load} />
          </div>
        ) : promotions === null ? (
          <LoadingRows rows={5} className="px-4" />
        ) : sorted.length === 0 ? (
          <div className="p-4">
            <Empty>
              {filter === 'all'
                ? 'No promotions yet. Create the first with New promotion.'
                : `No ${STATUS_LABEL[filter].toLowerCase()} promotions.`}
            </Empty>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Promotion</TableHead>
                <TableHead className="hidden md:table-cell">Discount</TableHead>
                <TableHead className="hidden lg:table-cell">Applies</TableHead>
                {windowed && <TableHead className="hidden xl:table-cell">Runs</TableHead>}
                <TableHead className="text-right">Used</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="pr-4">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map(p => (
                <TableRow key={p._id} data-testid={`promotion-${p._id}`}>
                  <TableCell className="w-full max-w-0 pl-4 md:max-w-none">
                    <p className="truncate font-medium">{p.name}</p>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      Version {p.version} · priority {p.priority}
                      {p.stackGroup && ` · group ${p.stackGroup}`}
                      {p.exclusive && ' · exclusive'}
                    </p>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">{ACTION_LABELS[p.action.type]}</TableCell>
                  <TableCell className="hidden lg:table-cell">
                    {p.activation === 'code' ? (
                      <Pill tone="neutral">{p.code}</Pill>
                    ) : (
                      <span className="text-muted-foreground">Automatically</span>
                    )}
                  </TableCell>
                  {windowed && (
                    <TableCell className="hidden whitespace-nowrap tabular-nums xl:table-cell">
                      {p.startsAt || p.endsAt ? (
                        `${p.startsAt ? day(p.startsAt) : 'Now'} – ${p.endsAt ? day(p.endsAt) : 'open'}`
                      ) : (
                        <Dash label="No end date" />
                      )}
                    </TableCell>
                  )}
                  <TableCell className="text-right">
                    <Usage used={p.usedCount} limit={p.usageLimit} />
                  </TableCell>
                  <TableCell>
                    {p.status === 'active' ? (
                      // Live is the norm: a dot and the word, so a screen of live offers is not a stripe of green.
                      <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[13px]">
                        <span className="h-1.5 w-1.5 rounded-full bg-positive" aria-hidden /> Live
                      </span>
                    ) : (
                      <Pill tone={STATUS_TONE[p.status]}>{STATUS_LABEL[p.status]}</Pill>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap pr-4 text-right">
                    <span className="inline-flex gap-0.5">
                      <IconButton label={`Edit ${p.name}`} onClick={() => setEditing(p)}>
                        <Pencil />
                      </IconButton>
                      <IconButton label={`History of ${p.name}`} onClick={() => setHistory(p)}>
                        <History />
                      </IconButton>
                      {p.status !== 'active' && p.status !== 'archived' && (
                        <IconButton label={`Activate ${p.name}`} onClick={() => setStatus(p, 'active')}>
                          <Play />
                        </IconButton>
                      )}
                      {p.status === 'active' && (
                        <IconButton label={`Pause ${p.name}`} onClick={() => setStatus(p, 'paused')}>
                          <Pause />
                        </IconButton>
                      )}
                      {p.status !== 'archived' && (
                        <IconButton label={`Archive ${p.name}`} onClick={() => setStatus(p, 'archived')}>
                          <Archive />
                        </IconButton>
                      )}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>
      {history && <VersionsDialog promotion={history} onClose={() => setHistory(null)} />}
    </div>
  );
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label.split(' ')[0]}
      className="flex h-8 w-8 items-center justify-center text-muted-foreground transition-transform duration-150 ease-out hover:bg-secondary hover:text-foreground active:scale-[0.97] [&_svg]:h-4 [&_svg]:w-4 [&_svg]:stroke-[1.5]"
    >
      {children}
    </button>
  );
}
