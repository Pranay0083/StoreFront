'use client';

import { useEffect, useRef, useState } from 'react';

export type LiveStream = 'orders' | 'admin-orders' | 'stock';

export interface LiveEvent<T = Record<string, unknown>> {
  event: string;
  data: T & { channel: string };
}

const BASE = process.env.NEXT_PUBLIC_API_URL || '';
const EVENTS = ['order.status', 'order.placed', 'order.paid', 'stock.low'];

/**
 * Subscribes to the API's Server-Sent Events stream. EventSource reconnects on its own and sends
 * Last-Event-ID, so updates published while the connection was down are replayed by the server.
 */
export function useLiveEvents(streams: LiveStream[], onEvent: (e: LiveEvent) => void, enabled = true): boolean {
  const handler = useRef(onEvent);
  handler.current = onEvent;
  const [connected, setConnected] = useState(false);
  const key = streams.join(',');

  useEffect(() => {
    if (!enabled || typeof EventSource === 'undefined') return;
    const source = new EventSource(`${BASE}/api/v1/realtime/stream?channels=${encodeURIComponent(key)}`, { withCredentials: true });
    const listener = (e: MessageEvent) => {
      try {
        handler.current({ event: e.type, data: JSON.parse(e.data) });
      } catch {}
    };
    for (const name of EVENTS) source.addEventListener(name, listener);
    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);
    return () => {
      source.close();
      setConnected(false);
    };
  }, [key, enabled]);

  return connected;
}
