'use client';

/*
 * Experiments.
 * Data: A/B experiments (key, name, hypothesis, status, variants and weights, minimum visitors per
 * variant, start time) with per-variant results (visitors, conversions, rate, revenue per visitor,
 * lift, z, p, significance at alpha), and feature flags (key, description, audience, rollout %, on/off).
 * Opened by the admin a few times a week. Jobs: read a running test and call it (most frequent), start
 * or pause one, roll a flag out further.
 *
 * Question: is any running test ready to call?
 * Finding: the running test's lift against control, and whether it has enough visitors to trust.
 * Face: each test's sample against its minimum as a labelled track, and the leading variant's
 * conversion rate in the data hue.
 */

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  BlockError,
  Dash,
  Empty,
  FieldLabel,
  fmtCount,
  fmtMoney,
  fmtWhen,
  LoadingRows,
  PageHeader,
  Panel,
  Pill,
  plural,
  Toggle,
  type PillTone,
} from '@/components/admin/ledger';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import {
  AUDIENCE_SEGMENTS,
  ExperimentInputSchema,
  FlagInputSchema,
  type AudienceSegment,
  type Experiment,
  type ExperimentResults,
  type ExperimentStatus,
  type FeatureFlag,
} from '@storefront/contracts';

const NEXT_STATUS: Record<ExperimentStatus, Array<{ to: ExperimentStatus; label: string }>> = {
  draft: [{ to: 'running', label: 'Start' }],
  running: [
    { to: 'paused', label: 'Pause' },
    { to: 'completed', label: 'Complete' },
  ],
  paused: [
    { to: 'running', label: 'Resume' },
    { to: 'completed', label: 'Complete' },
  ],
  completed: [],
};

const STATUS_LABEL: Record<ExperimentStatus, string> = { draft: 'Draft', running: 'Running', paused: 'Paused', completed: 'Completed' };
const STATUS_TONE: Record<ExperimentStatus, PillTone> = { draft: 'neutral', running: 'positive', paused: 'warning', completed: 'neutral' };
const SEGMENT_LABEL: Record<AudienceSegment, string> = { guest: 'Guests', signedIn: 'Signed in', staff: 'Staff' };

const pct = (n: number) => `${(n * 100).toFixed(2)}%`;
const signedPct = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n * 100).toFixed(1)}%`;

const issues = (error: { issues: Array<{ path: (string | number)[]; message: string }> }) =>
  error.issues.map(i => `${i.path.join('.') || 'input'}: ${i.message}`).join('; ');

/** Visitors in the smallest variant against the minimum, both ends labelled; the fill is the true ratio. */
function SampleTrack({ results, min }: { results: ExperimentResults; min: number }) {
  const smallest = Math.min(...results.variants.map(v => v.visitors));
  const ratio = Math.min(1, smallest / min);
  return (
    <div className="max-w-sm">
      <div className="flex justify-between text-xs tabular-nums text-muted-foreground">
        <span>
          <span className="font-medium text-foreground">{fmtCount(smallest)}</span> visitors in the smallest variant
        </span>
        <span>{fmtCount(min)} needed</span>
      </div>
      <span className="mt-1.5 block h-1.5 bg-secondary" aria-hidden>
        {smallest > 0 && (
          <span className={cn('block h-full', ratio >= 1 ? 'bg-foreground' : 'bg-foreground/40')} style={{ width: `${ratio * 100}%` }} />
        )}
      </span>
    </div>
  );
}

function ResultsTable({ experiment, results }: { experiment: Experiment; results: ExperimentResults }) {
  const best = Math.max(...results.variants.map(v => v.conversionRate));
  return (
    <div className="space-y-3" data-testid={`results-${experiment.key}`}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="pl-0">Variant</TableHead>
            <TableHead className="text-right">Visitors</TableHead>
            <TableHead className="text-right">Paid orders</TableHead>
            <TableHead className="w-48 text-right">Conversion</TableHead>
            <TableHead className="hidden pr-0 text-right sm:table-cell">Revenue per visitor</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {results.variants.map((v, i) => (
            <TableRow key={v.variant}>
              <TableCell className="pl-0">
                {v.variant} {i === 0 && <span className="text-xs text-muted-foreground">control</span>}
              </TableCell>
              <TableCell className="text-right tabular-nums">{fmtCount(v.visitors)}</TableCell>
              <TableCell className="text-right tabular-nums">{fmtCount(v.conversions)}</TableCell>
              <TableCell className="text-right">
                <span className="inline-flex items-center justify-end gap-2">
                  <span className="hidden h-1.5 w-20 bg-secondary sm:block" aria-hidden>
                    {v.conversionRate > 0 && (
                      <span
                        className={cn('block h-full', v.conversionRate === best && best > 0 ? 'bg-chart' : 'bg-foreground/30')}
                        style={{ width: `${best ? (v.conversionRate / best) * 100 : 0}%` }}
                      />
                    )}
                  </span>
                  <span className="w-14 tabular-nums">{pct(v.conversionRate)}</span>
                </span>
              </TableCell>
              <TableCell className="hidden pr-0 text-right tabular-nums sm:table-cell">{fmtMoney(v.revenuePerVisitor)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {results.comparisons.map(c => (
        <p key={c.variant} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          <span>
            {c.variant} against {c.control}: lift{' '}
            <span className="font-medium tabular-nums">{c.relativeLift === null ? '—' : signedPct(c.relativeLift)}</span>
            <span className="text-muted-foreground tabular-nums">
              {' '}
              · z {c.zScore === null ? '—' : c.zScore.toFixed(2)} · p {c.pValue === null ? '—' : c.pValue.toFixed(4)}
            </span>
          </span>
          <Pill tone={c.significant ? 'positive' : 'neutral'}>
            {c.significant ? `Significant at α ${results.alpha}` : 'Not significant yet'}
          </Pill>
        </p>
      ))}
      {results.warnings.map(w => (
        <p key={w} className="border border-[#f1dfa6] bg-[#fbf3d6] px-3 py-2 text-[13px] text-[#7a4108]">
          {w}
        </p>
      ))}
    </div>
  );
}

function FlagsSection() {
  const [flags, setFlags] = useState<FeatureFlag[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [draft, setDraft] = useState({ key: '', description: '', rolloutPercent: '100', segments: [] as AudienceSegment[] });

  const load = useCallback(() => {
    setFailed(false);
    api<FeatureFlag[]>('/admin/flags')
      .then(setFlags)
      .catch(() => setFailed(true));
  }, []);
  useEffect(load, [load]);

  const update = async (flag: FeatureFlag, patch: Partial<FeatureFlag>) => {
    try {
      await api(`/admin/flags/${flag.key}`, { method: 'PUT', body: JSON.stringify(patch) });
      load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = FlagInputSchema.safeParse({
      key: draft.key,
      description: draft.description,
      enabled: false,
      rolloutPercent: Number(draft.rolloutPercent),
      audience: draft.segments.length ? { segments: draft.segments } : {},
    });
    if (!parsed.success) return toast.error(issues(parsed.error));
    try {
      await api('/admin/flags', { method: 'POST', body: JSON.stringify(parsed.data) });
      setDraft({ key: '', description: '', rolloutPercent: '100', segments: [] });
      toast.success(`Flag ${parsed.data.key} created (off)`);
      load();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const on = flags?.filter(f => f.enabled).length ?? 0;

  return (
    <Panel
      title="Feature flags"
      meta={flags ? `${fmtCount(on)} of ${plural(flags.length, 'flag')} on` : null}
      data-testid="flags-section"
      bodyClassName="px-0 pb-0"
    >
      <p className="px-5 text-[13px] text-muted-foreground">
        Rollouts are deterministic per visitor, so raising one only ever adds people.
      </p>
      {failed ? (
        <div className="px-5 py-3">
          <BlockError what="feature flags" onRetry={load} />
        </div>
      ) : flags === null ? (
        <LoadingRows rows={3} className="px-5" />
      ) : flags.length === 0 ? (
        <div className="px-5 py-3">
          <Empty>No flags yet. Add one below; it starts off.</Empty>
        </div>
      ) : (
        <Table className="mt-2">
          <TableHeader>
            <TableRow>
              <TableHead className="pl-5">Flag</TableHead>
              <TableHead className="hidden md:table-cell">Audience</TableHead>
              <TableHead className="w-56">Rollout</TableHead>
              <TableHead className="w-16 pr-5 text-right">On</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {flags.map(f => (
              <TableRow key={f.key} data-testid={`flag-${f.key}`}>
                <TableCell className="max-w-0 pl-5 md:max-w-none">
                  <p className="truncate font-medium">{f.key}</p>
                  {f.description ? <p className="mt-0.5 truncate text-xs text-muted-foreground">{f.description}</p> : null}
                </TableCell>
                <TableCell className="hidden text-muted-foreground md:table-cell">
                  {[...(f.audience.segments ?? []).map(s => SEGMENT_LABEL[s]), ...(f.audience.roles ?? [])].join(', ') || 'Everyone'}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-3">
                    <input
                      type="range"
                      min={0}
                      max={100}
                      defaultValue={f.rolloutPercent}
                      className="w-32 accent-foreground"
                      onMouseUp={e => update(f, { rolloutPercent: Number((e.target as HTMLInputElement).value) })}
                      onKeyUp={e => update(f, { rolloutPercent: Number((e.target as HTMLInputElement).value) })}
                      aria-label={`Rollout for ${f.key}`}
                    />
                    <span className="w-10 text-right tabular-nums">{f.rolloutPercent}%</span>
                  </div>
                </TableCell>
                <TableCell className="pr-5 text-right">
                  <Toggle checked={f.enabled} onChange={enabled => update(f, { enabled })} label={`${f.key} ${f.enabled ? 'on' : 'off'}`} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <form
        onSubmit={create}
        className="grid gap-4 border-t border-border px-5 py-4 sm:grid-cols-2 lg:grid-cols-[200px_minmax(0,1fr)_96px_auto_auto] lg:items-end"
      >
        <FieldLabel label="Key">
          <Input value={draft.key} onChange={e => setDraft({ ...draft, key: e.target.value })} placeholder="new-checkout" className="h-9" />
        </FieldLabel>
        <FieldLabel label="Description">
          <Input value={draft.description} onChange={e => setDraft({ ...draft, description: e.target.value })} className="h-9" />
        </FieldLabel>
        <FieldLabel label="Rollout %">
          <Input
            type="number"
            min={0}
            max={100}
            value={draft.rolloutPercent}
            onChange={e => setDraft({ ...draft, rolloutPercent: e.target.value })}
            className="h-9 tabular-nums"
          />
        </FieldLabel>
        <fieldset className="min-w-0">
          <legend className="text-[13px] font-medium">Audience</legend>
          <div className="mt-1.5 flex h-9 items-center gap-4 text-sm">
            {AUDIENCE_SEGMENTS.map(s => (
              <label key={s} className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-foreground"
                  checked={draft.segments.includes(s)}
                  onChange={e =>
                    setDraft({ ...draft, segments: e.target.checked ? [...draft.segments, s] : draft.segments.filter(x => x !== s) })
                  }
                />
                {SEGMENT_LABEL[s]}
              </label>
            ))}
          </div>
        </fieldset>
        <Button type="submit" size="sm" variant="outline" className="h-9">
          Add flag
        </Button>
      </form>
    </Panel>
  );
}

function ExperimentsSection({ onFinding }: { onFinding: (f: string | null) => void }) {
  const [experiments, setExperiments] = useState<Experiment[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [results, setResults] = useState<Record<string, ExperimentResults | 'error'>>({});
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [draft, setDraft] = useState({ key: '', name: '', hypothesis: '', variants: 'control:50, treatment:50', minSample: '200' });

  const load = useCallback(() => {
    setFailed(false);
    api<Experiment[]>('/admin/experiments')
      .then(list => {
        setExperiments(list);
        for (const e of list.filter(x => x.status !== 'draft')) {
          api<ExperimentResults>(`/admin/experiments/${e.key}/results`)
            .then(r => setResults(prev => ({ ...prev, [e.key]: r })))
            .catch(() => setResults(prev => ({ ...prev, [e.key]: 'error' })));
        }
      })
      .catch(() => setFailed(true));
  }, []);
  useEffect(load, [load]);

  useEffect(() => {
    if (!experiments) return onFinding(null);
    const running = experiments.filter(e => e.status === 'running');
    if (!running.length) return onFinding(experiments.length ? 'No experiment is running.' : 'No experiments yet.');
    const e = running[0];
    const r = results[e.key];
    if (!r || r === 'error') return onFinding(`${e.name} is running.`);
    const c = r.comparisons[0];
    const smallest = Math.min(...r.variants.map(v => v.visitors));
    const lift =
      c && c.relativeLift !== null ? `${c.variant} ${signedPct(c.relativeLift)} on conversion against ${c.control}` : 'no lift to read yet';
    const verdict = c?.significant
      ? 'significant, ready to call'
      : smallest < e.minSamplePerVariant
        ? `not significant, ${fmtCount(e.minSamplePerVariant - smallest)} more visitors needed per variant`
        : 'not significant at the minimum sample';
    onFinding(`${e.name}: ${lift}; ${verdict}.`);
  }, [experiments, results, onFinding]);

  const transition = async (e: Experiment, to: ExperimentStatus) => {
    try {
      await api(`/admin/experiments/${e.key}`, { method: 'PUT', body: JSON.stringify({ status: to }) });
      load();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const create = async (ev: React.FormEvent) => {
    ev.preventDefault();
    const variants = draft.variants.split(',').map(part => {
      const [key, weight] = part.split(':').map(s => s.trim());
      return { key, weight: Number(weight) };
    });
    const parsed = ExperimentInputSchema.safeParse({
      key: draft.key,
      name: draft.name,
      hypothesis: draft.hypothesis,
      variants,
      minSamplePerVariant: Number(draft.minSample),
      status: 'draft',
    });
    if (!parsed.success) return toast.error(issues(parsed.error));
    try {
      await api('/admin/experiments', { method: 'POST', body: JSON.stringify(parsed.data) });
      toast.success('Experiment created as a draft');
      setDraft({ key: '', name: '', hypothesis: '', variants: 'control:50, treatment:50', minSample: '200' });
      load();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  return (
    <Panel
      title="A/B tests"
      meta={experiments ? plural(experiments.length, 'test') : null}
      data-testid="experiments-section"
      bodyClassName="px-0 pb-0"
    >
      <p className="px-5 text-[13px] text-muted-foreground">
        Assignment sticks to a visitor through sign-in; only visitors who saw the tested screen count, and paid orders go to the variant
        they saw first.
      </p>
      {failed ? (
        <div className="px-5 py-3">
          <BlockError what="experiments" onRetry={load} />
        </div>
      ) : experiments === null ? (
        <LoadingRows rows={3} className="px-5" />
      ) : experiments.length === 0 ? (
        <div className="px-5 py-3">
          <Empty>No tests yet. Create a draft below and start it when the variant ships.</Empty>
        </div>
      ) : (
        <ul className="mt-3 divide-y divide-border">
          {experiments.map(e => {
            const r = results[e.key];
            const open = e.status !== 'draft' && !hidden.has(e.key);
            return (
              <li key={e.key} className="px-5 py-4" data-testid={`experiment-${e.key}`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 max-w-2xl">
                    <p className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{e.name}</span>
                      <Pill tone={STATUS_TONE[e.status]}>{STATUS_LABEL[e.status]}</Pill>
                    </p>
                    <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">
                      {e.key} · {e.variants.map(v => `${v.key} ${v.weight}%`).join(' / ')}
                      {e.startedAt && ` · started ${fmtWhen(e.startedAt)}`}
                    </p>
                    {e.hypothesis && <p className="mt-1.5 text-sm text-muted-foreground">{e.hypothesis}</p>}
                  </div>
                  <div className="flex gap-2">
                    {NEXT_STATUS[e.status].map(n => (
                      <Button
                        key={n.to}
                        size="sm"
                        variant={n.to === 'completed' ? 'ghost' : 'outline'}
                        className="h-8 px-3"
                        onClick={() => transition(e, n.to)}
                      >
                        {n.label}
                      </Button>
                    ))}
                    {e.status !== 'draft' && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 px-3"
                        onClick={() =>
                          setHidden(prev => {
                            const next = new Set(prev);
                            if (next.has(e.key)) next.delete(e.key);
                            else next.add(e.key);
                            return next;
                          })
                        }
                      >
                        {open ? 'Hide results' : 'Results'}
                      </Button>
                    )}
                  </div>
                </div>
                {e.status === 'draft' ? (
                  <p className="mt-3 text-[13px] text-muted-foreground">
                    Needs {fmtCount(e.minSamplePerVariant)} visitors per variant once started. <Dash label="No results yet" />
                  </p>
                ) : r === 'error' ? (
                  <BlockError what="its results" onRetry={load} className="mt-2" />
                ) : !r ? (
                  <LoadingRows rows={2} className="mt-2" />
                ) : (
                  <>
                    <div className="mt-3">
                      <SampleTrack results={r} min={e.minSamplePerVariant} />
                    </div>
                    {open && (
                      <div className="mt-4">
                        <ResultsTable experiment={e} results={r} />
                      </div>
                    )}
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <form onSubmit={create} className="grid gap-4 border-t border-border px-5 py-4 md:grid-cols-2">
        <p className="text-sm font-semibold md:col-span-2">New test</p>
        <FieldLabel label="Key">
          <Input
            value={draft.key}
            onChange={e => setDraft({ ...draft, key: e.target.value })}
            placeholder="pdp-sticky-cta"
            className="h-9"
          />
        </FieldLabel>
        <FieldLabel label="Name">
          <Input value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} className="h-9" />
        </FieldLabel>
        <FieldLabel label="Hypothesis" className="md:col-span-2">
          <Textarea value={draft.hypothesis} onChange={e => setDraft({ ...draft, hypothesis: e.target.value })} rows={2} />
        </FieldLabel>
        <FieldLabel label="Variants" hint="The first is the control; weights add up to 100">
          <Input value={draft.variants} onChange={e => setDraft({ ...draft, variants: e.target.value })} className="h-9" />
        </FieldLabel>
        <FieldLabel label="Minimum visitors per variant" hint="Results are not called before this">
          <Input
            type="number"
            value={draft.minSample}
            onChange={e => setDraft({ ...draft, minSample: e.target.value })}
            className="h-9 tabular-nums"
          />
        </FieldLabel>
        <div className="md:col-span-2">
          <Button type="submit" size="sm" variant="outline">
            Create draft test
          </Button>
        </div>
      </form>
    </Panel>
  );
}

export default function AdminExperimentsPage() {
  const [finding, setFinding] = useState<string | null>(null);
  return (
    <div data-testid="admin-experiments-page">
      <PageHeader title="Experiments" finding={finding} />
      <div className="mt-6 space-y-4">
        <ExperimentsSection onFinding={setFinding} />
        <FlagsSection />
      </div>
    </div>
  );
}
