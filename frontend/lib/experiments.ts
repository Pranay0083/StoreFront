'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Evaluation } from '@storefront/contracts';
import { api } from '@/lib/api';

const ANON_KEY = 'sf_aid';
const EXPOSED_KEY = 'sf_exposed';

const storage = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string) {
    try {
      localStorage.setItem(key, value);
    } catch {}
  },
  session(key: string): Set<string> {
    try {
      return new Set(JSON.parse(sessionStorage.getItem(key) ?? '[]') as string[]);
    } catch {
      return new Set();
    }
  },
  saveSession(key: string, values: Set<string>) {
    try {
      sessionStorage.setItem(key, JSON.stringify([...values]));
    } catch {}
  },
};

let evaluation: Promise<Evaluation | null> | null = null;

/** One evaluation per page load (and again after sign-in/out via `refreshExperiments`). */
function evaluate(): Promise<Evaluation | null> {
  evaluation ??= (async () => {
    const anonymousId = storage.get(ANON_KEY);
    const query = anonymousId ? `?anonymousId=${encodeURIComponent(anonymousId)}` : '';
    try {
      const result = await api<Evaluation>(`/experiments/evaluate${query}`);
      if (!anonymousId && result.subjectId.startsWith('anon_')) storage.set(ANON_KEY, result.subjectId);
      return result;
    } catch {
      return null;
    }
  })();
  return evaluation;
}

export function refreshExperiments(): void {
  evaluation = null;
}

export function useFlag(key: string, fallback = false): boolean {
  const [value, setValue] = useState(fallback);
  useEffect(() => {
    let live = true;
    evaluate().then(e => live && setValue(e?.flags[key] ?? fallback));
    return () => {
      live = false;
    };
  }, [key, fallback]);
  return value;
}

/**
 * Returns the assigned variant (null while loading or when not enrolled) and a function that
 * records an exposure once per session. Call `expose()` only when the variants would actually
 * render differently, so visitors who never reach the tested UI do not dilute the results.
 */
export function useExperiment(key: string): { variant: string | null; expose: () => void } {
  const [variant, setVariant] = useState<string | null>(null);
  const exposed = useRef(false);
  useEffect(() => {
    let live = true;
    evaluate().then(e => live && setVariant(e?.experiments[key] ?? null));
    return () => {
      live = false;
    };
  }, [key]);

  const expose = useCallback(() => {
    if (!variant || exposed.current) return;
    exposed.current = true;
    const seen = storage.session(EXPOSED_KEY);
    if (seen.has(key)) return;
    seen.add(key);
    storage.saveSession(EXPOSED_KEY, seen);
    const anonymousId = storage.get(ANON_KEY) ?? undefined;
    api('/experiments/exposures', { method: 'POST', body: JSON.stringify({ experiment: key, anonymousId }) }).catch(() => undefined);
  }, [key, variant]);

  return { variant, expose };
}
