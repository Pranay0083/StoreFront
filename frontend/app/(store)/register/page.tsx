'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useAuth } from '@/components/providers';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function RegisterPage() {
  const { user, register } = useAuth();
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (user && typeof user === 'object') router.replace('/');
  }, [user, router]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const u = await register(name, email, password);
      toast.success(`Welcome, ${u.name}`);
      router.replace('/');
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto flex max-w-md flex-col px-5 py-20 sm:px-0" data-testid="register-page">
      <p className="label-caps text-muted-foreground">Join the list</p>
      <h1 className="mt-3 font-serif text-4xl font-semibold tracking-tighter sm:text-5xl">Create account.</h1>

      <form onSubmit={submit} className="mt-10 space-y-6">
        <div className="space-y-2">
          <Label htmlFor="name">Full name</Label>
          <Input id="name" data-testid="register-name-input" value={name} onChange={e => setName(e.target.value)} placeholder="Asha Verma" required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" data-testid="register-email-input" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <Input id="password" type="password" data-testid="register-password-input" value={password} onChange={e => setPassword(e.target.value)} placeholder="Minimum 6 characters" minLength={6} required />
        </div>
        <Button type="submit" size="lg" className="w-full" data-testid="register-submit-button" disabled={loading}>
          {loading ? 'Creating…' : 'Create account'}
        </Button>
      </form>

      <p className="mt-8 text-sm text-muted-foreground">
        Already have an account?{' '}
        <Link href="/login" data-testid="register-login-link" className="text-foreground underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
