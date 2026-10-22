'use client';

import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  CUSTOMER_SEGMENTS,
  PAYMENT_METHODS,
  type ActionSpec,
  type ActionType,
  type ConditionSpec,
  type CustomerSegment,
  type PaymentMethod,
  type ProductSelector,
} from '@storefront/contracts';

const list = (v: string) =>
  v
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

export function Field({ label, children, className = '' }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`block text-xs text-muted-foreground ${className}`}>
      {label}
      {children}
    </label>
  );
}

/** Edits an integer paise amount in rupees. */
export function RupeeInput({ value, onChange }: { value: number | undefined; onChange: (paise: number | undefined) => void }) {
  return (
    <Input
      type="number"
      min={0}
      step="0.01"
      value={value === undefined ? '' : value / 100}
      onChange={e => onChange(e.target.value === '' ? undefined : Math.round(Number(e.target.value) * 100))}
      className="mt-1 h-9"
    />
  );
}

function NumberInput({ value, onChange, min = 0, max }: { value: number; onChange: (n: number) => void; min?: number; max?: number }) {
  return <Input type="number" min={min} max={max} value={value} onChange={e => onChange(Number(e.target.value))} className="mt-1 h-9" />;
}

export function SelectorEditor({ value, onChange }: { value: ProductSelector | undefined; onChange: (s: ProductSelector) => void }) {
  const set = (key: keyof ProductSelector, raw: string) => {
    const next: Record<string, string[]> = { ...(value ?? {}) };
    const items = list(raw);
    if (items.length) next[key] = items;
    else delete next[key];
    onChange(next as ProductSelector);
  };
  return (
    <div className="grid gap-2 sm:grid-cols-3">
      <Field label="Categories (comma-separated)">
        <Input defaultValue={value?.categories?.join(', ')} onBlur={e => set('categories', e.target.value)} className="mt-1 h-9" />
      </Field>
      <Field label="Product slugs">
        <Input defaultValue={value?.slugs?.join(', ')} onBlur={e => set('slugs', e.target.value)} className="mt-1 h-9 font-mono" />
      </Field>
      <Field label="Product ids">
        <Input
          defaultValue={value?.productIds?.join(', ')}
          onBlur={e => set('productIds', e.target.value)}
          className="mt-1 h-9 font-mono"
        />
      </Field>
    </div>
  );
}

const CONDITION_LABELS: Record<ConditionSpec['type'], string> = {
  all: 'All of (AND)',
  any: 'Any of (OR)',
  not: 'Not',
  cartContains: 'Cart contains',
  minSubtotal: 'Minimum subtotal',
  customerSegment: 'Customer segment',
  dateWindow: 'Date / time window',
  paymentMethod: 'Payment method',
};

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function defaultCondition(type: ConditionSpec['type']): ConditionSpec {
  switch (type) {
    case 'all':
    case 'any':
      return { type, conditions: [{ type: 'minSubtotal', amount: 100_000 }] };
    case 'not':
      return { type, condition: { type: 'customerSegment', segment: 'guest' } };
    case 'cartContains':
      return { type, selector: { categories: ['Men'] }, minQty: 1 };
    case 'minSubtotal':
      return { type, amount: 100_000 };
    case 'customerSegment':
      return { type, segment: 'firstOrder' };
    case 'dateWindow':
      return { type, daysOfWeek: [5, 6] };
    case 'paymentMethod':
      return { type, methods: ['upi'] };
  }
}

/** Recursive editor for the Specification/Composite condition tree. */
export function ConditionEditor({
  value,
  onChange,
  onRemove,
  depth = 0,
}: {
  value: ConditionSpec;
  onChange: (c: ConditionSpec) => void;
  onRemove?: () => void;
  depth?: number;
}) {
  return (
    <div className={`space-y-2 border-l-2 pl-3 ${depth % 2 ? 'border-black/10' : 'border-black/30'}`} data-testid="condition-node">
      <div className="flex items-center gap-2">
        <select
          value={value.type}
          onChange={e => onChange(defaultCondition(e.target.value as ConditionSpec['type']))}
          className="h-9 border border-black/15 bg-white px-2 text-sm"
          aria-label="Condition type"
        >
          {Object.entries(CONDITION_LABELS).map(([k, label]) => (
            <option key={k} value={k} disabled={depth >= 3 && (k === 'all' || k === 'any' || k === 'not')}>
              {label}
            </option>
          ))}
        </select>
        {onRemove && (
          <Button type="button" size="sm" variant="ghost" onClick={onRemove} aria-label="Remove condition">
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </div>

      <div key={value.type} className="space-y-2">
        {(value.type === 'all' || value.type === 'any') && (
          <div className="space-y-2">
            {value.conditions.map((c, i) => (
              <ConditionEditor
                key={i}
                depth={depth + 1}
                value={c}
                onChange={next => onChange({ ...value, conditions: value.conditions.map((x, j) => (j === i ? next : x)) })}
                onRemove={
                  value.conditions.length > 1
                    ? () => onChange({ ...value, conditions: value.conditions.filter((_, j) => j !== i) })
                    : undefined
                }
              />
            ))}
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => onChange({ ...value, conditions: [...value.conditions, defaultCondition('minSubtotal')] })}
            >
              <Plus className="mr-1 h-4 w-4" /> Add condition
            </Button>
          </div>
        )}
        {value.type === 'not' && (
          <ConditionEditor depth={depth + 1} value={value.condition} onChange={c => onChange({ ...value, condition: c })} />
        )}
        {value.type === 'cartContains' && (
          <div className="space-y-2">
            <SelectorEditor value={value.selector} onChange={selector => onChange({ ...value, selector })} />
            <Field label="At least this many units" className="w-48">
              <NumberInput value={value.minQty} min={1} max={50} onChange={minQty => onChange({ ...value, minQty })} />
            </Field>
          </div>
        )}
        {value.type === 'minSubtotal' && (
          <Field label="Subtotal of at least (₹)" className="w-48">
            <RupeeInput value={value.amount} onChange={amount => onChange({ ...value, amount: amount ?? 0 })} />
          </Field>
        )}
        {value.type === 'customerSegment' && (
          <select
            value={value.segment}
            onChange={e => onChange({ ...value, segment: e.target.value as CustomerSegment })}
            className="h-9 border border-black/15 bg-white px-2 text-sm"
            aria-label="Segment"
          >
            {CUSTOMER_SEGMENTS.map(s => (
              <option key={s}>{s}</option>
            ))}
          </select>
        )}
        {value.type === 'dateWindow' && (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-3 text-xs">
              {DAYS.map((d, i) => (
                <label key={d} className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={value.daysOfWeek?.includes(i) ?? false}
                    onChange={e => {
                      const days = new Set(value.daysOfWeek ?? []);
                      if (e.target.checked) days.add(i);
                      else days.delete(i);
                      onChange({ ...value, daysOfWeek: days.size ? [...days].sort() : undefined });
                    }}
                  />
                  {d}
                </label>
              ))}
            </div>
            <div className="grid gap-2 sm:grid-cols-4">
              <Field label="From hour">
                <NumberInput
                  value={value.hours?.start ?? 0}
                  max={23}
                  onChange={start => onChange({ ...value, hours: { start, end: value.hours?.end ?? 24 } })}
                />
              </Field>
              <Field label="To hour">
                <NumberInput
                  value={value.hours?.end ?? 24}
                  min={1}
                  max={24}
                  onChange={end => onChange({ ...value, hours: { start: value.hours?.start ?? 0, end } })}
                />
              </Field>
            </div>
          </div>
        )}
        {value.type === 'paymentMethod' && (
          <div className="flex flex-wrap gap-3 text-xs">
            {PAYMENT_METHODS.map(m => (
              <label key={m} className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={value.methods.includes(m)}
                  onChange={e =>
                    onChange({
                      ...value,
                      methods: e.target.checked ? [...value.methods, m] : value.methods.filter((x: PaymentMethod) => x !== m),
                    })
                  }
                />
                {m}
              </label>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export const ACTION_LABELS: Record<ActionType, string> = {
  fixedBundle: 'Fixed-price bundle',
  mixAndMatch: 'Mix & match (any N for ₹X)',
  buyXGetY: 'Buy X get Y',
  tiered: 'Tiered spend discount',
  percentOff: 'Percent off',
  flatOff: 'Flat amount off',
  freeShipping: 'Free shipping',
  markdown: 'Markdown (sale price)',
  clearance: 'Clearance (stock/age based)',
};

export function defaultAction(type: ActionType): ActionSpec {
  switch (type) {
    case 'fixedBundle':
      return { type, components: [{ selector: { slugs: [] as string[] } as ProductSelector, qty: 1 }], price: 199_900 };
    case 'mixAndMatch':
      return { type, selector: { categories: ['Men'] }, quantity: 3, price: 149_900 };
    case 'buyXGetY':
      return { type, selector: { categories: ['Accessories'] }, buyQty: 2, getQty: 1, percentOff: 100 };
    case 'tiered':
      return { type, tiers: [{ minSubtotal: 300_000, percentOff: 10 }] };
    case 'percentOff':
      return { type, percent: 10 };
    case 'flatOff':
      return { type, amount: 50_000 };
    case 'freeShipping':
      return { type };
    case 'markdown':
      return { type, selector: { categories: ['Women'] }, percentOff: 20 };
    case 'clearance':
      return { type, percentOff: 20, minStock: 15, minAgeDays: 60 };
  }
}

/** Strategy-specific fields for each discount action. */
export function ActionEditor({ value, onChange }: { value: ActionSpec; onChange: (a: ActionSpec) => void }) {
  return (
    <div className="space-y-3" data-testid="action-editor">
      <select
        value={value.type}
        onChange={e => onChange(defaultAction(e.target.value as ActionType))}
        className="h-9 border border-black/15 bg-white px-2 text-sm"
        aria-label="Action type"
      >
        {Object.entries(ACTION_LABELS).map(([k, label]) => (
          <option key={k} value={k}>
            {label}
          </option>
        ))}
      </select>

      <div key={value.type}>
        {value.type === 'fixedBundle' && (
          <div className="space-y-3">
            {value.components.map((c, i) => (
              <div key={i} className="border border-black/10 p-3">
                <div className="flex items-center justify-between text-xs font-medium">
                  Component {i + 1}
                  {value.components.length > 1 && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => onChange({ ...value, components: value.components.filter((_, j) => j !== i) })}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
                <SelectorEditor
                  value={c.selector}
                  onChange={selector =>
                    onChange({ ...value, components: value.components.map((x, j) => (j === i ? { ...x, selector } : x)) })
                  }
                />
                <Field label="Quantity" className="mt-2 w-32">
                  <NumberInput
                    value={c.qty}
                    min={1}
                    max={4}
                    onChange={qty => onChange({ ...value, components: value.components.map((x, j) => (j === i ? { ...x, qty } : x)) })}
                  />
                </Field>
              </div>
            ))}
            <div className="flex items-end gap-3">
              {value.components.length < 4 && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => onChange({ ...value, components: [...value.components, { selector: { categories: ['Men'] }, qty: 1 }] })}
                >
                  <Plus className="mr-1 h-4 w-4" /> Component
                </Button>
              )}
              <Field label="Bundle price (₹)" className="w-48">
                <RupeeInput value={value.price} onChange={price => onChange({ ...value, price: price ?? 0 })} />
              </Field>
            </div>
          </div>
        )}
        {value.type === 'mixAndMatch' && (
          <div className="space-y-2">
            <SelectorEditor value={value.selector} onChange={selector => onChange({ ...value, selector })} />
            <div className="grid gap-2 sm:grid-cols-3">
              <Field label="Any N items">
                <NumberInput value={value.quantity} min={2} max={6} onChange={quantity => onChange({ ...value, quantity })} />
              </Field>
              <Field label="For (₹)">
                <RupeeInput value={value.price} onChange={price => onChange({ ...value, price: price ?? 0 })} />
              </Field>
            </div>
          </div>
        )}
        {value.type === 'buyXGetY' && (
          <div className="space-y-2">
            <SelectorEditor value={value.selector} onChange={selector => onChange({ ...value, selector })} />
            <div className="grid gap-2 sm:grid-cols-3">
              <Field label="Buy">
                <NumberInput value={value.buyQty} min={1} max={4} onChange={buyQty => onChange({ ...value, buyQty })} />
              </Field>
              <Field label="Get (cheapest)">
                <NumberInput value={value.getQty} min={1} max={2} onChange={getQty => onChange({ ...value, getQty })} />
              </Field>
              <Field label="% off those">
                <NumberInput value={value.percentOff} min={1} max={100} onChange={percentOff => onChange({ ...value, percentOff })} />
              </Field>
            </div>
          </div>
        )}
        {value.type === 'tiered' && (
          <div className="space-y-2">
            {value.tiers.map((t, i) => (
              <div key={i} className="flex items-end gap-2">
                <Field label="Spend at least (₹)">
                  <RupeeInput
                    value={t.minSubtotal}
                    onChange={minSubtotal =>
                      onChange({ ...value, tiers: value.tiers.map((x, j) => (j === i ? { ...x, minSubtotal: minSubtotal ?? 0 } : x)) })
                    }
                  />
                </Field>
                <Field label="% off">
                  <NumberInput
                    value={t.percentOff ?? 0}
                    min={1}
                    max={100}
                    onChange={percentOff =>
                      onChange({ ...value, tiers: value.tiers.map((x, j) => (j === i ? { minSubtotal: x.minSubtotal, percentOff } : x)) })
                    }
                  />
                </Field>
                {value.tiers.length > 1 && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => onChange({ ...value, tiers: value.tiers.filter((_, j) => j !== i) })}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            ))}
            {value.tiers.length < 5 && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() =>
                  onChange({
                    ...value,
                    tiers: [
                      ...value.tiers,
                      {
                        minSubtotal: (value.tiers.at(-1)?.minSubtotal ?? 0) + 200_000,
                        percentOff: (value.tiers.at(-1)?.percentOff ?? 5) + 5,
                      },
                    ],
                  })
                }
              >
                <Plus className="mr-1 h-4 w-4" /> Tier
              </Button>
            )}
          </div>
        )}
        {value.type === 'percentOff' && (
          <div className="grid gap-2 sm:grid-cols-3">
            <Field label="Percent off">
              <NumberInput value={value.percent} min={1} max={100} onChange={percent => onChange({ ...value, percent })} />
            </Field>
            <Field label="Capped at (₹, optional)">
              <RupeeInput value={value.maxDiscount} onChange={maxDiscount => onChange({ ...value, maxDiscount })} />
            </Field>
          </div>
        )}
        {value.type === 'flatOff' && (
          <Field label="Amount off (₹)" className="w-48">
            <RupeeInput value={value.amount} onChange={amount => onChange({ ...value, amount: amount ?? 0 })} />
          </Field>
        )}
        {(value.type === 'markdown' || value.type === 'clearance') && (
          <div className="space-y-2">
            <SelectorEditor value={value.selector} onChange={selector => onChange({ ...value, selector })} />
            <div className="grid gap-2 sm:grid-cols-3">
              <Field label="Percent off">
                <NumberInput value={value.percentOff} min={1} max={100} onChange={percentOff => onChange({ ...value, percentOff })} />
              </Field>
              {value.type === 'clearance' && (
                <>
                  <Field label="Only sizes with stock ≥">
                    <NumberInput value={value.minStock} min={1} onChange={minStock => onChange({ ...value, minStock })} />
                  </Field>
                  <Field label="Listed for at least (days)">
                    <NumberInput value={value.minAgeDays} onChange={minAgeDays => onChange({ ...value, minAgeDays })} />
                  </Field>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
