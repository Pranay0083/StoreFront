'use client';

import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useState } from 'react';
import { Input } from '@/components/ui/input';
import { api, fmtINR } from '@/lib/api';
import { queryKeys } from '@/lib/query';
import { cn } from '@/lib/utils';
import type { ProductSuggestion } from '@storefront/contracts';

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

/** Search field with an ARIA combobox of typo-tolerant suggestions; Enter searches, arrows pick a product. */
export function SearchBox({ initial, onSearch }: { initial: string; onSearch: (q: string) => void }) {
  const router = useRouter();
  const listId = useId();
  const [value, setValue] = useState(initial);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const term = useDebounced(value.trim(), 200);

  const { data } = useQuery({
    queryKey: queryKeys.suggest(term),
    queryFn: () => api<{ suggestions: ProductSuggestion[] }>(`/products/suggest?q=${encodeURIComponent(term)}&limit=6`),
    enabled: term.length >= 2,
    staleTime: 60_000,
  });
  const suggestions = term.length >= 2 ? (data?.suggestions ?? []) : [];
  const expanded = open && suggestions.length > 0;

  const choose = (s: ProductSuggestion) => {
    setOpen(false);
    router.push(`/products/${s.slug}`);
  };

  return (
    <form
      role="search"
      className="relative w-full sm:w-auto"
      onSubmit={e => {
        e.preventDefault();
        if (expanded && active >= 0) return choose(suggestions[active]);
        setOpen(false);
        onSearch(value.trim());
      }}
    >
      <label htmlFor={`${listId}-input`} className="sr-only">
        Search the collection
      </label>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
      <Input
        id={`${listId}-input`}
        data-testid="products-search-input"
        role="combobox"
        aria-expanded={expanded}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={expanded && active >= 0 ? `${listId}-${active}` : undefined}
        autoComplete="off"
        value={value}
        onChange={e => {
          setValue(e.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={e => {
          if (!expanded) return;
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive(i => (i + 1) % suggestions.length);
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive(i => (i <= 0 ? suggestions.length - 1 : i - 1));
          } else if (e.key === 'Escape') {
            setOpen(false);
          }
        }}
        placeholder="Search pieces…"
        className="w-full pl-9 sm:w-72"
      />
      {expanded && (
        <ul
          id={listId}
          role="listbox"
          data-testid="search-suggestions"
          className="absolute left-0 right-0 top-full z-30 mt-1 bg-card py-1 shadow-xl duration-150 ease-out animate-in fade-in-0 slide-in-from-top-1"
        >
          {suggestions.map((s, i) => (
            <li
              key={s.slug}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={e => {
                e.preventDefault();
                choose(s);
              }}
              className={cn(
                'flex cursor-pointer items-baseline justify-between gap-3 px-3.5 py-2.5 text-[15px]',
                i === active && 'bg-secondary',
              )}
            >
              <span>
                {s.title} <span className="text-sm text-muted-foreground">in {s.category}</span>
              </span>
              <span className="shrink-0">{fmtINR(s.price)}</span>
            </li>
          ))}
        </ul>
      )}
    </form>
  );
}
