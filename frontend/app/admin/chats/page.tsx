'use client';

import { Bot, MessageSquare, User as UserIcon, Wrench } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { api, fmtDateTime } from '@/lib/api';
import { cn } from '@/lib/utils';

interface ConvoMsg {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  toolName?: string;
  at: string;
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

function ToolLine({ m }: { m: ConvoMsg }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="pl-1">
      <button
        onClick={() => setOpen(v => !v)}
        className="label-caps flex items-center gap-2 text-[10px] text-muted-foreground hover:text-foreground"
      >
        <Wrench className="h-3 w-3" strokeWidth={1.5} /> tool · {m.toolName} {open ? '−' : '+'}
      </button>
      {open && (
        <pre className="mt-1 max-h-40 overflow-auto border border-black/10 bg-secondary/50 p-2 text-[10px] leading-relaxed">
          {(() => { try { return JSON.stringify(JSON.parse(m.content), null, 2); } catch { return m.content; } })()}
        </pre>
      )}
    </div>
  );
}

export default function AdminChatsPage() {
  const [convos, setConvos] = useState<Convo[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api<Convo[]>('/admin/conversations')
      .then(d => { setConvos(d); if (d.length) setSelected(d[0]._id); })
      .catch(e => setError(e.message));
  }, []);

  const active = convos?.find(c => c._id === selected);

  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!convos) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  return (
    <div data-testid="admin-chats-page">
      <div className="flex items-end justify-between">
        <div>
          <p className="label-caps text-muted-foreground">Aria · AI concierge</p>
          <h1 className="mt-1 font-serif text-3xl font-semibold">Agent chats</h1>
        </div>
        <p className="text-sm text-muted-foreground">{convos.length} conversation{convos.length === 1 ? '' : 's'}</p>
      </div>

      {convos.length === 0 ? (
        <div className="mt-10 border border-dashed border-black/20 p-16 text-center">
          <MessageSquare className="mx-auto h-8 w-8 text-muted-foreground" strokeWidth={1} />
          <p className="mt-4 text-sm text-muted-foreground">
            No conversations yet — chats from the storefront widget will appear here.
          </p>
        </div>
      ) : (
        <div className="mt-8 grid gap-6 lg:grid-cols-[340px_1fr]">
          <div className="max-h-[70vh] space-y-2 overflow-y-auto pr-1">
            {convos.map(c => (
              <button
                key={c._id}
                data-testid="chat-list-item"
                onClick={() => setSelected(c._id)}
                className={cn(
                  'w-full border px-4 py-3 text-left transition-colors',
                  selected === c._id ? 'border-black bg-black text-white' : 'border-black/10 bg-white hover:border-black/40'
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-sm font-medium">
                    {c.userName || c.userEmail || 'Guest visitor'}
                  </p>
                  <span className={cn('label-caps text-[10px]', selected === c._id ? 'text-white/60' : 'text-muted-foreground')}>
                    {c.messageCount} msgs
                  </span>
                </div>
                <p className={cn('mt-1 truncate text-xs', selected === c._id ? 'text-white/70' : 'text-muted-foreground')}>
                  {c.preview || '—'}
                </p>
                <p className={cn('mt-1.5 text-[10px]', selected === c._id ? 'text-white/50' : 'text-muted-foreground/70')}>
                  {fmtDateTime(c.updatedAt)}{c.userEmail ? ` · ${c.userEmail}` : ''}
                </p>
              </button>
            ))}
          </div>

          <div data-testid="chat-transcript" className="max-h-[70vh] overflow-y-auto border border-black/10 bg-white p-5">
            {active ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between border-b border-black/10 pb-3">
                  <p className="text-sm font-medium">
                    {active.userName || 'Guest visitor'}
                    {active.userEmail && <span className="ml-2 text-xs text-muted-foreground">{active.userEmail}</span>}
                  </p>
                  <p className="label-caps text-[10px] text-muted-foreground">
                    session {active.sessionId.slice(0, 18)}… · {active.toolCallCount} tool calls
                  </p>
                </div>
                {active.messages.map((m, i) =>
                  m.role === 'tool' ? (
                    <ToolLine key={i} m={m} />
                  ) : m.role === 'user' ? (
                    <div key={i} className="flex justify-end">
                      <div className="max-w-[80%]">
                        <p className="label-caps mb-1 flex items-center justify-end gap-1.5 text-[10px] text-muted-foreground">
                          <UserIcon className="h-3 w-3" strokeWidth={1.5} /> customer · {fmtDateTime(m.at)}
                        </p>
                        <p className="bg-black px-3.5 py-2.5 text-sm leading-relaxed text-white">{m.content}</p>
                      </div>
                    </div>
                  ) : (
                    <div key={i} className="flex">
                      <div className="max-w-[85%]">
                        <p className="label-caps mb-1 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                          <Bot className="h-3 w-3" strokeWidth={1.5} /> aria · {fmtDateTime(m.at)}
                        </p>
                        <p className="whitespace-pre-wrap border border-black/10 bg-secondary/60 px-3.5 py-2.5 text-sm leading-relaxed">
                          {m.content}
                        </p>
                      </div>
                    </div>
                  )
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Select a conversation to view its transcript.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
