'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Field, INVALID } from '@/components/checkout/field';
import { useAuth } from '@/components/providers';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { errorMessage } from '@/lib/api';

const MIN_PASSWORD = 6;

function RegisterContent() {
  const { user, register } = useAuth();
  const router = useRouter();
  const search = useSearchParams();
  // Only ever return to a page on this site.
  const raw = search.get('next');
  const next = raw && raw.startsWith('/') && !raw.startsWith('//') ? raw : '/';
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  useEffect(() => {
    if (user && typeof user === 'object') router.replace(next);
  }, [user, router, next]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < MIN_PASSWORD) {
      setPasswordError(`Use at least ${MIN_PASSWORD} characters.`);
      document.getElementById('password')?.focus();
      return;
    }
    setPasswordError(null);
    setLoading(true);
    try {
      const u = await register(name, email, password);
      toast.success(`Welcome, ${u.name.split(' ')[0]}. Your account is ready.`);
      router.replace(next);
    } catch (err) {
      setError(errorMessage(err, 'We couldn’t create your account. Try again in a moment.'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="px-5 py-14 sm:px-8 sm:py-24" data-testid="register-page">
      <div className="mx-auto w-full max-w-[440px] bg-card px-6 py-10 sm:px-10 sm:py-12">
        <h1 className="text-display-md font-extrabold">Create an account</h1>
        <p className="mt-3 text-[15px] leading-relaxed text-muted-foreground">
          Keep your bag across devices, follow each order from paid to delivered, and return pieces in a few taps.
        </p>

        <form onSubmit={submit} className="mt-8 space-y-5">
          <Field id="name" label="Full name">
            {control => (
              <Input
                {...control}
                autoComplete="name"
                autoCapitalize="words"
                data-testid="register-name-input"
                value={name}
                onChange={e => setName(e.target.value)}
                required
                minLength={2}
              />
            )}
          </Field>
          <Field id="email" label="Email">
            {control => (
              <Input
                {...control}
                type="email"
                inputMode="email"
                autoComplete="email"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                data-testid="register-email-input"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
              />
            )}
          </Field>
          <Field id="password" label="Password" hint={`At least ${MIN_PASSWORD} characters`} error={passwordError ?? undefined}>
            {control => (
              <Input
                {...control}
                type="password"
                autoComplete="new-password"
                data-testid="register-password-input"
                value={password}
                onChange={e => {
                  setPassword(e.target.value);
                  if (passwordError && e.target.value.length >= MIN_PASSWORD) setPasswordError(null);
                }}
                minLength={MIN_PASSWORD}
                required
                className={INVALID}
              />
            )}
          </Field>
          {error && (
            <p role="alert" className="text-[15px] text-destructive">
              {error}
            </p>
          )}
          <Button type="submit" size="lg" className="w-full" data-testid="register-submit-button" disabled={loading}>
            {loading ? 'Creating your account…' : 'Create account'}
          </Button>
        </form>

        <p className="mt-6 text-[15px] text-muted-foreground">
          Already have an account?{' '}
          <Link
            href={next !== '/' ? `/login?next=${encodeURIComponent(next)}` : '/login'}
            data-testid="register-login-link"
            className="font-medium text-foreground underline underline-offset-4"
          >
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}

export default function RegisterPage() {
  return (
    <Suspense fallback={null}>
      <RegisterContent />
    </Suspense>
  );
}
