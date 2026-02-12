'use client';

import { Pencil, Plus, Star, Trash2 } from 'lucide-react';
import Image from 'next/image';
import { useCallback, useEffect, useState } from 'react';
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
import { api, fmtINR } from '@/lib/api';
import type { Product } from '@/lib/types';

const CATEGORIES = ['Men', 'Women', 'Footwear', 'Accessories'];

interface FormState {
  title: string; category: string; price: string; compareAtPrice: string;
  description: string; images: string; sizes: string; featured: boolean;
}

const emptyForm: FormState = { title: '', category: 'Men', price: '', compareAtPrice: '', description: '', images: '', sizes: 'S:10, M:10, L:10', featured: false };

export default function AdminProductsPage() {
  const [products, setProducts] = useState<Product[] | null>(null);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    api<{ items: Product[] }>('/products?limit=48').then(d => setProducts(d.items)).catch(() => setProducts([]));
  }, []);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => { setEditing(null); setForm(emptyForm); setOpen(true); };

  const openEdit = (p: Product) => {
    setEditing(p);
    setForm({
      title: p.title, category: p.category, price: String(p.price),
      compareAtPrice: p.compareAtPrice ? String(p.compareAtPrice) : '',
      description: p.description, images: p.images.join('\n'),
      sizes: p.sizes.map(s => `${s.size}:${s.stock}`).join(', '),
      featured: p.featured,
    });
    setOpen(true);
  };

  const save = async () => {
    const sizes = form.sizes.split(',').map(pair => {
      const [size, stock] = pair.split(':').map(s => s.trim());
      return { size, stock: parseInt(stock, 10) };
    }).filter(s => s.size && !isNaN(s.stock));
    const images = form.images.split('\n').map(s => s.trim()).filter(Boolean);
    if (!form.title || !form.price || images.length === 0 || sizes.length === 0) {
      return toast.error('Title, price, at least one image URL and one size are required');
    }
    const payload: any = {
      title: form.title, category: form.category, price: Number(form.price),
      description: form.description, images, sizes, featured: form.featured,
    };
    if (form.compareAtPrice) payload.compareAtPrice = Number(form.compareAtPrice);
    setSaving(true);
    try {
      if (editing) {
        await api(`/products/${editing._id}`, { method: 'PUT', body: JSON.stringify(payload) });
        toast.success('Product updated');
      } else {
        await api('/products', { method: 'POST', body: JSON.stringify(payload) });
        toast.success('Product created');
      }
      setOpen(false);
      load();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (p: Product) => {
    try {
      await api(`/products/${p._id}`, { method: 'DELETE' });
      toast.success(`${p.title} deleted`);
      load();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

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
            {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
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
                      {p.featured && <Badge variant="secondary" className="mt-1">Featured</Badge>}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{p.category}</TableCell>
                    <TableCell className="text-sm font-semibold">{fmtINR(p.price)}</TableCell>
                    <TableCell>
                      <Badge variant={stock < 10 ? (stock < 5 ? 'destructive' : 'warning') : 'secondary'}>
                        {stock} units
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm">
                      {p.numReviews > 0 ? (
                        <span className="flex items-center gap-1">
                          <Star className="h-3.5 w-3.5 fill-black" /> {p.rating}
                        </span>
                      ) : '—'}
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
                  <SelectTrigger data-testid="product-form-category"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Price (₹)</Label>
                <Input data-testid="product-form-price" type="number" value={form.price} onChange={e => setForm({ ...form, price: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Compare-at price</Label>
                <Input data-testid="product-form-compare-price" type="number" value={form.compareAtPrice} onChange={e => setForm({ ...form, compareAtPrice: e.target.value })} placeholder="Optional" />
              </div>
              <div className="flex items-end gap-2 pb-3">
                <Checkbox
                  id="featured"
                  data-testid="product-form-featured"
                  checked={form.featured}
                  onCheckedChange={v => setForm({ ...form, featured: v === true })}
                />
                <label htmlFor="featured" className="text-sm">Featured on homepage</label>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Sizes &amp; stock (size:stock, …)</Label>
              <Input data-testid="product-form-sizes" value={form.sizes} onChange={e => setForm({ ...form, sizes: e.target.value })} placeholder="S:10, M:15, L:8" />
            </div>
            <div className="space-y-2">
              <Label>Image URLs (one per line)</Label>
              <Textarea data-testid="product-form-images" value={form.images} onChange={e => setForm({ ...form, images: e.target.value })} placeholder="https://images.unsplash.com/…" />
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea data-testid="product-form-description" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
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
