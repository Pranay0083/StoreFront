'use client';

/*
 * Products.
 * Data: up to 48 pieces (title, slug, category, price and compare-at in paise, photographs, stock per
 * size, featured, rating and review count). Opened by the catalogue manager a few times a week, at a
 * desk. Jobs: restock or edit a piece (most frequent), add a new piece, retire one.
 *
 * Question: which pieces need restocking?
 * Finding: how many sizes are sold out and how many are under five.
 * Face: the size run, every piece's stock per size in fixed mini-columns beside its photograph.
 */

import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  BlockError,
  Dash,
  Empty,
  FieldLabel,
  fmtCount,
  fmtMoney,
  KpiStrip,
  LoadingRows,
  PageHeader,
  Pill,
  plural,
  Tabs,
  Thumb,
} from '@/components/admin/ledger';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { paiseToRupees, rupeesToPaise } from '@storefront/contracts';
import { api, errorMessage } from '@/lib/api';
import { queryKeys } from '@/lib/query';
import { cn } from '@/lib/utils';
import type { Product } from '@storefront/contracts';

const CATEGORIES = ['Men', 'Women', 'Footwear', 'Accessories'];
const LOW = 5;

interface FormState {
  title: string;
  category: string;
  price: string;
  compareAtPrice: string;
  description: string;
  images: string;
  sizes: string;
  featured: boolean;
}

const emptyForm: FormState = {
  title: '',
  category: 'Men',
  price: '',
  compareAtPrice: '',
  description: '',
  images: '',
  sizes: 'S:10, M:10, L:10',
  featured: false,
};

type ProductPayload = Pick<Product, 'title' | 'category' | 'price' | 'description' | 'images' | 'sizes' | 'featured'> & {
  compareAtPrice?: number;
};

type View = 'all' | 'low' | (typeof CATEGORIES)[number];

/** A piece's stock state: the one status mark its row carries. */
function stockState(p: Product) {
  const out = p.sizes.filter(s => s.stock === 0).map(s => s.size);
  const low = p.sizes.filter(s => s.stock > 0 && s.stock < LOW).map(s => s.size);
  return { out, low, needs: out.length > 0 || low.length > 0 };
}

export default function AdminProductsPage() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [view, setView] = useState<View>('all');

  const productsQuery = useQuery({
    queryKey: queryKeys.adminProducts,
    queryFn: () => api<{ items: Product[] }>('/products?limit=48').then(d => d.items),
  });
  const products = productsQuery.data ?? null;
  const load = () => queryClient.invalidateQueries({ queryKey: queryKeys.adminProducts });

  const saveMutation = useMutation({
    mutationFn: ({ id, payload }: { id?: string; payload: ProductPayload }) =>
      id
        ? api(`/products/${id}`, { method: 'PUT', body: JSON.stringify(payload) })
        : api('/products', { method: 'POST', body: JSON.stringify(payload) }),
    onSuccess: (_, { id }) => {
      toast.success(id ? 'Product updated' : 'Product created');
      setOpen(false);
      load();
    },
    onError: e => toast.error(errorMessage(e)),
  });
  const saving = saveMutation.isPending;

  const removeMutation = useMutation({
    mutationFn: (p: Product) => api(`/products/${p._id}`, { method: 'DELETE' }),
    // Optimistic: the row disappears at once and comes back if the delete fails.
    onMutate: async p => {
      await queryClient.cancelQueries({ queryKey: queryKeys.adminProducts });
      const previous = queryClient.getQueryData<Product[]>(queryKeys.adminProducts);
      queryClient.setQueryData<Product[]>(queryKeys.adminProducts, list => list?.filter(x => x._id !== p._id));
      return { previous };
    },
    onError: (e, _, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(queryKeys.adminProducts, ctx.previous);
      toast.error(errorMessage(e));
    },
    onSuccess: (_, p) => toast.success(`${p.title} deleted`),
    onSettled: () => load(),
  });

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setOpen(true);
  };

  const openEdit = (p: Product) => {
    setEditing(p);
    setForm({
      title: p.title,
      category: p.category,
      price: String(paiseToRupees(p.price)),
      compareAtPrice: p.compareAtPrice ? String(paiseToRupees(p.compareAtPrice)) : '',
      description: p.description,
      images: p.images.join('\n'),
      sizes: p.sizes.map(s => `${s.size}:${s.stock}`).join(', '),
      featured: p.featured,
    });
    setOpen(true);
  };

  const save = async () => {
    const sizes = form.sizes
      .split(',')
      .map(pair => {
        const [size, stock] = pair.split(':').map(s => s.trim());
        return { size, stock: parseInt(stock, 10) };
      })
      .filter(s => s.size && !isNaN(s.stock));
    const images = form.images
      .split('\n')
      .map(s => s.trim())
      .filter(Boolean);
    if (!form.title || !form.price || images.length === 0 || sizes.length === 0) {
      return toast.error('Title, price, at least one image URL and one size are required');
    }
    const payload: ProductPayload = {
      title: form.title,
      category: form.category,
      price: rupeesToPaise(Number(form.price)),
      description: form.description,
      images,
      sizes,
      featured: form.featured,
    };
    if (form.compareAtPrice) payload.compareAtPrice = rupeesToPaise(Number(form.compareAtPrice));
    saveMutation.mutate({ id: editing?._id, payload });
  };

  const remove = (p: Product) => removeMutation.mutate(p);

  const totals = useMemo(() => {
    if (!products) return null;
    const sizes = products.flatMap(p => p.sizes);
    return {
      pieces: products.length,
      units: sizes.reduce((s, v) => s + v.stock, 0),
      soldOut: sizes.filter(s => s.stock === 0).length,
      low: sizes.filter(s => s.stock > 0 && s.stock < LOW).length,
      needs: products.filter(p => stockState(p).needs).length,
    };
  }, [products]);

  const rows = useMemo(() => {
    if (!products) return null;
    const list =
      view === 'all' ? products : view === 'low' ? products.filter(p => stockState(p).needs) : products.filter(p => p.category === view);
    // Pieces that need stock first, then by title, so the job is at the top of every view.
    return [...list].sort((a, b) => Number(stockState(b).needs) - Number(stockState(a).needs) || a.title.localeCompare(b.title));
  }, [products, view]);

  const finding = totals
    ? totals.soldOut + totals.low === 0
      ? `Every size of all ${plural(totals.pieces, 'piece')} has ${LOW} or more in stock.`
      : `${totals.soldOut ? `${plural(totals.soldOut, 'size')} sold out` : 'No size is sold out'}; ${plural(totals.low, 'size')} under ${LOW}, across ${plural(totals.needs, 'piece')}.`
    : null;

  return (
    <div data-testid="admin-products-page">
      <PageHeader
        title="Products"
        finding={finding}
        actions={
          <Button size="sm" data-testid="product-create-button" onClick={openCreate}>
            <Plus /> New product
          </Button>
        }
      />

      <KpiStrip
        className="mt-6"
        loading={!totals}
        items={[
          { label: 'Pieces in the catalogue', value: totals ? fmtCount(totals.pieces) : '' },
          { label: 'Units in stock', value: totals ? fmtCount(totals.units) : '' },
          { label: 'Sizes sold out', value: totals ? fmtCount(totals.soldOut) : '' },
          { label: `Sizes under ${LOW}`, value: totals ? fmtCount(totals.low) : '' },
        ]}
      />

      <Tabs
        className="mt-6"
        ariaLabel="Show"
        value={view}
        onChange={setView}
        options={[
          { value: 'all', label: 'All', count: products?.length ?? null },
          { value: 'low', label: 'Needs stock', count: totals?.needs ?? null },
          ...CATEGORIES.map(c => ({ value: c, label: c, count: products ? products.filter(p => p.category === c).length : null })),
        ]}
      />

      <section className="mt-4 border border-border bg-card">
        {productsQuery.isError ? (
          <div className="p-4">
            <BlockError what="the catalogue" onRetry={() => void productsQuery.refetch()} />
          </div>
        ) : rows === null ? (
          <LoadingRows rows={8} className="px-4" />
        ) : rows.length === 0 ? (
          <div className="p-4">
            <Empty>{view === 'low' ? `Every size has ${LOW} or more in stock.` : 'No pieces here yet. Add one with New product.'}</Empty>
          </div>
        ) : (
          <Table data-testid="products-table">
            <TableHeader>
              <TableRow>
                <TableHead className="w-14 pl-4" />
                <TableHead>Piece</TableHead>
                <TableHead className="text-right">Price</TableHead>
                <TableHead className="hidden lg:table-cell">Stock by size</TableHead>
                <TableHead className="hidden text-right sm:table-cell">Units</TableHead>
                <TableHead className="hidden md:table-cell">Stock</TableHead>
                <TableHead className="hidden text-right xl:table-cell">Rating</TableHead>
                <TableHead className="w-24 pr-4">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(p => {
                const stock = p.sizes.reduce((s, v) => s + v.stock, 0);
                const state = stockState(p);
                return (
                  <TableRow key={p._id} data-testid={`admin-product-row-${p.slug}`}>
                    <TableCell className="py-2 pl-4">
                      <Thumb src={p.images[0]} className="h-12 w-9" />
                    </TableCell>
                    <TableCell className="w-full max-w-0 md:max-w-none">
                      <p className="truncate font-medium">{p.title}</p>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {p.category}
                        {p.featured && ' · on the home page'}
                        {/* On a phone the stock column folds into this line. */}
                        <span className="md:hidden">
                          {' · '}
                          {state.out.length
                            ? `sold out in ${state.out.join(', ')}`
                            : state.low.length
                              ? `low in ${state.low.join(', ')}`
                              : `${fmtCount(stock)} in stock`}
                        </span>
                      </p>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      <p>{fmtMoney(p.price)}</p>
                      {p.compareAtPrice ? <p className="text-xs text-muted-foreground line-through">{fmtMoney(p.compareAtPrice)}</p> : null}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">
                      <span className="flex flex-wrap gap-x-1 gap-y-0.5 text-[13px] tabular-nums">
                        {p.sizes.map(s => (
                          <span key={s.size} className="inline-flex min-w-[64px] items-baseline gap-1 whitespace-nowrap">
                            <span className="text-xs text-muted-foreground">{s.size}</span>
                            <span className={cn(s.stock < LOW && 'font-semibold')}>{s.stock}</span>
                          </span>
                        ))}
                      </span>
                    </TableCell>
                    <TableCell className="hidden text-right tabular-nums sm:table-cell">{fmtCount(stock)}</TableCell>
                    <TableCell className="hidden md:table-cell">
                      {state.out.length ? (
                        <Pill tone="negative" title={`Sold out in ${state.out.join(', ')}`}>
                          Sold out in {state.out.length > 2 ? `${state.out.length} sizes` : state.out.join(', ')}
                        </Pill>
                      ) : state.low.length ? (
                        <Pill tone="warning" title={`Under ${LOW} in ${state.low.join(', ')}`}>
                          Low in {state.low.length > 2 ? `${state.low.length} sizes` : state.low.join(', ')}
                        </Pill>
                      ) : (
                        <span className="text-[13px] text-muted-foreground">In stock</span>
                      )}
                    </TableCell>
                    <TableCell className="hidden text-right tabular-nums xl:table-cell">
                      {p.numReviews > 0 ? (
                        <>
                          {p.rating.toFixed(1)} <span className="text-xs text-muted-foreground">({fmtCount(p.numReviews)})</span>
                        </>
                      ) : (
                        <Dash label="No reviews yet" />
                      )}
                    </TableCell>
                    <TableCell className="pr-4">
                      <div className="flex justify-end gap-1">
                        <button
                          data-testid={`product-edit-${p.slug}`}
                          onClick={() => openEdit(p)}
                          className="flex h-8 w-8 items-center justify-center text-muted-foreground hover:bg-secondary hover:text-foreground"
                          aria-label={`Edit ${p.title}`}
                        >
                          <Pencil className="h-4 w-4" strokeWidth={1.5} />
                        </button>
                        <button
                          data-testid={`product-delete-${p.slug}`}
                          onClick={() => remove(p)}
                          className="flex h-8 w-8 items-center justify-center text-muted-foreground hover:bg-secondary hover:text-destructive"
                          aria-label={`Delete ${p.title}`}
                        >
                          <Trash2 className="h-4 w-4" strokeWidth={1.5} />
                        </button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </section>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent data-testid="product-form-dialog" className="max-w-2xl" data-surface="ledger">
          <DialogTitle className="text-xl font-semibold tracking-[-0.02em]">
            {editing ? `Edit ${editing.title}` : 'New product'}
          </DialogTitle>
          <DialogDescription className="-mt-2 text-sm text-muted-foreground">
            {editing ? 'Changes go live on the shop as soon as you save.' : 'The piece goes live on the shop as soon as you create it.'}
          </DialogDescription>
          <div className="grid gap-4 sm:grid-cols-2">
            <FieldLabel label="Title" className="sm:col-span-2">
              <Input data-testid="product-form-title" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} />
            </FieldLabel>
            <div className="min-w-0">
              <span className="block text-[13px] font-medium">Category</span>
              <div className="mt-1.5">
                <Select value={form.category} onValueChange={v => setForm({ ...form, category: v })}>
                  <SelectTrigger data-testid="product-form-category" aria-label="Category">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map(c => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex items-center gap-2.5 self-end pb-3">
              <Checkbox
                id="featured"
                data-testid="product-form-featured"
                checked={form.featured}
                onCheckedChange={v => setForm({ ...form, featured: v === true })}
              />
              <label htmlFor="featured" className="text-sm">
                Feature on the home page
              </label>
            </div>
            <FieldLabel label="Price (₹)">
              <Input
                data-testid="product-form-price"
                type="number"
                inputMode="decimal"
                value={form.price}
                onChange={e => setForm({ ...form, price: e.target.value })}
              />
            </FieldLabel>
            <FieldLabel label="Compare-at price (₹)" hint="Optional: the old price, shown struck through">
              <Input
                data-testid="product-form-compare-price"
                type="number"
                inputMode="decimal"
                value={form.compareAtPrice}
                onChange={e => setForm({ ...form, compareAtPrice: e.target.value })}
              />
            </FieldLabel>
            <FieldLabel label="Stock by size" hint="Size and count, separated by commas: S:10, M:15, L:8" className="sm:col-span-2">
              <Input
                data-testid="product-form-sizes"
                value={form.sizes}
                onChange={e => setForm({ ...form, sizes: e.target.value })}
                placeholder="S:10, M:15, L:8"
              />
            </FieldLabel>
            <FieldLabel label="Photographs" hint="One image URL per line; the first is the cover" className="sm:col-span-2">
              <Textarea
                data-testid="product-form-images"
                value={form.images}
                onChange={e => setForm({ ...form, images: e.target.value })}
                placeholder="https://images.unsplash.com/…"
              />
            </FieldLabel>
            <FieldLabel label="Description" className="sm:col-span-2">
              <Textarea
                data-testid="product-form-description"
                value={form.description}
                onChange={e => setForm({ ...form, description: e.target.value })}
              />
            </FieldLabel>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" data-testid="product-form-save" onClick={save} disabled={saving}>
              {saving ? 'Saving…' : editing ? 'Save changes' : 'Create product'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
