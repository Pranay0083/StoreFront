'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useAuth } from '@/components/providers';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

function LoginContent() {
  const { user, login } = useAuth();
  const router = useRouter();
  const search = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (user && typeof user === 'object') {
      router.replace(search.get('next') || (user.role === 'admin' ? '/admin' : '/'));
    }
  }, [user, router, search]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const u = await login(email, password);
      toast.success(`Welcome back, ${u.name}`);
      router.replace(search.get('next') || (u.role === 'admin' ? '/admin' : '/'));
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto flex max-w-md flex-col px-5 py-20 sm:px-0" data-testid="login-page">
      <p className="label-caps text-muted-foreground">Welcome back</p>
      <h1 className="mt-3 font-serif text-4xl font-semibold tracking-tighter sm:text-5xl">Sign in.</h1>

      <form onSubmit={submit} className="mt-10 space-y-6">
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" data-testid="login-email-input" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <Input id="password" type="password" data-testid="login-password-input" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" required />
          <div className="flex justify-end">
            <Link href="/forgot-password" data-testid="login-forgot-link" className="text-xs text-muted-foreground underline hover:text-foreground">
              Forgot password?
            </Link>
          </div>
        </div>
        <Button type="submit" size="lg" className="w-full" data-testid="login-submit-button" disabled={loading}>
          {loading ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>

      <div className="mt-8 border border-black/10 bg-white p-5 text-xs text-muted-foreground">
        <p className="label-caps mb-3">Demo accounts</p>
        <div className="flex gap-3">
          <Button
            type="button" variant="outline" size="sm" data-testid="login-fill-customer"
            onClick={() => { setEmail('customer@storefront.dev'); setPassword('Customer@123'); }}
          >
            Customer
          </Button>
          <Button
            type="button" variant="outline" size="sm" data-testid="login-fill-admin"
            onClick={() => { setEmail('admin@storefront.dev'); setPassword('Admin@123'); }}
          >
            Admin
          </Button>
        </div>
      </div>

      <p className="mt-8 text-sm text-muted-foreground">
        New here?{' '}
        <Link href="/register" data-testid="login-register-link" className="text-foreground underline">
          Create an account
        </Link>
      </p>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginContent />
    </Suspense>
  );
}
