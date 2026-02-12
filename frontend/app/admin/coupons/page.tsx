'use client';

import { Pencil, Plus, Trash2 } from 'lucide-react';
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
import { api, fmtDate, fmtINR } from '@/lib/api';
import type { Coupon } from '@/lib/types';

interface FormState {
  code: string; type: 'percent' | 'flat'; value: string; minSubtotal: string;
  maxDiscount: string; usageLimit: string; expiresAt: string; active: boolean;
}

const emptyForm: FormState = { code: '', type: 'percent', value: '', minSubtotal: '0', maxDiscount: '', usageLimit: '', expiresAt: '', active: true };

export default function AdminCouponsPage() {
  const [coupons, setCoupons] = useState<Coupon[] | null>(null);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Coupon | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    api<Coupon[]>('/admin/coupons').then(setCoupons).catch(() => setCoupons([]));
  }, []);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => { setEditing(null); setForm(emptyForm); setOpen(true); };

  const openEdit = (c: Coupon) => {
    setEditing(c);
    setForm({
      code: c.code, type: c.type, value: String(c.value), minSubtotal: String(c.minSubtotal ?? 0),
      maxDiscount: c.maxDiscount ? String(c.maxDiscount) : '',
      usageLimit: c.usageLimit ? String(c.usageLimit) : '',
      expiresAt: c.expiresAt ? c.expiresAt.slice(0, 10) : '',
      active: c.active,
    });
    setOpen(true);
  };

  const save = async () => {
    if (!form.code.trim() || !form.value) return toast.error('Code and value are required');
    const payload: any = {
      code: form.code.trim().toUpperCase(),
      type: form.type,
      value: Number(form.value),
      minSubtotal: Number(form.minSubtotal || 0),
      active: form.active,
    };
    if (form.maxDiscount) payload.maxDiscount = Number(form.maxDiscount);
    if (form.usageLimit) payload.usageLimit = Number(form.usageLimit);
    if (form.expiresAt) payload.expiresAt = new Date(`${form.expiresAt}T23:59:59Z`).toISOString();
    setSaving(true);
    try {
      if (editing) {
        await api(`/admin/coupons/${editing._id}`, { method: 'PUT', body: JSON.stringify(payload) });
        toast.success('Coupon updated');
      } else {
        await api('/admin/coupons', { method: 'POST', body: JSON.stringify(payload) });
        toast.success(`Coupon ${payload.code} created`);
      }
      setOpen(false);
      load();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (c: Coupon) => {
    try {
      await api(`/admin/coupons/${c._id}`, { method: 'DELETE' });
      toast.success(`${c.code} deleted`);
      load();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const statusOf = (c: Coupon) => {
    if (!c.active) return { label: 'Inactive', variant: 'secondary' as const };
    if (c.expiresAt && new Date(c.expiresAt) < new Date()) return { label: 'Expired', variant: 'destructive' as const };
    if (c.usageLimit && c.usedCount >= c.usageLimit) return { label: 'Exhausted', variant: 'destructive' as const };
    return { label: 'Active', variant: 'success' as const };
  };

  return (
    <div data-testid="admin-coupons-page">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-serif text-3xl font-semibold tracking-tight sm:text-4xl">Coupons</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Discount codes shoppers apply at checkout. Redemptions are counted when an order is paid.
          </p>
        </div>
        <Button data-testid="coupon-create-button" onClick={openCreate}>
          <Plus className="h-4 w-4" /> New coupon
        </Button>
      </div>

      <div className="mt-6 border border-black/10 bg-white">
        {coupons === null ? (
          <div className="space-y-3 p-6">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
          </div>
        ) : coupons.length === 0 ? (
          <p className="p-10 text-center text-sm text-muted-foreground">No coupons yet — create your first one.</p>
        ) : (
          <Table data-testid="coupons-table">
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Discount</TableHead>
                <TableHead>Min order</TableHead>
                <TableHead>Used</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-24">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {coupons.map(c => {
                const st = statusOf(c);
                return (
                  <TableRow key={c._id} data-testid={`coupon-row-${c.code}`}>
                    <TableCell className="font-mono text-sm font-semibold">{c.code}</TableCell>
                    <TableCell className="text-sm">
                      {c.type === 'percent' ? `${c.value}%` : fmtINR(c.value)}
                      {c.type === 'percent' && c.maxDiscount ? <span className="text-xs text-muted-foreground"> (max {fmtINR(c.maxDiscount)})</span> : null}
                    </TableCell>
                    <TableCell className="text-sm">{c.minSubtotal ? fmtINR(c.minSubtotal) : '—'}</TableCell>
                    <TableCell className="text-sm">{c.usedCount}{c.usageLimit ? ` / ${c.usageLimit}` : ''}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{c.expiresAt ? fmtDate(c.expiresAt) : 'Never'}</TableCell>
                    <TableCell><Badge variant={st.variant} data-testid={`coupon-status-${c.code}`}>{st.label}</Badge></TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <button data-testid={`coupon-edit-${c.code}`} onClick={() => openEdit(c)} className="flex h-8 w-8 items-center justify-center hover:bg-black/5" aria-label="Edit">
                          <Pencil className="h-3.5 w-3.5" strokeWidth={1.5} />
                        </button>
                        <button data-testid={`coupon-delete-${c.code}`} onClick={() => remove(c)} className="flex h-8 w-8 items-center justify-center text-muted-foreground hover:bg-destructive/10 hover:text-destructive" aria-label="Delete">
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
        <DialogContent data-testid="coupon-form-dialog">
          <DialogTitle>{editing ? `Edit ${editing.code}` : 'New coupon'}</DialogTitle>
          <div className="grid gap-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Code</Label>
                <Input data-testid="coupon-form-code" value={form.code} onChange={e => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="SUMMER20" disabled={!!editing} />
              </div>
              <div className="space-y-2">
                <Label>Type</Label>
                <Select value={form.type} onValueChange={(v: 'percent' | 'flat') => setForm({ ...form, type: v })}>
                  <SelectTrigger data-testid="coupon-form-type"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="percent">Percent off</SelectItem>
                    <SelectItem value="flat">Flat ₹ off</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{form.type === 'percent' ? 'Percent (%)' : 'Amount (₹)'}</Label>
                <Input data-testid="coupon-form-value" type="number" value={form.value} onChange={e => setForm({ ...form, value: e.target.value })} placeholder={form.type === 'percent' ? '10' : '500'} />
              </div>
              <div className="space-y-2">
                <Label>Min order (₹)</Label>
                <Input data-testid="coupon-form-min" type="number" value={form.minSubtotal} onChange={e => setForm({ ...form, minSubtotal: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Max discount (₹)</Label>
                <Input data-testid="coupon-form-max" type="number" value={form.maxDiscount} onChange={e => setForm({ ...form, maxDiscount: e.target.value })} placeholder="Optional" disabled={form.type === 'flat'} />
              </div>
              <div className="space-y-2">
                <Label>Usage limit</Label>
                <Input data-testid="coupon-form-limit" type="number" value={form.usageLimit} onChange={e => setForm({ ...form, usageLimit: e.target.value })} placeholder="Unlimited" />
              </div>
            </div>
            <div className="grid grid-cols-2 items-end gap-4">
              <div className="space-y-2">
                <Label>Expires on</Label>
                <Input data-testid="coupon-form-expires" type="date" value={form.expiresAt} onChange={e => setForm({ ...form, expiresAt: e.target.value })} />
              </div>
              <div className="flex items-center gap-2 pb-3">
                <Checkbox id="c-active" data-testid="coupon-form-active" checked={form.active} onCheckedChange={v => setForm({ ...form, active: v === true })} />
                <label htmlFor="c-active" className="text-sm">Active</label>
              </div>
            </div>
            <Button data-testid="coupon-form-save" onClick={save} disabled={saving}>
              {saving ? 'Saving…' : editing ? 'Save changes' : 'Create coupon'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
