'use client';

import { ArrowUp, MessageSquare, Sparkles, X } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useAuth, useCart } from '@/components/providers';
import { api } from '@/lib/api';

interface Msg {
  role: 'user' | 'assistant';
  content: string;
}

const SUGGESTIONS = [
  'Show me featured products',
  "What's your shipping policy?",
  'Track my latest order',
  'Recommend footwear under ₹3000',
];

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
        <a key={`${keyPrefix}-${i}`} href={href} target="_blank" rel="noreferrer" className="font-medium underline underline-offset-2 hover:opacity-70">
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

export function AgentWidget() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const { user } = useAuth();
  const { items } = useCart();
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

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

  const send = async (text: string) => {
    const message = text.trim();
    if (!message || loading) return;
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: message }]);
    setLoading(true);
    try {
      const d = await api<{ reply: string }>('/agent/chat', {
        method: 'POST',
        body: JSON.stringify({
          sessionId: getSessionId(),
          message,
          context: {
            path: window.location.pathname,
            cart: items.map(i => ({ title: i.title, size: i.size, qty: i.qty, price: i.price })),
          },
        }),
      });
      setMessages(prev => [...prev, { role: 'assistant', content: d.reply }]);
    } catch (e: any) {
      setMessages(prev => [...prev, { role: 'assistant', content: e?.message || 'Something went wrong — please try again.' }]);
    } finally {
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
                  Hi{user && typeof user === 'object' ? ` ${user.name.split(' ')[0]}` : ''} — I can help you find products,
                  check sizes, track orders, and answer questions about shipping, returns, and payments.
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
                  <div data-testid="agent-message-assistant" className="max-w-[90%] border border-black/10 bg-secondary/60 px-3.5 py-2.5 text-sm leading-relaxed">
                    <AssistantText content={m.content} />
                  </div>
                </div>
              )
            )}
            {loading && (
              <div className="flex" data-testid="agent-typing-indicator">
                <div className="flex items-center gap-1.5 border border-black/10 px-3.5 py-3">
                  <span className="h-1.5 w-1.5 animate-bounce bg-black [animation-delay:0ms]" />
                  <span className="h-1.5 w-1.5 animate-bounce bg-black [animation-delay:150ms]" />
                  <span className="h-1.5 w-1.5 animate-bounce bg-black [animation-delay:300ms]" />
                </div>
              </div>
            )}
          </div>

          <form
            onSubmit={e => { e.preventDefault(); send(input); }}
            className="flex items-center gap-2 border-t border-black/10 p-3"
          >
            <input
              ref={inputRef}
              data-testid="agent-input"
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder="Ask about products, orders, shipping…"
              className="h-10 flex-1 border border-input bg-white px-3 text-sm outline-none transition-colors focus:border-black"
            />
            <button
              type="submit"
              data-testid="agent-send-button"
              disabled={loading || !input.trim()}
              aria-label="Send message"
              className="flex h-10 w-10 shrink-0 items-center justify-center bg-black text-white transition-opacity hover:opacity-80 disabled:opacity-30"
            >
              <ArrowUp className="h-4 w-4" strokeWidth={1.5} />
            </button>
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
