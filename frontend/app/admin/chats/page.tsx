'use client';

/*
 * Agent chats.
 * Data: the last 100 conversations with Aria, the shopping agent (customer or guest, messages, tool
 * calls, proposed actions and their status, per-reply model usage), and model spend over the window
 * (cost in USD, tokens in and out, model calls, per day and per conversation). Opened by support and
 * the admin a few times a week. Jobs: read what customers asked and what Aria did (most frequent),
 * keep an eye on spend.
 *
 * Question: what are customers asking Aria, and what does it cost?
 * Finding: how many conversations, and what Aria spent on how many replies.
 * Face: the inbox: the conversation list beside the transcript, with Aria's tool calls and proposed
 * actions shown in line, where they happened.
 */

import { ArrowLeft, ChevronRight, Wrench } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import {
  BlockError,
  Empty,
  fmtCount,
  fmtWhen,
  Initial,
  KpiStrip,
  LoadingRows,
  PageHeader,
  Panel,
  Pill,
  plural,
} from '@/components/admin/ledger';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

interface ConvoMsg {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  toolName?: string;
  usage?: { model: string; inputTokens: number; outputTokens: number; costUsd: number; latencyMs: number; llmCalls: number };
  action?: { type: string; summary: string; status: string };
  at: string;
}

interface UsageTotals {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  llmCalls: number;
}

interface UsageSummary {
  days: number;
  totals: UsageTotals & { messages: number };
  daily: Array<UsageTotals & { date: string; messages: number }>;
  conversations: Array<UsageTotals & { conversationId: string }>;
}

interface Convo {
  _id: string;
  sessionId: string;
  userName: string | null;
  userEmail: string | null;
  channel: string;
  messageCount: number;
  toolCallCount: number;
  preview: string;
  messages: ConvoMsg[];
  updatedAt: string;
}

const usd = (n: number) => (n === 0 ? '$0.00' : n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`);
const compact = (n: number) => new Intl.NumberFormat('en-IN', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
const who = (c: Pick<Convo, 'userName' | 'userEmail'>) => c.userName || c.userEmail || 'Guest visitor';

function ToolLine({ m }: { m: ConvoMsg }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
      >
        <Wrench className="h-3.5 w-3.5" strokeWidth={1.5} /> Aria used {m.toolName ?? 'a tool'}
        <ChevronRight className={cn('h-3.5 w-3.5', open && 'rotate-90')} />
      </button>
      {open && (
        <pre className="mt-1.5 max-h-48 overflow-auto bg-secondary p-3 font-mono text-xs leading-relaxed">
          {(() => {
            try {
              return JSON.stringify(JSON.parse(m.content), null, 2);
            } catch {
              return m.content;
            }
          })()}
        </pre>
      )}
    </div>
  );
}

function UsageStrip({ usage }: { usage: UsageSummary }) {
  const { totals } = usage;
  return (
    <div data-testid="agent-usage-panel">
      <KpiStrip
        items={[
          { label: `Spend, last ${usage.days} days`, value: usd(totals.costUsd), sub: plural(totals.messages, 'reply', 'replies') },
          { label: 'Tokens in / out', value: `${compact(totals.inputTokens)} / ${compact(totals.outputTokens)}` },
          { label: 'Model calls', value: fmtCount(totals.llmCalls) },
          { label: 'Average per reply', value: totals.messages ? usd(totals.costUsd / totals.messages) : '—' },
        ]}
      />
    </div>
  );
}

export default function AdminChatsPage() {
  const [convos, setConvos] = useState<Convo[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [detailOnPhone, setDetailOnPhone] = useState(false);
  const [error, setError] = useState('');
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [usageFailed, setUsageFailed] = useState(false);

  const loadUsage = useCallback(() => {
    setUsageFailed(false);
    api<UsageSummary>('/admin/agent/usage')
      .then(setUsage)
      .catch(() => setUsageFailed(true));
  }, []);
  const loadConvos = useCallback(() => {
    setError('');
    api<Convo[]>('/admin/conversations')
      .then(d => {
        setConvos(d);
        if (d.length) setSelected(s => s ?? d[0]._id);
      })
      .catch(e => setError((e as Error).message));
  }, []);
  useEffect(loadUsage, [loadUsage]);
  useEffect(loadConvos, [loadConvos]);

  const active = convos?.find(c => c._id === selected);
  const costOf = (id: string) => usage?.conversations.find(c => c.conversationId === id);
  const activeCost = active ? costOf(active._id) : undefined;

  const finding =
    convos && usage
      ? convos.length === 0
        ? 'No one has talked to Aria yet.'
        : `${plural(convos.length, 'conversation')}; Aria spent ${usd(usage.totals.costUsd)} on ${plural(usage.totals.messages, 'reply', 'replies')} in the last ${usage.days} days.`
      : convos
        ? `${plural(convos.length, 'conversation')} with Aria, the shopping agent.`
        : null;

  const recent = usage ? usage.daily.slice(-7).reverse() : [];
  const priciest = usage ? [...usage.conversations].sort((a, b) => b.costUsd - a.costUsd).slice(0, 7) : [];

  return (
    <div data-testid="admin-chats-page">
      <PageHeader title="Agent chats" finding={finding} />

      <div className="mt-6">
        {usageFailed ? (
          <Panel>
            <BlockError what="model spend" onRetry={loadUsage} />
          </Panel>
        ) : usage ? (
          <UsageStrip usage={usage} />
        ) : (
          <KpiStrip loading items={['Spend', 'Tokens in / out', 'Model calls', 'Average per reply'].map(label => ({ label, value: '' }))} />
        )}
      </div>

      {error ? (
        <Panel className="mt-4">
          <BlockError what="conversations" onRetry={loadConvos} />
        </Panel>
      ) : !convos ? (
        <div className="mt-4 border border-border bg-card p-5">
          <LoadingRows rows={6} />
        </div>
      ) : convos.length === 0 ? (
        <Empty className="mt-4">No conversations yet. Chats from the shop&apos;s Aria widget appear here as they happen.</Empty>
      ) : (
        <div className="mt-4 grid border border-border bg-card lg:h-[620px] lg:grid-cols-[340px_minmax(0,1fr)]">
          <div className={cn('min-h-0 overflow-y-auto border-border lg:block lg:border-r', detailOnPhone && 'hidden')}>
            <p className="sticky top-0 border-b border-border bg-card px-4 py-3 text-[13px] text-muted-foreground">
              {plural(convos.length, 'conversation')}
            </p>
            <ul>
              {convos.map(c => {
                const cost = costOf(c._id);
                const current = selected === c._id;
                return (
                  <li key={c._id}>
                    <button
                      data-testid="chat-list-item"
                      aria-current={current ? 'true' : undefined}
                      onClick={() => {
                        setSelected(c._id);
                        setDetailOnPhone(true);
                      }}
                      className={cn(
                        'flex w-full gap-3 border-b border-border/70 px-4 py-3 text-left',
                        current ? 'bg-secondary' : 'hover:bg-foreground/[0.02]',
                      )}
                    >
                      <Initial name={who(c)} />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline justify-between gap-2">
                          <span className="truncate text-sm font-medium">{who(c)}</span>
                          <span className="flex-none text-xs text-muted-foreground">{fmtWhen(c.updatedAt)}</span>
                        </span>
                        <span className="mt-0.5 block truncate text-[13px]">
                          {c.preview || <span className="text-muted-foreground">No message from the customer</span>}
                        </span>
                        <span className="mt-0.5 block text-xs tabular-nums text-muted-foreground">
                          {plural(c.messageCount, 'message')}
                          {c.toolCallCount ? ` · ${plural(c.toolCallCount, 'tool call')}` : ''}
                          {cost ? ` · ${usd(cost.costUsd)}` : ''}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>

          <div data-testid="chat-transcript" className={cn('min-h-0 flex-col lg:flex', detailOnPhone ? 'flex' : 'hidden')}>
            {active ? (
              <>
                <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-border px-5 py-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <button
                      className="-ml-2 flex h-9 w-9 items-center justify-center lg:hidden"
                      aria-label="Back to the conversations"
                      onClick={() => setDetailOnPhone(false)}
                    >
                      <ArrowLeft className="h-4 w-4" />
                    </button>
                    <p className="min-w-0 truncate text-sm">
                      <span className="font-semibold">{who(active)}</span>
                      {active.userEmail && active.userName && <span className="text-muted-foreground"> · {active.userEmail}</span>}
                    </p>
                  </div>
                  <p className="text-xs tabular-nums text-muted-foreground">
                    {plural(active.toolCallCount, 'tool call')}
                    {activeCost && ` · ${compact(activeCost.inputTokens + activeCost.outputTokens)} tokens · ${usd(activeCost.costUsd)}`}
                  </p>
                </header>
                <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
                  {active.messages.map((m, i) =>
                    m.role === 'tool' ? (
                      <ToolLine key={i} m={m} />
                    ) : m.role === 'user' ? (
                      <div key={i} className="flex justify-end">
                        <div className="max-w-[80%]">
                          <p className="mb-1 text-right text-xs text-muted-foreground">Customer · {fmtWhen(m.at)}</p>
                          <p className="whitespace-pre-wrap bg-secondary px-3.5 py-2.5 text-sm leading-relaxed">{m.content}</p>
                        </div>
                      </div>
                    ) : (
                      <div key={i} className="max-w-[85%]">
                        <p className="mb-1 text-xs text-muted-foreground">Aria · {fmtWhen(m.at)}</p>
                        <p className="whitespace-pre-wrap border border-border px-3.5 py-2.5 text-sm leading-relaxed">{m.content}</p>
                        {m.action && (
                          <p className="mt-1.5 flex flex-wrap items-center gap-2 text-[13px]">
                            <span className="text-muted-foreground">Proposed: {m.action.summary}</span>
                            <Pill
                              tone={
                                m.action.status === 'confirmed' || m.action.status === 'done'
                                  ? 'positive'
                                  : m.action.status === 'declined'
                                    ? 'neutral'
                                    : 'warning'
                              }
                            >
                              {m.action.status.charAt(0).toUpperCase() + m.action.status.slice(1)}
                            </Pill>
                          </p>
                        )}
                        {m.usage && (
                          <p className="mt-1 text-xs tabular-nums text-muted-foreground">
                            {m.usage.model} · {fmtCount(m.usage.inputTokens)} → {fmtCount(m.usage.outputTokens)} tokens ·{' '}
                            {(m.usage.latencyMs / 1000).toFixed(1)} s · {usd(m.usage.costUsd)}
                          </p>
                        )}
                      </div>
                    ),
                  )}
                </div>
              </>
            ) : (
              <p className="p-5 text-sm text-muted-foreground">Choose a conversation to read it.</p>
            )}
          </div>
        </div>
      )}

      {usage && (
        <div className="mt-4 grid items-start gap-4 lg:grid-cols-2">
          <Panel title="Spend per day" meta="last 7 days with replies">
            {recent.length === 0 ? (
              <Empty>No model usage yet.</Empty>
            ) : (
              <table className="w-full text-sm tabular-nums">
                <thead>
                  <tr className="text-xs text-muted-foreground">
                    <th className="pb-2 text-left font-normal">Day</th>
                    <th className="pb-2 text-right font-normal">Replies</th>
                    <th className="pb-2 text-right font-normal">Tokens</th>
                    <th className="pb-2 text-right font-normal">Spend</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map(d => (
                    <tr key={d.date} className="border-t border-border/70">
                      <td className="py-2">
                        {new Date(`${d.date}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                      </td>
                      <td className="py-2 text-right">{fmtCount(d.messages)}</td>
                      <td className="py-2 text-right text-muted-foreground">{compact(d.inputTokens + d.outputTokens)}</td>
                      <td className="py-2 text-right font-medium">{usd(d.costUsd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>
          <Panel title="Costliest conversations" meta={`last ${usage.days} days`}>
            {priciest.length === 0 ? (
              <Empty>No conversation has used the model yet.</Empty>
            ) : (
              <ul className="text-sm">
                {priciest.map(c => {
                  const convo = convos?.find(x => x._id === c.conversationId);
                  return (
                    <li
                      key={c.conversationId}
                      className="flex items-center justify-between gap-3 border-t border-border/70 py-2 first:border-0 first:pt-0"
                    >
                      <button
                        className="min-w-0 truncate text-left underline decoration-border underline-offset-4 hover:decoration-foreground disabled:no-underline"
                        disabled={!convo}
                        onClick={() => {
                          setSelected(c.conversationId);
                          setDetailOnPhone(true);
                        }}
                      >
                        {convo ? who(convo) : 'An older conversation'}
                      </button>
                      <span className="flex-none tabular-nums">
                        <span className="text-xs text-muted-foreground">{compact(c.inputTokens + c.outputTokens)} tokens · </span>
                        <span className="font-medium">{usd(c.costUsd)}</span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>
        </div>
      )}
    </div>
  );
}
