'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
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

const keyOf = (i: { productId: string; size: string }) => `${i.productId}::${i.size}`;
const linesOf = (items: CartItem[]): CartLine[] => items.map(toCartLine);
const signature = (items: CartItem[]) => JSON.stringify(linesOf(items));
const maxQtyFor = (item: Pick<CartItem, 'stock'>) => Math.max(1, Math.min(MAX_LINE_QTY, item.stock ?? MAX_LINE_QTY));

export function Providers({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null | false>(null);
  const [items, setItems] = useState<CartItem[]>([]);
  const [open, setOpen] = useState(false);
  const syncTimer = useRef<ReturnType<typeof setTimeout>>();
  const hydrated = useRef(false);
  /** Lines the server last confirmed; skips redundant PUTs when only display data changed. */
  const syncedSignature = useRef<string | null>(null);

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

  useEffect(() => {
    if (!hydrated.current) return;
    try {
      localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(items));
    } catch {}
    if (!user || typeof user !== 'object' || syncedSignature.current === null) return;
    if (signature(items) === syncedSignature.current) return;
    clearTimeout(syncTimer.current);
    syncTimer.current = setTimeout(() => {
      const sent = signature(items);
      api<CartResponse>('/cart', { method: 'PUT', body: JSON.stringify({ items: linesOf(items) }) })
        .then(d => {
          syncedSignature.current = signature(d.items);
          // Edits made while the request was in flight win; they will be synced next.
          setItems(current => (signature(current) === sent ? d.items : current));
        })
        .catch(() => {});
    }, 500);
  }, [items, user]);

  const mergeServerCart = useCallback(async () => {
    try {
      const server = await api<CartResponse>('/cart');
      syncedSignature.current = signature(server.items);
      setItems(local => {
        const map = new Map(server.items.map(i => [keyOf(i), i]));
        for (const l of local) map.set(keyOf(l), { ...l, ...map.get(keyOf(l)), qty: l.qty });
        return Array.from(map.values());
      });
    } catch {}
  }, []);

  useEffect(() => {
    if (user && typeof user === 'object') mergeServerCart();
    else syncedSignature.current = null;
  }, [user, mergeServerCart]);

  const login = useCallback(async (email: string, password: string) => {
    const d = await api<{ user: User }>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
    setUser(d.user);
    return d.user;
  }, []);

  const register = useCallback(async (name: string, email: string, password: string) => {
    const d = await api<{ user: User }>('/auth/register', { method: 'POST', body: JSON.stringify({ name, email, password }) });
    setUser(d.user);
    return d.user;
  }, []);

  const logout = useCallback(async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => {});
    setUser(false);
  }, []);

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
      <CartContext.Provider value={{ items, count, subtotal, open, setOpen, addItem, updateQty, removeItem, clear }}>
        {children}
      </CartContext.Provider>
    </AuthContext.Provider>
  );
}
