'use client';

import { Pencil, Plus, Star, Trash2 } from 'lucide-react';
import Image from 'next/image';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { paiseToRupees, rupeesToPaise } from '@storefront/contracts';
import { api, errorMessage, fmtINR } from '@/lib/api';
import { queryKeys } from '@/lib/query';
import type { Product } from '@storefront/contracts';

const CATEGORIES = ['Men', 'Women', 'Footwear', 'Accessories'];

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

export default function AdminProductsPage() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);

  const productsQuery = useQuery({
    queryKey: queryKeys.adminProducts,
    queryFn: () => api<{ items: Product[] }>('/products?limit=48').then(d => d.items),
  });
  const products = productsQuery.data ?? (productsQuery.isError ? [] : null);
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

  return (
    <div data-testid="admin-products-page">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-serif text-3xl font-semibold tracking-tight sm:text-4xl">Products</h1>
          <p className="mt-1 text-sm text-muted-foreground">{products?.length ?? '—'} pieces in the catalogue</p>
        </div>
        <Button data-testid="product-create-button" onClick={openCreate}>
          <Plus className="h-4 w-4" /> New product
        </Button>
      </div>

      <div className="mt-6 border border-black/10 bg-white">
        {products === null ? (
          <div className="space-y-3 p-6">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : (
          <Table data-testid="products-table">
            <TableHeader>
              <TableRow>
                <TableHead className="w-14" />
                <TableHead>Title</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Price</TableHead>
                <TableHead>Stock</TableHead>
                <TableHead>Rating</TableHead>
                <TableHead className="w-24">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {products.map(p => {
                const stock = p.sizes.reduce((s, v) => s + v.stock, 0);
                return (
                  <TableRow key={p._id} data-testid={`admin-product-row-${p.slug}`}>
                    <TableCell>
                      <div className="relative h-12 w-9 overflow-hidden bg-muted">
                        <Image src={p.images[0]} alt="" fill sizes="36px" className="object-cover" />
                      </div>
                    </TableCell>
                    <TableCell>
                      <p className="text-sm font-medium">{p.title}</p>
                      {p.featured && (
                        <Badge variant="secondary" className="mt-1">
                          Featured
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{p.category}</TableCell>
                    <TableCell className="text-sm font-semibold">{fmtINR(p.price)}</TableCell>
                    <TableCell>
                      <Badge variant={stock < 10 ? (stock < 5 ? 'destructive' : 'warning') : 'secondary'}>{stock} units</Badge>
                    </TableCell>
                    <TableCell className="text-sm">
                      {p.numReviews > 0 ? (
                        <span className="flex items-center gap-1">
                          <Star className="h-3.5 w-3.5 fill-black" /> {p.rating}
                        </span>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <button
                          data-testid={`product-edit-${p.slug}`}
                          onClick={() => openEdit(p)}
                          className="flex h-8 w-8 items-center justify-center hover:bg-black/5"
                          aria-label="Edit"
                        >
                          <Pencil className="h-3.5 w-3.5" strokeWidth={1.5} />
                        </button>
                        <button
                          data-testid={`product-delete-${p.slug}`}
                          onClick={() => remove(p)}
                          className="flex h-8 w-8 items-center justify-center text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                          aria-label="Delete"
                        >
                          <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
                        </button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent data-testid="product-form-dialog">
          <DialogTitle>{editing ? 'Edit product' : 'New product'}</DialogTitle>
          <div className="grid gap-4">
            <div className="space-y-2">
              <Label>Title</Label>
              <Input data-testid="product-form-title" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Category</Label>
                <Select value={form.category} onValueChange={v => setForm({ ...form, category: v })}>
                  <SelectTrigger data-testid="product-form-category">
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
              <div className="space-y-2">
                <Label>Price (₹)</Label>
                <Input
                  data-testid="product-form-price"
                  type="number"
                  value={form.price}
                  onChange={e => setForm({ ...form, price: e.target.value })}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Compare-at price</Label>
                <Input
                  data-testid="product-form-compare-price"
                  type="number"
                  value={form.compareAtPrice}
                  onChange={e => setForm({ ...form, compareAtPrice: e.target.value })}
                  placeholder="Optional"
                />
              </div>
              <div className="flex items-end gap-2 pb-3">
                <Checkbox
                  id="featured"
                  data-testid="product-form-featured"
                  checked={form.featured}
                  onCheckedChange={v => setForm({ ...form, featured: v === true })}
                />
                <label htmlFor="featured" className="text-sm">
                  Featured on homepage
                </label>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Sizes &amp; stock (size:stock, …)</Label>
              <Input
                data-testid="product-form-sizes"
                value={form.sizes}
                onChange={e => setForm({ ...form, sizes: e.target.value })}
                placeholder="S:10, M:15, L:8"
              />
            </div>
            <div className="space-y-2">
              <Label>Image URLs (one per line)</Label>
              <Textarea
                data-testid="product-form-images"
                value={form.images}
                onChange={e => setForm({ ...form, images: e.target.value })}
                placeholder="https://images.unsplash.com/…"
              />
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea
                data-testid="product-form-description"
                value={form.description}
                onChange={e => setForm({ ...form, description: e.target.value })}
              />
            </div>
            <Button data-testid="product-form-save" onClick={save} disabled={saving}>
              {saving ? 'Saving…' : editing ? 'Save changes' : 'Create product'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
