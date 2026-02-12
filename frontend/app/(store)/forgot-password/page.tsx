'use client';

import { ArrowRight, MailCheck } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ message: string; resetUrl?: string } | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const d = await api<{ message: string; resetUrl?: string }>('/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email }),
      });
      setResult(d);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto flex max-w-md flex-col px-5 py-20 sm:px-0" data-testid="forgot-password-page">
      <p className="label-caps text-muted-foreground">Account recovery</p>
      <h1 className="mt-3 font-serif text-4xl font-semibold tracking-tighter sm:text-5xl">Forgot password.</h1>

      {result ? (
        <div className="mt-10">
          <div data-testid="forgot-success" className="flex items-start gap-3 border border-black/10 bg-white p-6">
            <MailCheck className="mt-0.5 h-5 w-5 shrink-0" strokeWidth={1.5} />
            <div>
              <p className="text-sm font-medium">{result.message}</p>
              <p className="mt-1 text-xs text-muted-foreground">The link is valid for 1 hour and can only be used once.</p>
            </div>
          </div>
          {result.resetUrl && (
            <div className="mt-4 border border-amber-700/30 bg-amber-50 p-5">
              <p className="text-xs text-amber-900">
                <strong>Demo mode</strong> — email delivery isn&apos;t configured, so here is your secure link:
              </p>
              <Button asChild size="sm" className="mt-3" data-testid="forgot-demo-link">
                <a href={result.resetUrl}>
                  Open reset link <ArrowRight className="h-3.5 w-3.5" />
                </a>
              </Button>
            </div>
          )}
        </div>
      ) : (
        <form onSubmit={submit} className="mt-10 space-y-6">
          <p className="text-sm leading-relaxed text-muted-foreground">
            Enter the email you signed up with and we&apos;ll issue a secure, single-use reset link.
          </p>
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" data-testid="forgot-email-input" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" required />
          </div>
          <Button type="submit" size="lg" className="w-full" data-testid="forgot-submit-button" disabled={loading}>
            {loading ? 'Issuing link…' : 'Send reset link'}
          </Button>
        </form>
      )}

      <p className="mt-8 text-sm text-muted-foreground">
        Remembered it?{' '}
        <Link href="/login" data-testid="forgot-login-link" className="text-foreground underline">Sign in</Link>
      </p>
    </div>
  );
}
