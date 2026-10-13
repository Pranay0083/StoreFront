'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CartLine, PriceQuote } from '@storefront/contracts';
import { api, ApiError } from '@/lib/api';

/** Errors from checkout that mean "the quote is stale, fetch a new one and show it". */
export const REQUOTE_CODES = new Set(['PRICE_CHANGED', 'QUOTE_EXPIRED', 'QUOTE_CART_MISMATCH', 'PROMOTION_EXHAUSTED']);

const DEBOUNCE_MS = 300;

interface State {
  quote: PriceQuote | null;
  loading: boolean;
  error: string | null;
}

/**
 * Keeps a server price quote in sync with the cart. Requests are debounced and only the latest
 * response is kept, so fast quantity changes never show an out-of-date total.
 */
export function usePriceQuote(lines: readonly CartLine[], codes: readonly string[]) {
  const [state, setState] = useState<State>({ quote: null, loading: false, error: null });
  const seq = useRef(0);
  const body = useMemo(
    () => JSON.stringify({ items: lines.map(({ productId, size, qty }) => ({ productId, size, qty })), codes: [...codes] }),
    [lines, codes],
  );

  const fetchQuote = useCallback(async (payload: string) => {
    const id = ++seq.current;
    setState(s => ({ ...s, loading: true }));
    try {
      const quote = await api<PriceQuote>('/pricing/quote', { method: 'POST', body: payload });
      if (id === seq.current) setState({ quote, loading: false, error: null });
      return quote;
    } catch (e) {
      if (id === seq.current)
        setState(s => ({ ...s, loading: false, error: e instanceof ApiError ? e.message : 'Could not price your bag' }));
      return null;
    }
  }, []);

  useEffect(() => {
    if (!lines.length) {
      seq.current++;
      setState({ quote: null, loading: false, error: null });
      return;
    }
    setState(s => ({ ...s, loading: true }));
    const timer = setTimeout(() => fetchQuote(body), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [body, lines.length, fetchQuote]);

  const refresh = useCallback(() => fetchQuote(body), [body, fetchQuote]);

  return { ...state, refresh };
}
