'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import type { CartItem, User } from '@/lib/types';

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

const keyOf = (i: { productId: string; size: string }) => `${i.productId}::${i.size}`;

export function Providers({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null | false>(null);
  const [items, setItems] = useState<CartItem[]>([]);
  const [open, setOpen] = useState(false);
  const syncTimer = useRef<ReturnType<typeof setTimeout>>();
  const hydrated = useRef(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem('sf_cart');
      if (saved) setItems(JSON.parse(saved));
    } catch {}
    hydrated.current = true;
    api<{ user: User }>('/auth/me')
      .then(d => setUser(d.user))
      .catch(() => setUser(false));
  }, []);

  useEffect(() => {
    if (!hydrated.current) return;
    localStorage.setItem('sf_cart', JSON.stringify(items));
    if (user && typeof user === 'object') {
      clearTimeout(syncTimer.current);
      syncTimer.current = setTimeout(() => {
        api('/cart', { method: 'PUT', body: JSON.stringify({ items }) }).catch(() => {});
      }, 500);
    }
  }, [items, user]);

  const mergeServerCart = useCallback(async () => {
    try {
      const server = await api<{ items: CartItem[] }>('/cart');
      setItems(local => {
        const map = new Map(server.items.map(i => [keyOf(i), i]));
        for (const l of local) map.set(keyOf(l), l);
        return Array.from(map.values());
      });
    } catch {}
  }, []);

  useEffect(() => {
    if (user && typeof user === 'object') mergeServerCart();
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
        next[idx] = { ...next[idx], qty: Math.min(20, next[idx].qty + item.qty) };
        return next;
      }
      return [...prev, item];
    });
    setOpen(true);
  }, []);

  const updateQty = useCallback((productId: string, size: string, qty: number) => {
    setItems(prev =>
      qty < 1
        ? prev.filter(i => keyOf(i) !== `${productId}::${size}`)
        : prev.map(i => (keyOf(i) === `${productId}::${size}` ? { ...i, qty: Math.min(20, qty) } : i))
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
