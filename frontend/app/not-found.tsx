import Link from 'next/link';
import { Button } from '@/components/ui/button';

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-[80vh] max-w-[1760px] flex-col justify-center px-4 py-24 sm:px-8">
      <Link href="/" className="mb-16 text-2xl font-extrabold tracking-[-0.05em]">
        STOREFRONT
      </Link>
      <h1 className="max-w-[14ch] animate-rise text-balance text-display-lg font-extrabold">Nothing at this address</h1>
      <p className="mt-6 max-w-[44ch] animate-rise text-lg [animation-delay:80ms]">
        The page may have moved, or the link may be mistyped. The shop itself is one click away.
      </p>
      <Button asChild size="lg" className="mt-8 w-fit animate-rise [animation-delay:160ms]">
        <Link href="/">Back to the store</Link>
      </Button>
    </main>
  );
}
