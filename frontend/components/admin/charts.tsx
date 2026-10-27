'use client';

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { paiseToRupees } from '@storefront/contracts';

import { fmtCount, fmtRupees } from './ledger';

/**
 * Charts drawn to app-screens §6, not to recharts' defaults: one series, 3-5 faint horizontal
 * gridlines, no y-axis line, round ticks that top out above the largest value, a heavier baseline,
 * square bars in the one data hue, x labels on one step that lands on the last day, a bare tooltip,
 * and no entrance animation.
 */

/** Round ticks (steps of 1, 2, 2.5 or 5 x 10^n) whose top sits above the largest value. */
export function niceTicks(max: number, count = 4): number[] {
  if (max <= 0) return [0, 1, 2, 3, 4].map(v => v * 1000_00);
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw) ?? 10 * mag;
  let top = Math.ceil(max / step) * step;
  if (top <= max) top += step;
  const out: number[] = [];
  for (let v = 0; v <= top + step / 2; v += step) out.push(Math.round(v));
  return out;
}

/** ₹40k, ₹1.2L: axis money in the store's own grouping, short enough for a tick. */
const tickMoney = (paise: number) => {
  const r = paiseToRupees(paise);
  if (r === 0) return '₹0';
  if (r >= 100_000) return `₹${+(r / 100_000).toFixed(1)}L`;
  if (r >= 1000) return `₹${+(r / 1000).toFixed(r % 1000 ? 1 : 0)}k`;
  return `₹${r}`;
};

const dayLabel = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

export interface DayRevenue {
  date: string;
  revenue: number;
  orders: number;
}

/** Fills the days with no paid orders with real zeros, so an empty day is a missing bar, not a gap in time. */
export function fillDays(rows: DayRevenue[], days: number, today = new Date()): DayRevenue[] {
  const byDate = new Map(rows.map(r => [r.date, r]));
  const out: DayRevenue[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    out.push(byDate.get(key) ?? { date: key, revenue: 0, orders: 0 });
  }
  return out;
}

function DayTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: DayRevenue }> }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="border border-border bg-card px-2.5 py-1.5 text-xs tabular-nums shadow-sm">
      <span className="text-muted-foreground">{dayLabel(d.date)}</span> <span className="font-medium">{fmtRupees(d.revenue)}</span>{' '}
      <span className="text-muted-foreground">· {d.orders === 1 ? '1 order' : `${fmtCount(d.orders)} orders`}</span>
    </div>
  );
}

/** Revenue per day as square columns in the data hue: the overview's main data element. */
export function RevenueBars({ data, height = 220 }: { data: DayRevenue[]; height?: number }) {
  const ticks = niceTicks(Math.max(0, ...data.map(d => d.revenue)));
  // One x step (a week) that lands on today, the last column.
  const xTicks = data.filter((_, i) => (data.length - 1 - i) % 7 === 0).map(d => d.date);
  return (
    <div style={{ height }} role="img" aria-label={`Revenue per day for the last ${data.length} days`}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 6, right: 20, bottom: 0, left: 0 }} barCategoryGap="22%">
          <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
          <YAxis
            width={52}
            axisLine={false}
            tickLine={false}
            ticks={ticks}
            domain={[0, ticks[ticks.length - 1]]}
            tickFormatter={tickMoney}
            tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
          />
          <XAxis
            dataKey="date"
            ticks={xTicks}
            interval={0}
            tickFormatter={dayLabel}
            tickLine={false}
            axisLine={{ stroke: 'hsl(var(--foreground))', strokeOpacity: 0.5 }}
            tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
            tickMargin={8}
          />
          <Tooltip cursor={{ fill: 'hsl(var(--foreground) / 0.04)' }} content={<DayTooltip />} isAnimationActive={false} />
          <Bar dataKey="revenue" fill="hsl(var(--chart))" radius={0} isAnimationActive={false} maxBarSize={28} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
