'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api';

function ResetPasswordContent() {
  const router = useRouter();
  const token = useSearchParams().get('token') || '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) return toast.error('Passwords do not match');
    setLoading(true);
    try {
      await api('/auth/reset-password', { method: 'POST', body: JSON.stringify({ token, password }) });
      toast.success('Password updated — sign in with your new password');
      router.replace('/login');
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (!token) {
    return (
      <div className="mx-auto max-w-md px-5 py-24 text-center sm:px-0" data-testid="reset-invalid">
        <p className="font-serif text-3xl">This reset link is invalid.</p>
        <Button asChild className="mt-6"><Link href="/forgot-password">Request a new one</Link></Button>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-md flex-col px-5 py-20 sm:px-0" data-testid="reset-password-page">
      <p className="label-caps text-muted-foreground">Almost there</p>
      <h1 className="mt-3 font-serif text-4xl font-semibold tracking-tighter sm:text-5xl">New password.</h1>

      <form onSubmit={submit} className="mt-10 space-y-6">
        <div className="space-y-2">
          <Label htmlFor="password">New password</Label>
          <Input id="password" type="password" data-testid="reset-password-input" value={password} onChange={e => setPassword(e.target.value)} placeholder="Minimum 6 characters" minLength={6} required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="confirm">Confirm password</Label>
          <Input id="confirm" type="password" data-testid="reset-confirm-input" value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="Repeat it" minLength={6} required />
        </div>
        <Button type="submit" size="lg" className="w-full" data-testid="reset-submit-button" disabled={loading}>
          {loading ? 'Updating…' : 'Update password'}
        </Button>
      </form>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordContent />
    </Suspense>
  );
}
