'use client';

import type { CartItem } from '@storefront/contracts';
import { ArrowUp, Check, Loader2, MessageSquare, Square, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useAuth, useCart } from '@/components/providers';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api, apiStream } from '@/lib/api';
import { cn } from '@/lib/utils';

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
    <div data-testid="agent-action-card" className="mt-2 bg-background p-4 text-[15px]">
      <p className="text-sm font-semibold">{ACTION_LABELS[action.type]}? Aria needs your go-ahead.</p>
      <p className="mt-1 leading-snug">{action.summary}</p>
      {action.status === 'pending' || busy ? (
        <div className="mt-3 flex gap-2">
          <Button data-testid="agent-action-confirm" size="sm" disabled={busy} onClick={() => onResolve(action, 'confirm')}>
            {busy ? <Loader2 className="animate-spin" aria-hidden /> : <Check aria-hidden />}
            Confirm
          </Button>
          <Button data-testid="agent-action-decline" size="sm" variant="ghost" disabled={busy} onClick={() => onResolve(action, 'decline')}>
            Not now
          </Button>
        </div>
      ) : (
        <p data-testid="agent-action-status" className="mt-2 text-sm text-muted-foreground">
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
  const pathname = usePathname();
  // Checkout keeps one task on screen, and the phone's pay bar owns the bottom edge there.
  if (pathname?.startsWith('/checkout')) return null;
  return <AgentWidgetInner />;
}

function AgentWidgetInner() {
  const [open, setOpen] = useState(false);
  /** Mounted once first opened, so the panel can play its exit and keep the conversation. */
  const [mounted, setMounted] = useState(false);
  /** Set a frame after mounting, so the panel enters from its starting style. */
  const [shown, setShown] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
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

  useEffect(() => {
    if (!open) {
      setShown(false);
      return;
    }
    setMounted(true);
    const frame = requestAnimationFrame(() => {
      setShown(true);
      inputRef.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [open]);

  const close = () => {
    setOpen(false);
    buttonRef.current?.focus();
  };

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
      {mounted && (
        <div
          ref={panelRef}
          id="agent-panel"
          role="dialog"
          aria-label="Chat with Aria"
          data-testid="agent-widget-panel"
          data-open={shown}
          inert={!open}
          onKeyDown={e => {
            if (e.key === 'Escape') close();
          }}
          className={cn(
            // Grows out of the button's corner: 200ms in, 150ms out, transform and opacity only.
            'fixed bottom-[calc(5.75rem+env(safe-area-inset-bottom,0px))] right-4 z-50 flex h-[min(600px,calc(100dvh-8rem))] w-[min(400px,calc(100vw-2rem))] origin-bottom-right flex-col bg-card shadow-[0_24px_60px_-16px_rgba(24,23,21,0.4)] transition-[transform,opacity,visibility] ease-out sm:right-5',
            shown
              ? 'visible scale-100 opacity-100 duration-200'
              : 'pointer-events-none invisible scale-95 opacity-0 duration-150 motion-reduce:scale-100',
          )}
        >
          <div className="flex items-start justify-between gap-4 px-5 pb-3 pt-5">
            <div>
              <h2 className="text-lg font-bold leading-tight tracking-[-0.02em]">Aria</h2>
              <p className="text-sm text-muted-foreground">Shopping assistant</p>
            </div>
            <button
              type="button"
              data-testid="agent-close-button"
              onClick={close}
              aria-label="Close chat"
              className="-mr-2 -mt-1 flex h-10 w-10 touch-manipulation items-center justify-center transition-[background-color,transform] duration-150 ease-out hover:bg-secondary active:scale-[0.97]"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>

          <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto overscroll-contain px-5 py-3" aria-live="polite">
            {messages.length === 0 && (
              <div data-testid="agent-empty-state">
                <p className="text-[15px] leading-relaxed">
                  Hi{user && typeof user === 'object' ? ` ${user.name.split(' ')[0]}` : ''}. I can find pieces, check sizes, get the best
                  price on your bag, track an order, and answer questions about shipping, returns and payment.
                </p>
                <div className="mt-5 space-y-2">
                  {SUGGESTIONS.map(s => (
                    <button
                      key={s}
                      type="button"
                      data-testid="agent-suggestion-chip"
                      onClick={() => send(s)}
                      className="block w-full touch-manipulation bg-secondary px-4 py-3 text-left text-[15px] transition-[background-color,transform] duration-150 ease-out hover:bg-accent active:scale-[0.98]"
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
                  <p
                    data-testid="agent-message-user"
                    className="max-w-[85%] bg-primary px-4 py-2.5 text-[15px] leading-relaxed text-primary-foreground"
                  >
                    {m.content}
                  </p>
                </div>
              ) : (
                <div key={i} className="flex">
                  <div className="max-w-[92%]">
                    {!!m.tools?.length && (
                      <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1">
                        {m.tools.map((t, j) => (
                          <span
                            key={`${t.name}-${j}`}
                            data-testid="agent-tool-chip"
                            className="flex items-center gap-1.5 text-sm text-muted-foreground"
                          >
                            {t.done ? (
                              <Check className="h-3.5 w-3.5" aria-hidden />
                            ) : (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                            )}
                            {t.title}
                          </span>
                        ))}
                      </div>
                    )}
                    {m.content ? (
                      <div data-testid="agent-message-assistant" className="bg-secondary px-4 py-3 text-[15px] leading-relaxed">
                        <AssistantText content={m.content} />
                      </div>
                    ) : (
                      m.streaming && (
                        <div
                          className="flex h-11 items-center gap-1.5 bg-secondary px-4"
                          data-testid="agent-typing-indicator"
                          aria-label="Aria is typing"
                        >
                          <span className="h-1.5 w-1.5 animate-bounce bg-foreground/60 [animation-delay:0ms]" />
                          <span className="h-1.5 w-1.5 animate-bounce bg-foreground/60 [animation-delay:150ms]" />
                          <span className="h-1.5 w-1.5 animate-bounce bg-foreground/60 [animation-delay:300ms]" />
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
            className="flex items-center gap-2 bg-background px-3 py-3"
          >
            <label htmlFor="agent-input" className="sr-only">
              Message Aria
            </label>
            <Input
              ref={inputRef}
              id="agent-input"
              data-testid="agent-input"
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder="Ask about pieces, prices or orders…"
              autoComplete="off"
              enterKeyHint="send"
              className="flex-1"
            />
            {loading ? (
              <Button
                type="button"
                variant="outline"
                size="icon"
                data-testid="agent-stop-button"
                onClick={() => abortRef.current?.abort()}
                aria-label="Stop generating"
                className="h-11 w-11 shrink-0"
              >
                <Square aria-hidden />
              </Button>
            ) : (
              <Button
                type="submit"
                size="icon"
                data-testid="agent-send-button"
                disabled={!input.trim()}
                aria-label="Send message"
                className="h-11 w-11 shrink-0"
              >
                <ArrowUp aria-hidden />
              </Button>
            )}
          </form>
        </div>
      )}

      <button
        ref={buttonRef}
        type="button"
        data-testid="agent-widget-button"
        onClick={() => setOpen(v => !v)}
        aria-label={open ? 'Close chat' : 'Chat with Aria, the AI assistant'}
        aria-expanded={open}
        aria-controls={mounted ? 'agent-panel' : undefined}
        className="fixed bottom-[calc(1.25rem+env(safe-area-inset-bottom,0px))] right-4 z-50 flex h-14 w-14 touch-manipulation select-none items-center justify-center bg-primary text-primary-foreground shadow-[0_10px_28px_-10px_rgba(24,23,21,0.55)] transition-[transform,background-color] duration-150 ease-out hover:bg-primary/85 active:scale-[0.97] sm:right-5"
      >
        {open ? <X className="h-5 w-5" aria-hidden /> : <MessageSquare className="h-5 w-5" aria-hidden />}
      </button>
    </>
  );
}
