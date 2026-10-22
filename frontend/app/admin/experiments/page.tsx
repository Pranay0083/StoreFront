'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { api, fmtDateTime, fmtINR } from '@/lib/api';
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

const statusVariant = (s: ExperimentStatus) =>
  s === 'running'
    ? ('success' as const)
    : s === 'paused'
      ? ('warning' as const)
      : s === 'completed'
        ? ('secondary' as const)
        : ('outline' as const);

const pct = (n: number) => `${(n * 100).toFixed(2)}%`;

const issues = (error: { issues: Array<{ path: (string | number)[]; message: string }> }) =>
  error.issues.map(i => `${i.path.join('.') || 'input'}: ${i.message}`).join('; ');

function FlagsSection() {
  const [flags, setFlags] = useState<FeatureFlag[] | null>(null);
  const [draft, setDraft] = useState({ key: '', description: '', rolloutPercent: '100', segments: [] as AudienceSegment[] });

  const load = useCallback(() => {
    api<FeatureFlag[]>('/admin/flags')
      .then(setFlags)
      .catch(e => toast.error((e as Error).message));
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

  return (
    <section className="mt-8" data-testid="flags-section">
      <h2 className="font-serif text-2xl font-semibold">Feature flags</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Percentage rollouts are deterministic per visitor, so raising a rollout only ever adds people.
      </p>
      <div className="mt-4 border border-black/10 bg-white">
        {flags === null ? (
          <Skeleton className="m-4 h-24" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Flag</TableHead>
                <TableHead>Audience</TableHead>
                <TableHead className="w-48">Rollout</TableHead>
                <TableHead>State</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {flags.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-sm text-muted-foreground">
                    No flags yet.
                  </TableCell>
                </TableRow>
              )}
              {flags.map(f => (
                <TableRow key={f.key} data-testid={`flag-${f.key}`}>
                  <TableCell>
                    <p className="font-mono text-sm">{f.key}</p>
                    <p className="text-xs text-muted-foreground">{f.description}</p>
                  </TableCell>
                  <TableCell className="text-xs">
                    {[...(f.audience.segments ?? []), ...(f.audience.roles ?? [])].join(', ') || 'Everyone'}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <input
                        type="range"
                        min={0}
                        max={100}
                        defaultValue={f.rolloutPercent}
                        onMouseUp={e => update(f, { rolloutPercent: Number((e.target as HTMLInputElement).value) })}
                        onKeyUp={e => update(f, { rolloutPercent: Number((e.target as HTMLInputElement).value) })}
                        aria-label={`Rollout for ${f.key}`}
                      />
                      <span className="w-10 text-right text-xs tabular-nums">{f.rolloutPercent}%</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Button size="sm" variant={f.enabled ? 'default' : 'outline'} onClick={() => update(f, { enabled: !f.enabled })}>
                      {f.enabled ? 'On' : 'Off'}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
      <form onSubmit={create} className="mt-4 flex flex-wrap items-end gap-3 border border-black/10 bg-white p-4">
        <label className="text-xs">
          Key
          <Input
            value={draft.key}
            onChange={e => setDraft({ ...draft, key: e.target.value })}
            placeholder="new-checkout"
            className="mt-1 w-44"
          />
        </label>
        <label className="flex-1 text-xs">
          Description
          <Input value={draft.description} onChange={e => setDraft({ ...draft, description: e.target.value })} className="mt-1" />
        </label>
        <label className="text-xs">
          Rollout %
          <Input
            type="number"
            min={0}
            max={100}
            value={draft.rolloutPercent}
            onChange={e => setDraft({ ...draft, rolloutPercent: e.target.value })}
            className="mt-1 w-24"
          />
        </label>
        <fieldset className="text-xs">
          <legend>Audience</legend>
          <div className="mt-2 flex gap-3">
            {AUDIENCE_SEGMENTS.map(s => (
              <label key={s} className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={draft.segments.includes(s)}
                  onChange={e =>
                    setDraft({ ...draft, segments: e.target.checked ? [...draft.segments, s] : draft.segments.filter(x => x !== s) })
                  }
                />
                {s}
              </label>
            ))}
          </div>
        </fieldset>
        <Button type="submit" size="sm">
          Add flag
        </Button>
      </form>
    </section>
  );
}

function ResultsPanel({ experiment }: { experiment: Experiment }) {
  const [results, setResults] = useState<ExperimentResults | null>(null);
  useEffect(() => {
    api<ExperimentResults>(`/admin/experiments/${experiment.key}/results`)
      .then(setResults)
      .catch(e => toast.error((e as Error).message));
  }, [experiment.key, experiment.status]);

  if (!results) return <Skeleton className="h-24" />;
  return (
    <div className="space-y-4" data-testid={`results-${experiment.key}`}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Variant</TableHead>
            <TableHead className="text-right">Visitors</TableHead>
            <TableHead className="text-right">Conversions</TableHead>
            <TableHead className="text-right">Conversion rate</TableHead>
            <TableHead className="text-right">Revenue / visitor</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {results.variants.map((v, i) => (
            <TableRow key={v.variant}>
              <TableCell className="font-mono text-sm">
                {v.variant} {i === 0 && <span className="text-xs text-muted-foreground">(control)</span>}
              </TableCell>
              <TableCell className="text-right tabular-nums">{v.visitors}</TableCell>
              <TableCell className="text-right tabular-nums">{v.conversions}</TableCell>
              <TableCell className="text-right tabular-nums">{pct(v.conversionRate)}</TableCell>
              <TableCell className="text-right tabular-nums">{fmtINR(v.revenuePerVisitor)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {results.comparisons.map(c => (
        <p key={c.variant} className="text-sm">
          <span className="font-mono">{c.variant}</span> vs <span className="font-mono">{c.control}</span>: lift{' '}
          <span className="font-medium">{c.relativeLift === null ? 'n/a' : `${(c.relativeLift * 100).toFixed(1)}%`}</span> · z ={' '}
          {c.zScore === null ? 'n/a' : c.zScore.toFixed(2)} · p = {c.pValue === null ? 'n/a' : c.pValue.toFixed(4)}{' '}
          <Badge variant={c.significant ? 'success' : 'outline'}>
            {c.significant ? `significant at α=${results.alpha}` : 'not significant'}
          </Badge>
        </p>
      ))}
      {results.warnings.map(w => (
        <p key={w} className="bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {w}
        </p>
      ))}
    </div>
  );
}

function ExperimentsSection() {
  const [experiments, setExperiments] = useState<Experiment[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [draft, setDraft] = useState({ key: '', name: '', hypothesis: '', variants: 'control:50, treatment:50', minSample: '200' });

  const load = useCallback(() => {
    api<Experiment[]>('/admin/experiments')
      .then(setExperiments)
      .catch(e => toast.error((e as Error).message));
  }, []);
  useEffect(load, [load]);

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
    <section className="mt-12" data-testid="experiments-section">
      <h2 className="font-serif text-2xl font-semibold">A/B experiments</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Assignment is sticky per visitor and survives sign-in. Only visitors who actually saw the tested UI count, and paid orders are
        attributed to the variant they saw first.
      </p>
      <div className="mt-4 space-y-3">
        {experiments === null && <Skeleton className="h-24" />}
        {experiments?.map(e => (
          <div key={e.key} className="border border-black/10 bg-white p-4" data-testid={`experiment-${e.key}`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-medium">
                  {e.name} <Badge variant={statusVariant(e.status)}>{e.status}</Badge>
                </p>
                <p className="font-mono text-xs text-muted-foreground">
                  {e.key} · {e.variants.map(v => `${v.key} ${v.weight}%`).join(' / ')}
                  {e.startedAt && ` · started ${fmtDateTime(e.startedAt)}`}
                </p>
                {e.hypothesis && <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{e.hypothesis}</p>}
              </div>
              <div className="flex gap-2">
                {NEXT_STATUS[e.status].map(n => (
                  <Button key={n.to} size="sm" variant="outline" onClick={() => transition(e, n.to)}>
                    {n.label}
                  </Button>
                ))}
                <Button size="sm" variant="ghost" onClick={() => setOpen(open === e.key ? null : e.key)}>
                  {open === e.key ? 'Hide results' : 'Results'}
                </Button>
              </div>
            </div>
            {open === e.key && (
              <div className="mt-4 border-t border-black/10 pt-4">
                <ResultsPanel experiment={e} />
              </div>
            )}
          </div>
        ))}
      </div>
      <form onSubmit={create} className="mt-4 grid gap-3 border border-black/10 bg-white p-4 md:grid-cols-2">
        <label className="text-xs">
          Key
          <Input
            value={draft.key}
            onChange={e => setDraft({ ...draft, key: e.target.value })}
            placeholder="pdp-sticky-cta"
            className="mt-1"
          />
        </label>
        <label className="text-xs">
          Name
          <Input value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} className="mt-1" />
        </label>
        <label className="text-xs md:col-span-2">
          Hypothesis
          <Textarea value={draft.hypothesis} onChange={e => setDraft({ ...draft, hypothesis: e.target.value })} className="mt-1" rows={2} />
        </label>
        <label className="text-xs">
          Variants (first is control; weights sum to 100)
          <Input value={draft.variants} onChange={e => setDraft({ ...draft, variants: e.target.value })} className="mt-1 font-mono" />
        </label>
        <label className="text-xs">
          Minimum visitors per variant
          <Input type="number" value={draft.minSample} onChange={e => setDraft({ ...draft, minSample: e.target.value })} className="mt-1" />
        </label>
        <div className="md:col-span-2">
          <Button type="submit" size="sm">
            Create draft experiment
          </Button>
        </div>
      </form>
    </section>
  );
}

export default function AdminExperimentsPage() {
  return (
    <div data-testid="admin-experiments-page">
      <h1 className="font-serif text-3xl font-semibold tracking-tight sm:text-4xl">Experiments</h1>
      <p className="mt-1 text-sm text-muted-foreground">Feature flags, gradual rollouts and A/B tests with significance testing.</p>
      <FlagsSection />
      <ExperimentsSection />
    </div>
  );
}
