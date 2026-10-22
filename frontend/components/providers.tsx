'use client';

import { QueryClientProvider, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { refreshExperiments } from '@/lib/experiments';
import { ApiError, api } from '@/lib/api';
import { makeQueryClient, queryKeys } from '@/lib/query';
import { MAX_LINE_QTY, toCartLine, type CartItem, type CartLine, type CartResponse, type User } from '@storefront/contracts';

interface AuthCtx {
  user: User | null | false;
  login: (email: string, password: string) => Promise<User>;
  register: (name: string, email: string, password: string) => Promise<User>;
  logout: () => Promise<void>;
}

interface CartCtx {
  items: CartItem[];
  count: number;
  subtotal: number;
  open: boolean;
  syncing: boolean;
  setOpen: (v: boolean) => void;
  addItem: (item: CartItem) => void;
  updateQty: (productId: string, size: string, qty: number) => void;
  removeItem: (productId: string, size: string) => void;
  clear: () => void;
}

const AuthContext = createContext<AuthCtx>(null!);
const CartContext = createContext<CartCtx>(null!);

export const useAuth = () => useContext(AuthContext);
export const useCart = () => useContext(CartContext);

/** Bumped when the stored cart shape changes (v2: prices in paise). */
const CART_STORAGE_KEY = 'sf_cart_v2';
const SYNC_DEBOUNCE_MS = 500;

const keyOf = (i: { productId: string; size: string }) => `${i.productId}::${i.size}`;
const linesOf = (items: CartItem[]): CartLine[] => items.map(toCartLine);
const signature = (items: CartItem[]) => JSON.stringify(linesOf(items));
const maxQtyFor = (item: Pick<CartItem, 'stock'>) => Math.max(1, Math.min(MAX_LINE_QTY, item.stock ?? MAX_LINE_QTY));

function mergeCarts(server: CartItem[], local: CartItem[]): CartItem[] {
  const map = new Map(server.map(i => [keyOf(i), i]));
  for (const l of local) map.set(keyOf(l), { ...l, ...map.get(keyOf(l)), qty: l.qty });
  return Array.from(map.values());
}

function SessionProviders({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<User | null | false>(null);
  const [items, setItems] = useState<CartItem[]>([]);
  const [open, setOpen] = useState(false);
  const hydrated = useRef(false);
  const syncTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  /** The user whose server cart has been merged into the local one; syncing waits for that merge. */
  const mergedFor = useRef<string | null>(null);
  const signedIn = Boolean(user && typeof user === 'object');

  useEffect(() => {
    let saved: CartItem[] = [];
    try {
      saved = JSON.parse(localStorage.getItem(CART_STORAGE_KEY) || '[]');
    } catch {}
    setItems(saved);
    hydrated.current = true;
    api<{ user: User }>('/auth/me')
      .then(d => setUser(d.user))
      .catch(() => {
        setUser(false);
        // Guests keep the cart locally, but titles, prices and stock are refreshed from the server.
        if (saved.length) {
          api<CartResponse>('/cart/hydrate', { method: 'POST', body: JSON.stringify({ items: linesOf(saved) }) })
            .then(d => setItems(d.items))
            .catch(() => {});
        }
      });
  }, []);

  const serverCart = useQuery({
    queryKey: queryKeys.cart,
    queryFn: () => api<CartResponse>('/cart'),
    enabled: signedIn,
    staleTime: Infinity,
  });

  useEffect(() => {
    if (!signedIn || !serverCart.data || typeof user !== 'object' || !user) return;
    if (mergedFor.current === user.id) return;
    mergedFor.current = user.id;
    setItems(local => mergeCarts(serverCart.data.items, local));
  }, [signedIn, serverCart.data, user]);

  const sync = useMutation({
    mutationFn: (lines: CartLine[]) => api<CartResponse>('/cart', { method: 'PUT', body: JSON.stringify({ items: lines }) }),
    onSuccess: (data, sent) => {
      queryClient.setQueryData(queryKeys.cart, data);
      // Edits made while the request was in flight win; they will be synced next.
      setItems(current => (JSON.stringify(linesOf(current)) === JSON.stringify(sent) ? data.items : current));
    },
    onError: error => {
      // The server refused this cart (e.g. a line is no longer sellable): roll back to what it last accepted.
      if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
        const confirmed = queryClient.getQueryData<CartResponse>(queryKeys.cart);
        if (confirmed) setItems(confirmed.items);
        toast.error(error.message);
      }
    },
  });

  useEffect(() => {
    if (!hydrated.current) return;
    try {
      localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(items));
    } catch {}
    if (!signedIn || typeof user !== 'object' || !user || mergedFor.current !== user.id) return;
    const confirmed = queryClient.getQueryData<CartResponse>(queryKeys.cart);
    if (confirmed && signature(confirmed.items) === signature(items)) return;
    clearTimeout(syncTimer.current);
    syncTimer.current = setTimeout(() => sync.mutate(linesOf(items)), SYNC_DEBOUNCE_MS);
    // `sync` is stable for our purposes; depending on it would re-run on every mutation state change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, signedIn, user, queryClient]);

  const onSignedIn = useCallback(
    (next: User) => {
      refreshExperiments();
      mergedFor.current = null;
      queryClient.invalidateQueries();
      setUser(next);
      return next;
    },
    [queryClient],
  );

  const login = useCallback(
    async (email: string, password: string) => {
      const d = await api<{ user: User }>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
      return onSignedIn(d.user);
    },
    [onSignedIn],
  );

  const register = useCallback(
    async (name: string, email: string, password: string) => {
      const d = await api<{ user: User }>('/auth/register', { method: 'POST', body: JSON.stringify({ name, email, password }) });
      return onSignedIn(d.user);
    },
    [onSignedIn],
  );

  const logout = useCallback(async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => {});
    refreshExperiments();
    mergedFor.current = null;
    queryClient.clear();
    setUser(false);
  }, [queryClient]);

  const addItem = useCallback((item: CartItem) => {
    setItems(prev => {
      const idx = prev.findIndex(i => keyOf(i) === keyOf(item));
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], qty: Math.min(maxQtyFor(item), next[idx].qty + item.qty) };
        return next;
      }
      return [...prev, { ...item, qty: Math.min(maxQtyFor(item), item.qty) }];
    });
    setOpen(true);
  }, []);

  const updateQty = useCallback((productId: string, size: string, qty: number) => {
    const key = `${productId}::${size}`;
    setItems(prev =>
      qty < 1 ? prev.filter(i => keyOf(i) !== key) : prev.map(i => (keyOf(i) === key ? { ...i, qty: Math.min(maxQtyFor(i), qty) } : i)),
    );
  }, []);

  const removeItem = useCallback((productId: string, size: string) => {
    setItems(prev => prev.filter(i => keyOf(i) !== `${productId}::${size}`));
  }, []);

  const clear = useCallback(() => setItems([]), []);

  const count = items.reduce((s, i) => s + i.qty, 0);
  const subtotal = items.reduce((s, i) => s + i.price * i.qty, 0);

  return (
    <AuthContext.Provider value={{ user, login, register, logout }}>
      <CartContext.Provider
        value={{ items, count, subtotal, open, syncing: sync.isPending, setOpen, addItem, updateQty, removeItem, clear }}
      >
        {children}
      </CartContext.Provider>
    </AuthContext.Provider>
  );
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(makeQueryClient);
  return (
    <QueryClientProvider client={queryClient}>
      <SessionProviders>{children}</SessionProviders>
    </QueryClientProvider>
  );
}
