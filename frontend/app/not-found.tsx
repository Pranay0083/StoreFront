import Link from 'next/link';
import { Button } from '@/components/ui/button';

export default function NotFound() {
  return (
    <main className="mx-auto max-w-7xl px-5 py-32 text-center sm:px-8">
      <p className="label-caps text-muted-foreground">404</p>
      <h1 className="mt-3 font-serif text-4xl">This page doesn&apos;t exist.</h1>
      <Button asChild className="mt-8">
        <Link href="/">Back to the store</Link>
      </Button>
    </main>
  );
}
