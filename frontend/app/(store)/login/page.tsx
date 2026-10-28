'use client';

import { Eye, EyeOff } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Field, INVALID } from '@/components/checkout/field';
import { useAuth } from '@/components/providers';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { errorMessage } from '@/lib/api';
import { isStaff } from '@storefront/contracts';

function LoginContent() {
  const { user, login } = useAuth();
  const router = useRouter();
  const search = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Only ever return to a page on this site.
  const raw = search.get('next');
  const next = raw && raw.startsWith('/') && !raw.startsWith('//') ? raw : null;

  useEffect(() => {
    if (user && typeof user === 'object') {
      router.replace(next || (isStaff(user.role) ? '/admin' : '/'));
    }
  }, [user, router, next]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const u = await login(email, password);
      toast.success(`Welcome back, ${u.name.split(' ')[0]}.`);
      router.replace(next || (isStaff(u.role) ? '/admin' : '/'));
    } catch (err) {
      setError(errorMessage(err, 'We couldn’t sign you in. Try again in a moment.'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="px-5 py-14 sm:px-8 sm:py-24" data-testid="login-page">
      <div className="mx-auto w-full max-w-[440px] bg-card px-6 py-10 sm:px-10 sm:py-12">
        <h1 className="text-display-md font-extrabold">Sign in</h1>
        <p className="mt-3 text-[15px] leading-relaxed text-muted-foreground">
          {next === '/checkout' ? 'Sign in to pay. Your bag comes with you.' : 'Track your orders and check out faster.'}
        </p>

        <form onSubmit={submit} noValidate className="mt-8 space-y-5" aria-describedby={error ? 'login-error' : undefined}>
          <Field id="email" label="Email">
            {control => (
              <Input
                {...control}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? 'login-error' : undefined}
                type="email"
                inputMode="email"
                autoComplete="email"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                data-testid="login-email-input"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                className={INVALID}
              />
            )}
          </Field>
          <Field id="password" label="Password">
            {control => (
              <div className="relative">
                <Input
                  {...control}
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? 'login-error' : undefined}
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  data-testid="login-password-input"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  className={`pr-12 ${INVALID}`}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(value => !value)}
                  className="absolute right-0 top-0 flex h-11 w-11 touch-manipulation items-center justify-center text-muted-foreground transition-[color,transform] duration-150 ease-out hover:text-foreground active:scale-[0.97]"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  aria-pressed={showPassword}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
                </button>
              </div>
            )}
          </Field>
          {error && (
            <p id="login-error" role="alert" className="text-[15px] text-destructive">
              {error}
            </p>
          )}
          <Button type="submit" size="lg" className="w-full" data-testid="login-submit-button" disabled={loading}>
            {loading ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>

        <p className="mt-6 text-[15px] text-muted-foreground">
          Trying the demo?{' '}
          <button
            type="button"
            data-testid="login-fill-customer"
            onClick={() => {
              setEmail('customer@storefront.dev');
              setPassword('Customer@123');
              setError(null);
            }}
            className="font-medium text-foreground underline underline-offset-4"
          >
            Fill in the demo customer
          </button>
        </p>
        <p className="mt-3 text-[15px] text-muted-foreground">
          New here?{' '}
          <Link
            href={next ? `/register?next=${encodeURIComponent(next)}` : '/register'}
            data-testid="login-register-link"
            className="font-medium text-foreground underline underline-offset-4"
          >
            Create an account
          </Link>
        </p>
      </div>
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
