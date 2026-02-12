'use client';

import { AlertTriangle, IndianRupee, Package, TrendingUp, Users } from 'lucide-react';
import Image from 'next/image';
import { useEffect, useState } from 'react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { api, fmtINR } from '@/lib/api';

interface Stats { revenue: number; paidOrders: number; avgOrderValue: number; totalOrders: number; customers: number; pendingOrders: number }

export default function AdminDashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [revenue, setRevenue] = useState<{ date: string; revenue: number; orders: number }[] | null>(null);
  const [funnel, setFunnel] = useState<{ stage: string; count: number }[] | null>(null);
  const [top, setTop] = useState<any[] | null>(null);
  const [lowStock, setLowStock] = useState<any[] | null>(null);

  useEffect(() => {
    api<Stats>('/admin/stats').then(setStats).catch(() => {});
    api<any[]>('/admin/revenue-by-day?days=30').then(setRevenue).catch(() => setRevenue([]));
    api<any[]>('/admin/funnel').then(setFunnel).catch(() => setFunnel([]));
    api<any[]>('/admin/top-products').then(setTop).catch(() => setTop([]));
    api<any[]>('/admin/low-stock').then(setLowStock).catch(() => setLowStock([]));
  }, []);

  const kpis = stats ? [
    { label: 'Revenue (all time)', value: fmtINR(stats.revenue), icon: IndianRupee, testId: 'kpi-revenue' },
    { label: 'Paid orders', value: String(stats.paidOrders), icon: Package, testId: 'kpi-paid-orders' },
    { label: 'Avg order value', value: fmtINR(stats.avgOrderValue), icon: TrendingUp, testId: 'kpi-aov' },
    { label: 'Customers', value: String(stats.customers), icon: Users, testId: 'kpi-customers' },
  ] : [];

  const maxFunnel = funnel?.[0]?.count || 1;

  return (
    <div className="space-y-6" data-testid="admin-dashboard">
      <div>
        <h1 className="font-serif text-3xl font-semibold tracking-tight sm:text-4xl">Dashboard</h1>
        <p className="mt-1 text-sm text-muted-foreground">Built on MongoDB aggregation pipelines — revenue, funnel, top products, stock.</p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {stats === null
          ? Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28 w-full" />)
          : kpis.map(k => (
              <div key={k.label} data-testid={k.testId} className="border border-black/10 bg-white p-5">
                <div className="flex items-center justify-between">
                  <p className="label-caps text-muted-foreground">{k.label}</p>
                  <k.icon className="h-4 w-4 text-muted-foreground" strokeWidth={1.5} />
                </div>
                <p className="mt-3 font-serif text-3xl font-semibold">{k.value}</p>
              </div>
            ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="border border-black/10 bg-white p-6 lg:col-span-2" data-testid="revenue-chart">
          <div className="flex items-center justify-between">
            <p className="label-caps text-muted-foreground">Revenue by day — last 30 days</p>
            {stats && <Badge variant="secondary">{stats.pendingOrders} awaiting fulfilment</Badge>}
          </div>
          <div className="mt-5 h-72">
            {revenue === null ? (
              <Skeleton className="h-full w-full" />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={revenue} margin={{ top: 5, right: 5, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#0A0A0A" stopOpacity={0.18} />
                      <stop offset="100%" stopColor="#0A0A0A" stopOpacity={0.01} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(d: string) => d.slice(5)} stroke="rgba(0,0,0,0.35)" />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => `${Math.round(v / 1000)}k`} stroke="rgba(0,0,0,0.35)" width={40} />
                  <Tooltip
                    formatter={(v: any) => [fmtINR(Number(v)), 'Revenue']}
                    contentStyle={{ borderRadius: 0, border: '1px solid rgba(0,0,0,0.15)', fontSize: 12 }}
                  />
                  <Area type="monotone" dataKey="revenue" stroke="#0A0A0A" strokeWidth={1.75} fill="url(#rev)" />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="border border-black/10 bg-white p-6" data-testid="funnel-widget">
          <p className="label-caps text-muted-foreground">Conversion funnel</p>
          <div className="mt-6 space-y-5">
            {funnel === null
              ? Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)
              : funnel.map((f, i) => (
                  <div key={f.stage}>
                    <div className="mb-1.5 flex justify-between text-sm">
                      <span>{f.stage}</span>
                      <span className="font-semibold">{f.count}</span>
                    </div>
                    <div className="h-2.5 w-full bg-black/[0.06]">
                      <div
                        className="h-full bg-black transition-[width] duration-700"
                        style={{ width: `${Math.max(3, (f.count / maxFunnel) * 100)}%`, opacity: 1 - i * 0.15 }}
                      />
                    </div>
                  </div>
                ))}
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="border border-black/10 bg-white p-6" data-testid="top-products-widget">
          <p className="label-caps text-muted-foreground">Top products by revenue</p>
          <div className="mt-5 space-y-4">
            {top === null
              ? Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)
              : top.map((p, i) => (
                  <div key={p._id} className="flex items-center gap-4">
                    <span className="w-5 font-serif text-lg text-muted-foreground">{i + 1}</span>
                    <div className="relative h-12 w-10 shrink-0 overflow-hidden bg-muted">
                      {p.image && <Image src={p.image} alt="" fill sizes="40px" className="object-cover" />}
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-medium leading-tight">{p.title}</p>
                      <p className="text-xs text-muted-foreground">{p.units} units</p>
                    </div>
                    <p className="text-sm font-semibold">{fmtINR(p.revenue)}</p>
                  </div>
                ))}
          </div>
        </div>

        <div className="border border-black/10 bg-white p-6" data-testid="low-stock-widget">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-destructive" strokeWidth={1.5} />
            <p className="label-caps text-muted-foreground">Low stock alerts (&lt; 5 units)</p>
          </div>
          <div className="mt-5 space-y-3">
            {lowStock === null
              ? Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)
              : lowStock.length === 0
                ? <p className="text-sm text-muted-foreground">All stocked up.</p>
                : lowStock.map((r, i) => (
                    <div key={`${r._id}-${r.size}-${i}`} className="flex items-center gap-4 border-b border-black/5 pb-3 last:border-0">
                      <div className="relative h-10 w-8 shrink-0 overflow-hidden bg-muted">
                        {r.image && <Image src={r.image} alt="" fill sizes="32px" className="object-cover" />}
                      </div>
                      <div className="flex-1">
                        <p className="text-sm font-medium leading-tight">{r.title}</p>
                        <p className="text-xs text-muted-foreground">Size {r.size}</p>
                      </div>
                      <Badge variant={r.stock === 0 ? 'destructive' : 'warning'}>{r.stock} left</Badge>
                    </div>
                  ))}
          </div>
        </div>
      </div>
    </div>
  );
}
