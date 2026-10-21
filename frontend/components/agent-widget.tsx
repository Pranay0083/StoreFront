'use client';

import type { CartItem } from '@storefront/contracts';
import { ArrowUp, Check, Loader2, MessageSquare, Sparkles, Square, Wrench, X } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useAuth, useCart } from '@/components/providers';
import { api, apiStream } from '@/lib/api';

type ActionStatus = 'pending' | 'executing' | 'completed' | 'declined' | 'failed' | 'expired';

interface AgentAction {
  id: string;
  type: 'add_to_cart' | 'cancel_order' | 'request_refund';
  summary: string;
  status: ActionStatus;
  result?: { item?: CartItem | null };
  error?: string;
}

interface Msg {
  role: 'user' | 'assistant';
  content: string;
  action?: AgentAction;
  tools?: Array<{ name: string; title: string; done: boolean }>;
  streaming?: boolean;
}

interface ChatResult {
  reply: string;
  actions: AgentAction[];
}

type StreamEvent =
  | { event: 'token'; data: { text: string } }
  | { event: 'tool'; data: { name: string; title: string; status: 'start' | 'end' } }
  | { event: 'action'; data: { action: AgentAction } }
  | { event: 'done'; data: ChatResult }
  | { event: 'error'; data: { error: string } };

const SUGGESTIONS = [
  'Show me featured products',
  'Find me the best price for my bag',
  'Track my latest order',
  'Recommend footwear under ₹3000',
];

const ACTION_LABELS: Record<AgentAction['type'], string> = {
  add_to_cart: 'Add to bag',
  cancel_order: 'Cancel order',
  request_refund: 'Request refund',
};

function getSessionId() {
  let id = localStorage.getItem('sf_agent_session');
  if (!id) {
    id = `sess-${crypto.randomUUID()}`;
    localStorage.setItem('sf_agent_session', id);
  }
  return id;
}

function renderInline(text: string, keyPrefix: string) {
  const parts = text.split(/(\[[^\]]+\]\([^)]+\)|\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (link) {
      const href = link[2];
      const internal = href.startsWith('/');
      return internal ? (
        <Link key={`${keyPrefix}-${i}`} href={href} className="font-medium underline underline-offset-2 hover:opacity-70">
          {link[1]}
        </Link>
      ) : (
        <a
          key={`${keyPrefix}-${i}`}
          href={href}
          target="_blank"
          rel="noreferrer"
          className="font-medium underline underline-offset-2 hover:opacity-70"
        >
          {link[1]}
        </a>
      );
    }
    const bold = part.match(/^\*\*([^*]+)\*\*$/);
    if (bold) return <strong key={`${keyPrefix}-${i}`}>{bold[1]}</strong>;
    return <span key={`${keyPrefix}-${i}`}>{part}</span>;
  });
}

function AssistantText({ content }: { content: string }) {
  return (
    <div className="space-y-1.5">
      {content.split('\n').map((line, i) => {
        const clean = line.replace(/^#{1,4}\s*/, '').trim();
        if (!clean || /^[-—*_]{3,}$/.test(clean)) return null;
        return <p key={i}>{renderInline(clean, `l${i}`)}</p>;
      })}
    </div>
  );
}

/** Reads `event:`/`data:` blocks from a fetch body as they arrive. */
async function* readSse(res: Response): AsyncGenerator<StreamEvent> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let split: number;
    while ((split = buffer.indexOf('\n\n')) >= 0) {
      const block = buffer.slice(0, split);
      buffer = buffer.slice(split + 2);
      const event = /^event: (.+)$/m.exec(block)?.[1];
      const data = /^data: (.+)$/m.exec(block)?.[1];
      if (event && data) yield { event, data: JSON.parse(data) } as StreamEvent;
    }
  }
}

function ActionCard({ action, onResolve }: { action: AgentAction; onResolve: (a: AgentAction, decision: 'confirm' | 'decline') => void }) {
  const busy = action.status === 'executing';
  return (
    <div data-testid="agent-action-card" className="mt-2 border border-black bg-white p-3 text-sm">
      <p className="label-caps text-[10px] text-muted-foreground">{ACTION_LABELS[action.type]} · needs your OK</p>
      <p className="mt-1 leading-snug">{action.summary}</p>
      {action.status === 'pending' || busy ? (
        <div className="mt-3 flex gap-2">
          <button
            data-testid="agent-action-confirm"
            disabled={busy}
            onClick={() => onResolve(action, 'confirm')}
            className="flex h-8 items-center gap-1.5 bg-black px-3 text-xs font-medium text-white transition-opacity hover:opacity-80 disabled:opacity-40"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" strokeWidth={1.5} />} Confirm
          </button>
          <button
            data-testid="agent-action-decline"
            disabled={busy}
            onClick={() => onResolve(action, 'decline')}
            className="h-8 border border-black/20 px-3 text-xs transition-colors hover:border-black disabled:opacity-40"
          >
            Not now
          </button>
        </div>
      ) : (
        <p data-testid="agent-action-status" className="mt-2 text-xs text-muted-foreground">
          {action.status === 'completed' && 'Done.'}
          {action.status === 'declined' && 'Declined, nothing was changed.'}
          {action.status === 'expired' && 'This request expired. Ask again if you still want it.'}
          {action.status === 'failed' && `Couldn't complete this: ${action.error ?? 'please try again.'}`}
        </p>
      )}
    </div>
  );
}

export function AgentWidget() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const { user } = useAuth();
  const { items, addItem } = useCart();
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!open || loaded) return;
    api<{ messages: Msg[] }>(`/agent/history?sessionId=${getSessionId()}`)
      .then(d => setMessages(d.messages))
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, [open, loaded]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, loading, open]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const updateLast = (fn: (m: Msg) => Msg) => setMessages(prev => (prev.length ? [...prev.slice(0, -1), fn(prev[prev.length - 1])] : prev));

  const updateAction = (next: AgentAction) =>
    setMessages(prev => prev.map(m => (m.action?.id === next.id ? { ...m, action: { ...m.action, ...next } } : m)));

  const resolve = async (action: AgentAction, decision: 'confirm' | 'decline') => {
    updateAction({ ...action, status: 'executing' });
    try {
      const { action: done } = await api<{ action: AgentAction }>(`/agent/actions/${action.id}/${decision}`, { method: 'POST' });
      updateAction(done);
      if (done.status === 'completed' && done.type === 'add_to_cart' && done.result?.item) addItem(done.result.item);
    } catch (e) {
      const err = e as { status?: number; message?: string };
      updateAction({ ...action, status: err.status === 409 ? 'expired' : 'failed', error: err.message });
    }
  };

  const finish = (result: ChatResult) =>
    updateLast(m => ({ ...m, content: result.reply, action: result.actions.at(-1) ?? m.action, streaming: false }));

  const send = async (text: string) => {
    const message = text.trim();
    if (!message || loading) return;
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: message }, { role: 'assistant', content: '', tools: [], streaming: true }]);
    setLoading(true);
    const body = {
      sessionId: getSessionId(),
      message,
      context: { path: window.location.pathname, cart: items.map(i => ({ productId: i.productId, size: i.size, qty: i.qty })) },
    };
    const abort = new AbortController();
    abortRef.current = abort;
    try {
      const res = await apiStream('/agent/chat/stream', body, abort.signal).catch(() => null);
      if (!res?.ok || !res.body) {
        finish(await api<ChatResult>('/agent/chat', { method: 'POST', body: JSON.stringify(body) }));
        return;
      }
      for await (const e of readSse(res)) {
        if (e.event === 'token') updateLast(m => ({ ...m, content: m.content + e.data.text }));
        else if (e.event === 'tool')
          updateLast(m => ({
            ...m,
            content: e.data.status === 'start' ? '' : m.content,
            tools:
              e.data.status === 'start'
                ? [...(m.tools ?? []), { name: e.data.name, title: e.data.title, done: false }]
                : (m.tools ?? []).map(t => (t.name === e.data.name ? { ...t, done: true } : t)),
          }));
        else if (e.event === 'action') updateLast(m => ({ ...m, action: e.data.action }));
        else if (e.event === 'done') finish(e.data);
        else if (e.event === 'error') updateLast(m => ({ ...m, content: e.data.error, streaming: false }));
      }
    } catch (e) {
      if (abort.signal.aborted) updateLast(m => ({ ...m, content: m.content || 'Stopped.', streaming: false }));
      else updateLast(m => ({ ...m, content: (e as Error)?.message || 'Something went wrong. Please try again.', streaming: false }));
    } finally {
      updateLast(m => ({ ...m, streaming: false }));
      abortRef.current = null;
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  };

  return (
    <>
      {open && (
        <div
          data-testid="agent-widget-panel"
          className="fixed bottom-24 right-5 z-50 flex h-[min(600px,calc(100vh-8rem))] w-[min(400px,calc(100vw-2.5rem))] flex-col border border-black/15 bg-white shadow-[0_24px_60px_-12px_rgba(0,0,0,0.35)]"
        >
          <div className="flex items-center justify-between border-b border-black/10 bg-black px-5 py-4 text-white">
            <div>
              <p className="flex items-center gap-2 font-serif text-lg font-semibold leading-none">
                <Sparkles className="h-4 w-4" strokeWidth={1.5} /> Aria
              </p>
              <p className="label-caps mt-1.5 text-white/60">AI shopping concierge</p>
            </div>
            <button
              data-testid="agent-close-button"
              onClick={() => setOpen(false)}
              aria-label="Close chat"
              className="flex h-9 w-9 items-center justify-center transition-colors hover:bg-white/10"
            >
              <X className="h-4 w-4" strokeWidth={1.5} />
            </button>
          </div>

          <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-4 py-5">
            {messages.length === 0 && (
              <div data-testid="agent-empty-state">
                <p className="text-sm leading-relaxed text-muted-foreground">
                  Hi{user && typeof user === 'object' ? ` ${user.name.split(' ')[0]}` : ''}, I can help you find products, check sizes, get
                  the best price on your bag, track orders, and answer questions about shipping, returns, and payments.
                </p>
                <div className="mt-5 space-y-2">
                  {SUGGESTIONS.map(s => (
                    <button
                      key={s}
                      data-testid="agent-suggestion-chip"
                      onClick={() => send(s)}
                      className="block w-full border border-black/15 px-3 py-2 text-left text-sm transition-colors hover:bg-black hover:text-white"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((m, i) =>
              m.role === 'user' ? (
                <div key={i} className="flex justify-end">
                  <p data-testid="agent-message-user" className="max-w-[85%] bg-black px-3.5 py-2.5 text-sm leading-relaxed text-white">
                    {m.content}
                  </p>
                </div>
              ) : (
                <div key={i} className="flex">
                  <div className="max-w-[90%]">
                    {!!m.tools?.length && (
                      <div className="mb-1.5 flex flex-wrap gap-1.5">
                        {m.tools.map((t, j) => (
                          <span
                            key={`${t.name}-${j}`}
                            data-testid="agent-tool-chip"
                            className="label-caps flex items-center gap-1 border border-black/10 px-2 py-1 text-[10px] text-muted-foreground"
                          >
                            {t.done ? <Wrench className="h-3 w-3" strokeWidth={1.5} /> : <Loader2 className="h-3 w-3 animate-spin" />}
                            {t.title}
                          </span>
                        ))}
                      </div>
                    )}
                    {m.content ? (
                      <div
                        data-testid="agent-message-assistant"
                        className="border border-black/10 bg-secondary/60 px-3.5 py-2.5 text-sm leading-relaxed"
                      >
                        <AssistantText content={m.content} />
                      </div>
                    ) : (
                      m.streaming && (
                        <div className="flex items-center gap-1.5 border border-black/10 px-3.5 py-3" data-testid="agent-typing-indicator">
                          <span className="h-1.5 w-1.5 animate-bounce bg-black [animation-delay:0ms]" />
                          <span className="h-1.5 w-1.5 animate-bounce bg-black [animation-delay:150ms]" />
                          <span className="h-1.5 w-1.5 animate-bounce bg-black [animation-delay:300ms]" />
                        </div>
                      )
                    )}
                    {m.action && <ActionCard action={m.action} onResolve={resolve} />}
                  </div>
                </div>
              ),
            )}
          </div>

          <form
            onSubmit={e => {
              e.preventDefault();
              send(input);
            }}
            className="flex items-center gap-2 border-t border-black/10 p-3"
          >
            <input
              ref={inputRef}
              data-testid="agent-input"
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder="Ask about products, prices, orders…"
              className="h-10 flex-1 border border-input bg-white px-3 text-sm outline-none transition-colors focus:border-black"
            />
            {loading ? (
              <button
                type="button"
                data-testid="agent-stop-button"
                onClick={() => abortRef.current?.abort()}
                aria-label="Stop generating"
                className="flex h-10 w-10 shrink-0 items-center justify-center border border-black text-black transition-colors hover:bg-black hover:text-white"
              >
                <Square className="h-3.5 w-3.5" strokeWidth={1.5} />
              </button>
            ) : (
              <button
                type="submit"
                data-testid="agent-send-button"
                disabled={!input.trim()}
                aria-label="Send message"
                className="flex h-10 w-10 shrink-0 items-center justify-center bg-black text-white transition-opacity hover:opacity-80 disabled:opacity-30"
              >
                <ArrowUp className="h-4 w-4" strokeWidth={1.5} />
              </button>
            )}
          </form>
        </div>
      )}

      <button
        data-testid="agent-widget-button"
        onClick={() => setOpen(v => !v)}
        aria-label="Chat with Aria, the AI assistant"
        className="fixed bottom-5 right-5 z-50 flex h-14 w-14 items-center justify-center bg-black text-white shadow-[0_12px_32px_-8px_rgba(0,0,0,0.5)] transition-transform hover:scale-105"
      >
        {open ? <X className="h-5 w-5" strokeWidth={1.5} /> : <MessageSquare className="h-5 w-5" strokeWidth={1.5} />}
        {!open && <span className="absolute -right-0.5 -top-0.5 h-3 w-3 animate-pulse bg-emerald-500" />}
      </button>
    </>
  );
}
